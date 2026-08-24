"""HKEX public daily short-selling turnover scraper.

Pulls the day's aggregated short-selling turnover per stock from HKEX's
free public page (Main Board + GEM). Returns a ``ShortSaleRow`` per
tracked HK stock with ``market='HK'``, ``total_volume=0`` (HKEX does
not publish total daily volume on this page), and ``short_value_hkd``
populated from the published HKD turnover.

Source (verified 2026-08-24, structure of populated file pending a
weekday market-close probe):
  - Main Board:
    https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTMAIN.HTM
  - GEM:
    https://www.hkex.com.hk/eng/stat/smstat/ssturnover/gcms/ASHTMAIN.HTM

Page is rendered as a ``<pre><font size='1'>`` plain-text block; each
row is ``code name shortSellShares shortSellTurnoverHKD pctOfTotal``.
We tolerate the "will be available after day close" placeholder by
returning an empty list — no error, just nothing to write today.

Failures are non-fatal — ``logger.warning`` and ``return []``.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from datetime import date

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import ShortSaleRow

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
_TIMEOUT_SECONDS = 30

HKEX_MAIN_URL = (
    "https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTMAIN.HTM"
)
# Same /ncms/ directory as the Main Board file — HKEX names GEM pages
# ASHTGEM.HTM (not under a /gcms/ or /gem/ subdirectory). Wayback-Machine
# query confirmed live 200 on both URLs.
HKEX_GEM_URL = (
    "https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTGEM.HTM"
)

# Match one row of the populated HKEX short-selling turnover table.
# Field capture order: stock_code, short_sell_shares, short_sell_hkd, pct.
# The name sits between code and shares, is whitespace-padded, and may
# itself contain spaces — match any non-digit, non-digit-block characters
# lazily until the digits start. ``pct`` is optional (some rows may omit).
_ROW_RE = re.compile(
    r"^\s*(?P<code>\d{1,5})\s+(?P<name>[A-Za-z0-9 &\-.(),/'`]+?)\s+"
    r"(?P<shares>\d[\d,]*)\s+(?P<hkd>\d[\d,]*)\s+"
    r"(?P<pct>[\d.]+)\s*%\s*$"
)
# Detect the placeholder text HKEX shows outside trading hours.
_PLACEHOLDER_PHRASE = "will be available after day close"
_TAG_RE = re.compile(r"<[^>]+>")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _http_get_text(url: str) -> str | None:
    """GET ``url`` and return HTML text. ``None`` on any failure."""
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:  # noqa: S310
            raw = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning(f"HKEX GET {url}: {exc}")
        return None
    charset = "iso-8859-1"  # HKEX declares iso-8859-1 in <meta http-equiv>
    try:
        return raw.decode(charset)
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


def _html_to_text(html: str) -> str:
    """Crude tag stripper — HKEX page has a tiny, predictable tag set."""
    return _TAG_RE.sub("", html)


# ---------------------------------------------------------------------------
# Public parser
# ---------------------------------------------------------------------------


def parse_hkex_short_selling_text(text: str) -> list[tuple[int, str, int, float]]:
    """Parse one HKEX ASHTMAIN.HTM body.

    Returns ``[(stock_code, name, short_sell_shares, short_sell_hkd), …]``
    in the order they appear in the source. Skips placeholder text.
    Skips rows that don't match the expected column layout.
    """
    if _PLACEHOLDER_PHRASE in text:
        return []
    rows: list[tuple[int, str, int, float]] = []
    for line in text.splitlines():
        match = _ROW_RE.match(line)
        if not match:
            continue
        code = int(match.group("code"))
        name = match.group("name").strip()
        try:
            shares = int(match.group("shares").replace(",", ""))
        except ValueError:
            continue
        try:
            hkd = float(match.group("hkd").replace(",", ""))
        except ValueError:
            continue
        rows.append((code, name, shares, hkd))
    return rows


# ---------------------------------------------------------------------------
# Sync orchestrator
# ---------------------------------------------------------------------------


def sync_hkex_short_sales(
    client,
    hk_code_to_id: dict[int, str],
    *,
    trade_date: date | None = None,
) -> list[ShortSaleRow]:
    """Fetch the day's HKEX short-selling turnover for tracked HK stocks.

    Args:
        client: Supabase client (kept for API symmetry; rows are returned
            for the caller to upsert).
        hk_code_to_id: Map of numeric HK stock code → ``ey_stocks.id``.
        trade_date: Override the "today" date — used by ``--dry-run`` tests.
            Defaults to ``date.today()``.
    """
    if not hk_code_to_id:
        logger.info("HKEX sync skipped — no HK stocks in the universe")
        return []

    trade_date = trade_date or date.today()

    aggregated: dict[int, tuple[str, int, float]] = {}
    for url, label in ((HKEX_MAIN_URL, "Main Board"), (HKEX_GEM_URL, "GEM")):
        html = _http_get_text(url)
        if html is None:
            continue
        text = _html_to_text(html)
        if _PLACEHOLDER_PHRASE in text:
            logger.info(
                f"HKEX short-selling page for {label} shows placeholder "
                f"(market likely closed) — skipping"
            )
            continue
        parsed = parse_hkex_short_selling_text(text)
        logger.info(f"HKEX {label} ASHTMAIN: {len(parsed)} rows parsed")
        for code, name, shares, hkd in parsed:
            # Main Board and GEM are disjoint by definition, so a last-write
            # wins merge is safe. If both ever return a row for the same
            # code (a formatting bug), the larger shares wins.
            existing = aggregated.get(code)
            if existing is None or shares > existing[1]:
                aggregated[code] = (name, shares, hkd)

    if not aggregated:
        logger.info("HKEX sync: no populated rows today — nothing to upsert")
        return []

    rows: list[ShortSaleRow] = []
    unmatched = 0
    for code, (name, shares, hkd) in aggregated.items():
        stock_id = hk_code_to_id.get(code)
        if not stock_id:
            unmatched += 1
            continue
        rows.append(
            ShortSaleRow(
                stock_id=stock_id,
                trade_date=trade_date,
                market="HK",
                short_volume=shares,
                short_exempt_volume=0,
                # HKEX doesn't publish total daily volume on this page;
                # leave 0 so the UI's derived shortPctOfVolume returns null.
                total_volume=0,
                short_value_hkd=hkd,
                source="hkex",
            )
        )

    if unmatched:
        logger.info(
            f"HKEX: {unmatched} codes had no ey_stocks row — silently dropped"
        )

    logger.info(f"HKEX sync: {len(rows)} tracked rows ready to upsert for {trade_date}")
    return rows
