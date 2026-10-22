"""Verify the live screener's Squeeze filter after the pipeline fix.

Mirrors what `apps/web/src/lib/stocks/queries.ts` does: take the latest
analytics row per stock (as_of_date desc, first row wins) and apply the
`Squeeze ≥ N` bands offered by the UI dropdown.

Run:  workers/yfinance/.venv/bin/python scripts/backtest/verify_screener_squeeze.py
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "workers" / "yfinance"
sys.path.insert(0, str(WORKER / "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(WORKER / ".env")

from eyesinvest_worker.db.supabase import make_client  # noqa: E402

BANDS = [30, 40, 50, 60, 70, 80]

client = make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

stocks = client.table("ey_stocks").select("id,symbol,market,is_active").eq("is_active", True).execute()
meta = {r["id"]: r for r in stocks.data or []}

rows = (
    client.table("ey_stock_analytics")
    .select("stock_id,as_of_date,squeeze_score,squeeze_dtc,squeeze_si_chg_1w")
    .order("as_of_date", desc=True)
    .limit(200000)
    .execute()
)
latest: dict[str, dict] = {}
for r in rows.data or []:
    if r["stock_id"] not in latest:
        latest[r["stock_id"]] = r

print(f"stocks: {len(meta)}   analytics rows scanned: {len(rows.data or [])}   "
      f"stocks with a latest row: {len(latest)}")

by_market: dict[str, list[tuple[str, float]]] = {}
null_counts = Counter()
for sid, r in latest.items():
    m = meta.get(sid)
    if m is None:
        continue
    score = r.get("squeeze_score")
    if score is None:
        null_counts[m["market"]] += 1
        continue
    by_market.setdefault(m["market"], []).append((m["symbol"], float(score)))

for market in sorted(by_market):
    lst = sorted(by_market[market], key=lambda x: -x[1])
    scores = [s for _, s in lst]
    print(f"\n=== {market}: {len(lst)} scored stocks "
          f"(null score: {null_counts[market]})")
    print(f"    min {min(scores):.2f}  median {sorted(scores)[len(scores)//2]:.2f}  "
          f"max {max(scores):.2f}")
    for band in BANDS:
        n = sum(1 for s in scores if s >= band)
        print(f"    ≥ {band:>3}: {n:>4} stocks ({n/len(scores)*100:5.1f}%)")
    print("    top 10: " + ", ".join(f"{sym} {sc:.1f}" for sym, sc in lst[:10]))
