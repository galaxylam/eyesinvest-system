"""Controlled end-to-end check of the squeeze-column write fix.

Three steps against a single `ey_stock_analytics` row (the latest bar of one
stock, inside the 252-day window that `sync-sector-strength` used to wipe):

  A. write the row the way `sync-squeeze` does  -> squeeze columns populated
  B. write it the way the OLD `sync-sector-strength` did (default upsert
     semantics)                              -> squeeze columns wiped (the bug)
  C. write it the way the FIXED `sync-sector-strength` does
     (`preserve_existing=True`)               -> squeeze columns preserved

Run:  workers/yfinance/.venv/bin/python scripts/backtest/verify_squeeze_fix.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "workers" / "yfinance"
sys.path.insert(0, str(WORKER / "src"))
sys.path.insert(0, str(WORKER))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(WORKER / ".env")

from eyesinvest_worker.db.supabase import (  # noqa: E402
    fetch_active_stocks_with_sector,
    fetch_latest_short_sale,
    fetch_latest_short_interest,
    fetch_price_history,
    make_client,
    upsert_analytics_rows,
)
from eyesinvest_worker.models import SQUEEZE_COLUMNS  # noqa: E402
from eyesinvest_worker.providers.analytics import (  # noqa: E402
    ShortInterestInput,
    compute_analytics,
)

MARKET = sys.argv[1] if len(sys.argv) > 1 else "US"
client = make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
stocks = fetch_active_stocks_with_sector(client)


def read_squeeze(stock_id: str, as_of: str) -> dict:
    resp = (
        client.table("ey_stock_analytics")
        .select("squeeze_score,squeeze_dtc,squeeze_si_chg_1w")
        .eq("stock_id", stock_id)
        .eq("as_of_date", as_of)
        .execute()
    )
    return resp.data[0] if resp.data else {}


for s in stocks:
    if s.market != MARKET:
        continue
    bars = fetch_price_history(client, s.id)
    if not bars:
        continue
    si_rows = fetch_latest_short_interest(client, s.id, limit=2)
    if not si_rows:
        continue
    sale = fetch_latest_short_sale(client, s.id)
    inputs = [
        ShortInterestInput(
            short_interest=r["short_interest"],
            prior_short_interest=r.get("prior_short_interest"),
            change_pct=r.get("change_pct"),
        )
        for r in si_rows
    ]
    latest_sale = (
        (sale.get("am_short_volume"), sale.get("short_volume")) if sale else None
    )
    as_of = bars[-1]["trade_date"]

    squeeze_rows = compute_analytics(
        stock_id=s.id, bars=bars, short_interest_rows=inputs, latest_short_sale=latest_sale
    ).rows
    # The sector-strength payload: same indicators, but no squeeze inputs.
    sector_rows = compute_analytics(
        stock_id=s.id, bars=bars, shares_outstanding=s.shares_outstanding
    ).rows

    print(f"\n=== {s.symbol} ({MARKET}) as_of {as_of}")

    def squeeze_write() -> dict:
        upsert_analytics_rows(client, squeeze_rows)
        return read_squeeze(s.id, as_of)

    def show(tag: str, row: dict, verdict: str) -> None:
        print(f"   {tag}: score={row.get('squeeze_score')} dtc={row.get('squeeze_dtc')} "
              f"si={row.get('squeeze_si_chg_1w')} -> {verdict}")

    a = squeeze_write()
    print("A. sync-squeeze write …")
    show("", a, "populated" if a.get("squeeze_dtc") is not None else "MISSING")

    print("B. OLD sector-strength write (default_to_null=True) …")
    upsert_analytics_rows(client, sector_rows)
    b = read_squeeze(s.id, as_of)
    show("", b, "BUG REPRODUCED (wiped)" if b.get("squeeze_dtc") is None else "not wiped")

    print("C1. exclude squeeze cols only (default_to_null=True) …")
    squeeze_write()
    upsert_analytics_rows(client, sector_rows, exclude_columns=SQUEEZE_COLUMNS)
    c1 = read_squeeze(s.id, as_of)
    show("", c1, "PRESERVED" if c1.get("squeeze_dtc") is not None else "WIPED")

    print("C2. exclude squeeze cols + preserve_existing=True …")
    squeeze_write()
    upsert_analytics_rows(
        client, sector_rows, preserve_existing=True, exclude_columns=SQUEEZE_COLUMNS
    )
    c2 = read_squeeze(s.id, as_of)
    show("", c2, "PRESERVED" if c2.get("squeeze_dtc") is not None else "WIPED")

    print("D. exclude squeeze cols only, NO preserve, but payload keeps full score …")
    squeeze_write()
    upsert_analytics_rows(client, sector_rows, exclude_columns=SQUEEZE_COLUMNS)
    d = read_squeeze(s.id, as_of)
    show("", d, "PRESERVED" if d.get("squeeze_dtc") is not None else "WIPED")

    # leave the row in the correct (squeeze-populated) state
    final = squeeze_write()
    show("restored", final, "populated" if final.get("squeeze_dtc") is not None else "MISSING")
    break
