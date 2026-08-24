"""SFC aggregated reportable short positions — weekly CSV feeds.

HK's counterpart to FINRA's ``consolidatedShortInterest``. Pulls positions
above the reporting threshold (≥HK$30M OR ≥0.02% of issued shares) per
HK-listed security, weekly on the close of Friday's session.

Source (verified live 2026-08-24):
  - Index page:
    https://www.sfc.hk/en/Regulatory-functions/Market/Short-position-reporting/
    Aggregated-reportable-short-positions-of-specified-shares
  - Individual weekly CSVs:
    https://www.sfc.hk/-/media/EN/pdf/spr/YYYY/MM/DD/
    Short_Position_Reporting_Aggregated_Data_YYYYMMDD.csv

CSV columns (5-field, no trailing units):
    Date, Stock Code, Stock Name, Aggregated Reportable Short Positions
    (Shares), Aggregated Reportable Short Positions (HK$)

Dates are ``DD/MM/YYYY``. Stock Code is a 1–5 digit numeric with no
leading zero (e.g. ``700`` for Tencent, ``1`` for CKH).

We filter on ``hk_code_to_id`` so only tracked HK tickers land in the
database; everything else is silently dropped.
"""

from __future__ import annotations

import csv
import io
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from typing import Iterable

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import ShortInterestRow

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
_TIMEOUT_SECONDS = 30
_REQUEST_THROTTLE_SECONDS = 0.3  # SFC serves static CSVs; stay polite.

SFC_INDEX_URL = (
    "https://www.sfc.hk/en/Regulatory-functions/Market/Short-position-reporting/"
    "Aggregated-reportable-short-positions-of-specified-shares"
)
_CSV_URL_RE = re.compile(
    r"(https://www\.sfc\.hk/-/media/EN/pdf/spr/\d{4}/\d{2}/\d{2}/"
    r"Short_Position_Reporting_Aggregated_Data_\d{8}\.csv)"
)
_DATE_IN_CSV_URL_RE = re.compile(r"_(\d{8})\.csv$")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _http_get_text(url: str) -> str | None:
    """GET ``url`` and return decoded text. ``None`` on any failure."""
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:  # noqa: S310
            raw = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning(f"SFC GET {url}: {exc}")
        return None
    # SFC serves CSVs with no charset declaration; default to utf-8-sig to
    # silently strip a leading BOM if present.
    return raw.decode("utf-8-sig", errors="replace")


# ---------------------------------------------------------------------------
# Index + CSV parsing
# ---------------------------------------------------------------------------


def fetch_sfc_csv_urls(index_html: str | None = None) -> list[tuple[date, str]]:
    """Return ``[(file_date, csv_url), …]`` ordered by ascending file date."""
    if index_html is None:
        index_html = _http_get_text(SFC_INDEX_URL)
    if not index_html:
        return []
    out: list[tuple[date, str]] = []
    for match in _CSV_URL_RE.finditer(index_html):
        url = match.group(1)
        date_match = _DATE_IN_CSV_URL_RE.search(url)
        if not date_match:
            continue
        try:
            file_date = datetime.strptime(date_match.group(1), "%Y%m%d").date()
        except ValueError:
            continue
        out.append((file_date, url))
    # Dedup by URL while keeping stable order.
    seen: set[str] = set()
    deduped: list[tuple[date, str]] = []
    for d, u in out:
        if u not in seen:
            seen.add(u)
            deduped.append((d, u))
    deduped.sort(key=lambda x: x[0])
    return deduped


def _parse_short_interest_csv(
    text: str, settlement: date
) -> Iterable[tuple[int, ShortInterestRow]]:
    """Yield ``(stock_code, ShortInterestRow)`` from a single SFC weekly CSV body.

    The row's ``stock_id`` is left empty — the caller looks it up via
    ``hk_code_to_id`` so we don't drag a Supabase handle into parsing.
    """
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            code = int((row.get("Stock Code") or "").strip())
        except (TypeError, ValueError):
            continue
        try:
            shares = int((row.get("Aggregated Reportable Short Positions (Shares)") or "0")
                         .replace(",", "").strip())
        except (TypeError, ValueError):
            continue
        try:
            hkd = float((row.get("Aggregated Reportable Short Positions (HK$)") or "0")
                        .replace(",", "").strip())
        except (TypeError, ValueError):
            hkd = None
        yield code, ShortInterestRow(
            stock_id="",
            settlement_date=settlement,
            market="HK",
            short_interest=shares,
            days_to_cover=None,
            prior_short_interest=None,
            change_pct=None,
            source="sfc",
        )
        if hkd is not None:
            # Cheap way to surface HKD without expanding the model now.
            logger.debug(f"SFC {settlement} code={code} shares={shares} HKD={hkd:.0f}")


def sync_sfc_short_interest(
    client,
    hk_code_to_id: dict[int, str],
    *,
    last_settlement: date | None = None,
    backfill_days: int = 180,
    force_backfill: bool = False,
) -> list[ShortInterestRow]:
    """Sync all SFC weekly CSVs that post-date ``last_settlement`` into Supabase.

    Args:
        client: Supabase client (kept for API symmetry with the FINRA path;
            not used today — rows are returned for the caller to upsert).
        hk_code_to_id: Map of numeric HK stock code → ``ey_stocks.id``.
        last_settlement: Highest ``settlement_date`` already in
            ``ey_short_interest where market='HK'``. ``None`` → full backfill.
        backfill_days: Cap of how far back to go when ``last_settlement is
            None`` (used to avoid pulling the entire 2012 → present archive
            on the first run).
        force_backfill: If True, ignore ``last_settlement`` and pull
            everything in the last ``backfill_days``.
    """
    if not hk_code_to_id:
        logger.info("SFC sync skipped — no HK stocks in the universe")
        return []

    logger.info("fetching SFC aggregated short-position index")
    files = fetch_sfc_csv_urls()
    if not files:
        logger.warning("SFC index returned no CSV URLs — skipping weekly sync")
        return []

    # Apply settlement / backfill window.
    if last_settlement is not None and not force_backfill:
        files = [(d, u) for d, u in files if d > last_settlement]
    elif force_backfill:
        cutoff = date.today() - timedelta(days=backfill_days)
        files = [(d, u) for d, u in files if d >= cutoff]
    else:
        # First-ever run with no HK rows yet: bound the backfill.
        cutoff = date.today() - timedelta(days=backfill_days)
        files = [(d, u) for d, u in files if d >= cutoff]

    if not files:
        logger.info("SFC: nothing newer than last settlement "
                    f"{last_settlement.isoformat() if last_settlement else 'n/a'} — skipping")
        return []

    logger.info(f"SFC: syncing {len(files)} weekly CSV file(s)")

    rows: list[ShortInterestRow] = []
    unmatched_codes: set[int] = set()
    for i, (file_date, url) in enumerate(files, start=1):
        text = _http_get_text(url)
        if not text:
            continue
        parsed = list(_parse_short_interest_csv(text, settlement=file_date))
        matched = 0
        for code, row in parsed:
            stock_id = hk_code_to_id.get(code)
            if not stock_id:
                unmatched_codes.add(code)
                continue
            rows.append(row.model_copy(update={"stock_id": stock_id}))
            matched += 1
        logger.info(
            f"SFC {file_date.isoformat()}: {matched} tracked / "
            f"{len(parsed) - matched} untracked rows"
        )
        if i < len(files):
            time.sleep(_REQUEST_THROTTLE_SECONDS)

    if unmatched_codes:
        sample = sorted(unmatched_codes)[:10]
        logger.info(
            f"SFC: {len(unmatched_codes)} unique stock codes had no "
            f"ey_stocks row (sample: {sample}) — silently dropped"
        )

    logger.info(f"SFC sync: {len(rows)} weekly rows ready to upsert")
    return rows
