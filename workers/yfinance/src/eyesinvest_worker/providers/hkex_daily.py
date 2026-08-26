"""HKEX public daily + morning-session short-selling turnover scraper.

Pulls the day's aggregated short-selling turnover per stock from HKEX's
free public pages (Main Board + GEM), in two flavours:

* **Full day** — populated after 16:00 HKT market close, on ASHTMAIN.HTM /
  ASHTGEM.HTM.
* **Morning session** — populated around lunch break (~12:00–13:00 HKT),
  on MSHTMAIN.HTM / MSHTGEM.HTM. The "AM share of full day" ratio is the
  signal users watch to spot disproportionate morning activity before the
  day's close.

Both pages share the same row format (``code name shortSellShares
shortSellTurnoverHKD pctOfTotal``) so a single parser handles them. We
return ``ShortSaleRow`` with ``market='HK'``, ``total_volume=0`` (HKEX
does not publish total daily volume), and ``short_value_hkd`` /
``am_short_value_hkd`` populated from the published HKD turnover.

Source (verified 2026-08-24, structure of populated file pending a
weekday market-close probe):

  - Main Board (full day):
    https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTMAIN.HTM
  - GEM (full day):
    https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTGEM.HTM
  - Main Board (morning session):
    https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/MSHTMAIN.HTM
  - GEM (morning session):
    https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/MSHTGEM.HTM

Page is rendered as a ``<pre><font size='1'>`` plain-text block.
We tolerate the "will be available after …" placeholder by returning
empty — no error, just nothing to write today.

Failures are non-fatal — ``logger.warning`` and ``return {}``.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from datetime import date, datetime

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
# Morning-session pages (published around lunch break). Naming follows HKEX's
# convention: M = Morning, SHT = Short (selling), MAIN/GEM = board segment.
# MSHTGEM.HTM is unverified — if it 404s, the AM Main Board page alone still
# covers the bulk of HKEX-tracked stocks and the empty GEM result is benign.
HKEX_AM_MAIN_URL = (
    "https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/MSHTMAIN.HTM"
)
HKEX_AM_GEM_URL = (
    "https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/MSHTGEM.HTM"
)

# Match one row of the populated HKEX short-selling turnover table.
# Field capture order: stock_code, name, short_sell_shares, short_sell_hkd,
# optional pct-of-total. The name sits between code and shares, is
# whitespace-padded, and may itself contain spaces — match any non-digit,
# non-digit-block characters lazily until the digits start. The pct field
# is optional because the live HKEX pages (verified 2026-08-24 against both
# ASHTMAIN.HTM and MSHTMAIN.HTM) do not publish it.
_ROW_RE = re.compile(
    r"^\s*(?P<code>\d{1,5})\s+(?P<name>[A-Za-z0-9 &\-.(),/'`]+?)\s+"
    r"(?P<shares>\d[\d,]*)\s+(?P<hkd>\d[\d,]*)\s*"
    r"(?:(?P<pct>[\d.]+)\s*%)?\s*$"
)
# Placeholder text on the full-day page (after market close, before publish).
_PLACEHOLDER_PHRASE = "will be available after day close"
# Placeholder text on the morning-session page (before lunch break). HKEX
# uses slightly different wording — substring match against either phrase.
_AM_PLACEHOLDER_PHRASE = "will be available after"
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
    """Parse one HKEX ASHTMAIN.HTM / MSHTMAIN.HTM body.

    Returns ``[(stock_code, name, short_sell_shares, short_sell_hkd), …]``
    in the order they appear in the source. Skips placeholder text on
    either page. Skips rows that don't match the expected column layout.
    """
    if _PLACEHOLDER_PHRASE in text or _AM_PLACEHOLDER_PHRASE in text:
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
# Page fetch helpers (full-day and AM share the same shape)
# ---------------------------------------------------------------------------


def _fetch_hkex_page(url: str, label: str) -> dict[int, tuple[str, int, float]]:
    """Fetch + parse + aggregate one HKEX page.

    Returns ``{stock_code: (name, short_sell_shares, short_sell_hkd)}``.
    Empty dict on HTTP failure or placeholder / no-row pages.

    Last-write-wins merge: Main Board and GEM are disjoint by definition,
    so a duplicate code is a formatting bug; we keep the larger shares.
    """
    html = _http_get_text(url)
    if html is None:
        return {}
    text = _html_to_text(html)
    if _PLACEHOLDER_PHRASE in text or _AM_PLACEHOLDER_PHRASE in text:
        logger.info(f"HKEX {label} page shows placeholder — skipping")
        return {}
    parsed = parse_hkex_short_selling_text(text)
    if not parsed:
        return {}
    logger.info(f"HKEX {label}: {len(parsed)} rows parsed")
    out: dict[int, tuple[str, int, float]] = {}
    for code, name, shares, hkd in parsed:
        existing = out.get(code)
        if existing is None or shares > existing[1]:
            out[code] = (name, shares, hkd)
    return out


# ---------------------------------------------------------------------------
# Public sync entry points
# ---------------------------------------------------------------------------


def sync_hkex_short_sales(
    client,
    hk_code_to_id: dict[int, str],
    *,
    trade_date: date | None = None,
) -> list[ShortSaleRow]:
    """Backwards-compatible wrapper: full-day only, no AM.

    Equivalent to ``sync_hkex_short_sales_combined(..., include_am=False)``.
    Kept for external callers (e.g. CLI dry-runs that only want full-day).
    """
    return sync_hkex_short_sales_combined(
        client, hk_code_to_id, trade_date=trade_date, include_am=False,
    )


def sync_hkex_am_short_sales(
    client,
    hk_code_to_id: dict[int, str],
    *,
    trade_date: date | None = None,
) -> dict[int, tuple[str, int, float]]:
    """Fetch HKEX morning-session (MSHTMAIN / MSHTGEM) turnover.

    Returns the raw ``{code: (name, am_shares, am_hkd)}`` aggregation; the
    caller (``sync_hkex_short_sales_combined``) merges it into the same
    ``ShortSaleRow`` as the full-day data.

    Empty dict when the AM page hasn't been published yet (placeholder) or
    when both Main Board + GEM return zero rows.
    """
    aggregated: dict[int, tuple[str, int, float]] = {}
    for url, label in ((HKEX_AM_MAIN_URL, "AM Main Board"), (HKEX_AM_GEM_URL, "AM GEM")):
        page_rows = _fetch_hkex_page(url, label)
        for code, (name, shares, hkd) in page_rows.items():
            existing = aggregated.get(code)
            if existing is None or shares > existing[1]:
                aggregated[code] = (name, shares, hkd)
    if aggregated:
        trade_date = trade_date or date.today()
        logger.info(f"HKEX AM sync: {len(aggregated)} codes captured for {trade_date}")
    return aggregated


def sync_hkex_short_sales_combined(
    client,
    hk_code_to_id: dict[int, str],
    *,
    trade_date: date | None = None,
    include_am: bool = True,
) -> list[ShortSaleRow]:
    """Fetch both AM and full-day HKEX turnover; merge into one row per stock.

    Behavior matrix (publish state of each HKEX page):

    =====================  ====================================================
    full-day only           row with full-day fields, ``am_*`` = None
    AM only (mid-day)       row with ``short_volume=0`` and ``am_*`` populated
    both published          row with both fields populated
    neither published       no row written (worker exits silently)
    =====================  ====================================================

    The ``short_volume=0`` mid-day placeholder mirrors the existing
    ``total_volume=0`` convention for HK rows where HKEX doesn't publish a
    number — the chart treats 0 as "no bar" so only the AM bar renders
    until the full-day page lands.

    Args:
        client: Supabase client (kept for API symmetry; rows are returned
            for the caller to upsert).
        hk_code_to_id: Map of numeric HK stock code → ``ey_stocks.id``.
        trade_date: Override the "today" date — used by ``--dry-run`` tests.
            Defaults to ``date.today()``.
        include_am: When False, behave like the legacy
            ``sync_hkex_short_sales`` and skip the AM fetch entirely.
    """
    if not hk_code_to_id:
        logger.info("HKEX sync skipped — no HK stocks in the universe")
        return []

    trade_date = trade_date or date.today()

    full_day: dict[int, tuple[str, int, float]] = {}
    for url, label in ((HKEX_MAIN_URL, "Main Board"), (HKEX_GEM_URL, "GEM")):
        full_day.update(_fetch_hkex_page(url, label))

    am: dict[int, tuple[str, int, float]] = (
        sync_hkex_am_short_sales(client, hk_code_to_id, trade_date=trade_date)
        if include_am else {}
    )

    if not full_day and not am:
        logger.info("HKEX sync: no populated rows today — nothing to upsert")
        return []

    rows: list[ShortSaleRow] = []
    unmatched = 0
    am_captured_at = datetime.utcnow()
    # Union of codes from both pages intersected with the tracked HK universe.
    for code in set(full_day.keys()) | set(am.keys()):
        stock_id = hk_code_to_id.get(code)
        if not stock_id:
            unmatched += 1
            continue
        fd_shares, fd_hkd = full_day.get(code, ("", 0, 0.0))[1:]
        am_shares: int | None = None
        am_hkd: float | None = None
        if am:
            # `am[code]` is normally a (name, shares, hkd) tuple from
            # `sync_hkex_am_short_sales`, but defensively skip any code whose
            # AM row is missing or malformed — otherwise a single bad parse
            # crashes the whole sync-shorts run with KeyError / IndexError.
            am_row = am.get(code)
            if am_row is not None and len(am_row) >= 3:
                am_shares = am_row[1]
                am_hkd = am_row[2]
            elif am_row is not None:
                logger.warning(
                    f"HKEX AM row for code {code} is malformed; skipping AM fields"
                )
        rows.append(
            ShortSaleRow(
                stock_id=stock_id,
                trade_date=trade_date,
                market="HK",
                short_volume=fd_shares,
                short_exempt_volume=0,
                # HKEX doesn't publish total daily volume on this page;
                # leave 0 so the UI's derived shortPctOfVolume returns null.
                total_volume=0,
                short_value_hkd=fd_hkd if full_day else None,
                source="hkex",
                am_short_volume=am_shares,
                am_short_value_hkd=am_hkd,
                am_published_at=am_captured_at if am else None,
            )
        )

    if unmatched:
        logger.info(
            f"HKEX: {unmatched} codes had no ey_stocks row — silently dropped"
        )

    logger.info(f"HKEX sync: {len(rows)} tracked rows ready to upsert for {trade_date}")
    return rows