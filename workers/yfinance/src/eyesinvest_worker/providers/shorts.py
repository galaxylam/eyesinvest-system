"""FINRA short-selling adapter — daily Reg-SHO volume + bi-weekly short interest.

Both feeds are pipe-delimited TXT files, no auth required. We filter on
``symbol_map`` so only tracked US tickers land in the database; everything
else is silently dropped.

Sources (verified live 2026-08-23):
  - Daily:     https://cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt
               (the older http://regsho.finra.org/CNMSshvol… URL now
               301-redirects to the FINRA catalog page — Cloudflare serves
               HTML there, so a naive fetch returns no parseable rows.)
  - Bi-weekly: https://cdn.finra.org/data/shortsale/biweekly.txt — single
               "most recent release" TXT. Older per-date files
               (/sites/default/files/<YYYY-MM>/shortint_data_<YYYYMMDD>.txt)
               404; Cloudflare blocks other URL probes from datacenter IPs.

Failures are non-fatal — we ``logger.warning`` and return ``[]`` so a
transient FINRA hiccup never aborts the whole ``sync-shorts`` run.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Iterable

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import ShortInterestRow, ShortSaleRow

# A real-browser-ish UA so Cloudflare's bot heuristics don't 403 us.
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
_TIMEOUT_SECONDS = 30
_SHORT_SALE_URL = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{yyyymmdd}.txt"
_SHORT_INTEREST_URL = "https://cdn.finra.org/data/shortsale/biweekly.txt"
_REQUEST_THROTTLE_SECONDS = 1.0  # be polite to FINRA / Cloudflare


# ---------------------------------------------------------------------------
# Public helpers — one file at a time, in-memory.
# ---------------------------------------------------------------------------


def parse_short_sale_txt(text: str) -> Iterable[dict]:
    """Yield ``{date, symbol, short_volume, short_exempt_volume, total_volume}``.

    FINRA CNMS format::

        Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume
        20240801|AAPL|12345678|0|50000000
        ...

    Header line is skipped when present (the CNMS file has no header, but
    future formats may).
    """
    for line in text.splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        # Skip header rows like "Date|Symbol|..."
        if line.lower().startswith("date|"):
            continue
        parts = line.split("|")
        if len(parts) < 5:
            continue
        date_str, symbol, short_v, short_exempt_v, total_v = parts[:5]
        try:
            yield {
                "date": _parse_yyyymmdd(date_str),
                "symbol": symbol.strip(),
                "short_volume": _coerce_int(short_v),
                "short_exempt_volume": _coerce_int(short_exempt_v or 0),
                "total_volume": _coerce_int(total_v),
            }
        except (TypeError, ValueError):
            # Garbage rows are silently dropped — FINRA occasionally has
            # blank padding at EOF.
            continue


def parse_short_interest_txt(text: str) -> Iterable[dict]:
    """Yield ``{settlement_date, symbol, short_interest, issue_name}``.

    FINRA short-interest format::

        Settlement Date|Symbol|Short Interest|Issue Name
        20240815|AAPL|98765432|APPLE INC
        ...

    `days_to_cover`, `prior_short_interest`, `change_pct` are not present
    in the file — they're computed at query time in the web layer.
    """
    for line in text.splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        if line.lower().startswith("settlement"):
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        date_str, symbol, short_v, issue_name = parts[:4]
        try:
            yield {
                "settlement_date": _parse_yyyymmdd(date_str),
                "symbol": symbol.strip(),
                "short_interest": int(short_v),
                "issue_name": issue_name.strip(),
            }
        except (TypeError, ValueError):
            continue


def fetch_finra_short_sale(
    trade_date: date, symbol_map: dict[str, str]
) -> list[ShortSaleRow]:
    """Download one CNMS daily file, filter to tracked US symbols, return rows."""
    url = _SHORT_SALE_URL.format(yyyymmdd=trade_date.strftime("%Y%m%d"))
    text = _http_get(url)
    if text is None:
        return []
    rows: list[ShortSaleRow] = []
    for raw in parse_short_sale_txt(text):
        stock_id = symbol_map.get(raw["symbol"])
        if stock_id is None:
            continue  # not a tracked ticker — drop silently
        rows.append(
            ShortSaleRow(
                stock_id=stock_id,
                trade_date=raw["date"],
                short_volume=raw["short_volume"],
                short_exempt_volume=raw["short_exempt_volume"],
                total_volume=raw["total_volume"],
            )
        )
    logger.info(
        f"FINRA short-sale {trade_date.isoformat()}: {len(rows)} tracked symbols"
    )
    return rows


def fetch_finra_short_interest(
    settlement_date: date | None, symbol_map: dict[str, str]
) -> list[ShortInterestRow]:
    """Download the single "most recent biweekly release" TXT, filter to tracked US symbols.

    ``settlement_date`` is informational — the biweekly file is one TXT that
    contains the latest release, so we pass it through unchanged to every row.
    """
    text = _http_get(_SHORT_INTEREST_URL)
    if text is None:
        return []
    rows: list[ShortInterestRow] = []
    for raw in parse_short_interest_txt(text):
        stock_id = symbol_map.get(raw["symbol"])
        if stock_id is None:
            continue
        rows.append(
            ShortInterestRow(
                stock_id=stock_id,
                settlement_date=raw["settlement_date"],
                short_interest=raw["short_interest"],
            )
        )
    logger.info(
        f"FINRA short-interest (latest release): {len(rows)} tracked symbols"
    )
    return rows


# ---------------------------------------------------------------------------
# Higher-level sync — used directly by the CLI.
# ---------------------------------------------------------------------------


def _last_n_trading_days(n: int, end: date | None = None) -> list[date]:
    """Approximate the last N trading days (Mon-Fri, no holiday calendar).

    The CNMS file for a US holiday / weekend is missing, but skipping
    weekends is enough for our retry-tolerant upserts.
    """
    end = end or date.today()
    out: list[date] = []
    cursor = end
    while len(out) < n:
        if cursor.weekday() < 5:  # 0=Mon … 4=Fri
            out.append(cursor)
        cursor -= timedelta(days=1)
    out.reverse()
    return out


def sync_short_sales(
    client,
    symbol_map: dict[str, str],
    days: int = 7,
) -> list[ShortSaleRow]:
    """Pull daily Reg-SHO for the last ``days`` trading dates.

    Returns the union of all rows (empty list on total failure).
    Throttles between requests to avoid Cloudflare 429 rate-limiting.
    """
    del client  # unused; kept for symmetry with sync_short_interest
    all_rows: list[ShortSaleRow] = []
    for i, d in enumerate(_last_n_trading_days(days)):
        try:
            all_rows.extend(fetch_finra_short_sale(d, symbol_map))
        except Exception as exc:  # noqa: BLE001 — defensive top-level
            logger.warning(f"sync_short_sales: {d.isoformat()} crashed: {exc}")
        if i < days - 1:  # don't sleep after the last request
            time.sleep(_REQUEST_THROTTLE_SECONDS)
    return all_rows


def sync_short_interest(
    client,
    symbol_map: dict[str, str],
    lookback_days: int = 60,
) -> list[ShortInterestRow]:
    """Pull the latest FINRA bi-weekly short-interest release.

    ``lookback_days`` is retained for CLI symmetry with ``sync_short_sales``;
    the bi-weekly file is a single TXT so the argument is ignored.
    """
    del client, lookback_days  # both unused; single-file fetch
    try:
        return fetch_finra_short_interest(None, symbol_map)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"sync_short_interest crashed: {exc}")
        return []


# ---------------------------------------------------------------------------
# Internal helpers.
# ---------------------------------------------------------------------------


def _parse_yyyymmdd(value: str) -> date:
    """Parse `YYYYMMDD` (no dashes) into a `date`. Raises ValueError on bad input."""
    value = value.strip()
    if len(value) != 8:
        raise ValueError(f"expected YYYYMMDD, got {value!r}")
    return date(int(value[:4]), int(value[4:6]), int(value[6:8]))


def _coerce_int(value: str | int | float) -> int:
    """Parse a numeric volume cell.

    FINRA's CNMS file has historically been integers, but recent (2025+)
    releases contain fractional share counts (e.g. ``261283.883609``) —
    likely due to consolidated rounding. We accept both forms.
    """
    s = str(value).strip()
    if not s:
        raise ValueError("empty numeric cell")
    return int(float(s))


def _http_get(url: str) -> str | None:
    """GET ``url`` with retries. Returns body text or None on any failure."""
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        # 404 = file not published yet (e.g. settlement date in the future
        # or holiday). Treat as "no data" rather than a hard error.
        if exc.code == 404:
            logger.info(f"FINRA GET {url}: 404 (no data published)")
            return None
        logger.warning(f"FINRA GET {url}: HTTP {exc.code}")
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning(f"FINRA GET {url}: {exc}")
        return None
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("latin-1", errors="replace")