"""Reproduce live screener URLs against production data, using the app's own
filter semantics (`apps/web/src/lib/stocks/queries.ts :: applyScreenerFilters`).

For each candidate URL it reports how many names the screen actually shows
today and lists them — the number the user cares about ("too many results").

Run:  workers/yfinance/.venv/bin/python scripts/backtest/verify_live_screens.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "workers" / "yfinance"
sys.path.insert(0, str(WORKER / "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(WORKER / ".env")

from eyesinvest_worker.db.supabase import make_client  # noqa: E402

# (label, market, filters) — filters mirror ScreenerFilters' semantics
CASES = [
    ("user's current screen", "US", {"gs": 0.1, "sq": 30}),
    ("US: crowded + strong green", "US", {"crowd": 1.2, "gs": 0.3}),
    ("US: reversal + green", "US", {"ret1mmax": 0, "gs": 0.2}),
    ("US: reversal + green + dd30", "US", {"ret1mmax": 0, "gs": 0.2, "dd30": -10}),
    ("US: green only", "US", {"gs": 0.2}),
    ("US: MA20 down + green", "US", {"ma20": "down", "gs": 0.1}),
    ("HK: crowded + green + eff", "HK", {"crowd": 2, "gs": 0.1, "eff": 0.5}),
    ("HK: momentum + ease + eff + dd", "HK", {"ret1m": 10, "ease": -0.1, "eff": 1, "dd30": -10}),
    ("HK: crowded + green", "HK", {"crowd": 1.2, "gs": 0.2}),
    ("HK: crowded + green + dd30", "HK", {"crowd": 1.2, "gs": 0.2, "dd30": -10}),
]

client = make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

stocks = client.table("ey_stocks").select("id,symbol,market,is_active").eq("is_active", True).execute()
meta = {r["id"]: r for r in stocks.data or []}

rows = (
    client.table("ey_stock_analytics")
    .select(
        "stock_id,as_of_date,return_1m,crowded_ratio,volume_efficiency,max_drawdown_30d,"
        "green_red_volume_share_1m,green_red_impact_ease_1m,squeeze_score,ma5_slope,ma20_slope"
    )
    .order("as_of_date", desc=True)
    .limit(100000)
    .execute()
)
latest: dict[str, dict] = {}
for r in rows.data or []:
    latest.setdefault(r["stock_id"], r)


def num(v):
    return None if v is None else float(v)


def passes(r: dict, f: dict) -> bool:
    ret1m = num(r.get("return_1m"))
    crowded = num(r.get("crowded_ratio"))
    eff = num(r.get("volume_efficiency"))
    dd30 = num(r.get("max_drawdown_30d"))
    share = num(r.get("green_red_volume_share_1m"))
    ease = num(r.get("green_red_impact_ease_1m"))
    sq = num(r.get("squeeze_score"))

    if "ret1m" in f and (ret1m is None or ret1m < f["ret1m"]):
        return False
    if "ret1mmax" in f and (ret1m is None or ret1m > f["ret1mmax"]):
        return False
    if "crowd" in f and (crowded is None or crowded < f["crowd"]):
        return False
    if "eff" in f and (eff is None or eff < f["eff"]):
        return False
    if "dd30" in f and (dd30 is None or dd30 > f["dd30"] / 100.0):
        return False
    if "sq" in f and (sq is None or sq < f["sq"]):
        return False
    if "gs" in f:
        if share is None:
            return False
        if f["gs"] > 0 and share <= f["gs"]:
            return False
        if f["gs"] < 0 and share >= f["gs"]:
            return False
    if "ease" in f:
        if ease is None:
            return False
        if f["ease"] > 0 and ease <= f["ease"]:
            return False
        if f["ease"] < 0 and ease >= f["ease"]:
            return False
    for ma in ("ma5", "ma20"):
        if ma in f:
            slope = num(r.get(f"{ma}_slope"))
            if slope is None:
                return False
            if f[ma] == "up" and slope <= 0:
                return False
            if f[ma] == "down" and slope >= 0:
                return False
    return True


for label, market, f in CASES:
    hits = []
    for sid, r in latest.items():
        m = meta.get(sid)
        if not m or m["market"] != market:
            continue
        if passes(r, f):
            hits.append((m["symbol"], r))
    hits.sort(key=lambda x: -(num(x[1].get("squeeze_score")) or 0))
    url = "https://eyesinvest-system-web.vercel.app/en/screener?" + "&".join(
        [f"market={market}"] + [f"{k}={v}" for k, v in f.items()]
    )
    print(f"\n{label}: {len(hits)} names today")
    print(f"  {url}")
    for sym, r in hits[:12]:
        print(f"    {sym:<10} sq={num(r.get('squeeze_score'))} ret1m={num(r.get('return_1m'))} "
              f"crowd={num(r.get('crowded_ratio'))} gs={num(r.get('green_red_volume_share_1m'))} "
              f"eff={num(r.get('volume_efficiency'))} dd30={num(r.get('max_drawdown_30d'))} "
              f"ease={num(r.get('green_red_impact_ease_1m'))}")
