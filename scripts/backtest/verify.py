"""Independent verification of the backtest signal panel.

Re-implements the indicators from scratch (no `pipeline` import for the
maths) on a random sample of dates and compares the result against the
panel the backtest actually used. Any mismatch is a bug in the pipeline.

    workers/yfinance/.venv/bin/python scripts/backtest/verify.py
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline import build_market_panel, load_raw  # noqa: E402

SAMPLE_DATES = 6
SAMPLE_STOCKS = 12


def squeeze_score_from_scratch(si_change: float | None, dtc: float | None,
                               dd30: float | None, vol_spike: float | None) -> float | None:
    def clip(x, lo, hi):
        if x is None:
            return 0.0
        return max(0.0, min(1.0, (x - lo) / (hi - lo)))

    parts = [
        0.30 * clip(dtc, 0, 10),
        0.25 * clip(si_change, -30, 30),
        0.20 * clip(None if dd30 is None else -dd30, 0, 0.30),
        0.15 * clip(vol_spike, 1, 5),
    ]
    if all(p == 0.0 for p in parts):
        return None
    return round(sum(parts) * 100.0, 2)


def main() -> int:
    raw = load_raw()
    prices = raw["prices"].merge(raw["stocks"][["id", "symbol", "market"]],
                                 left_on="stock_id", right_on="id")
    prices = prices.sort_values(["stock_id", "trade_date"])
    si = raw["short_interest"].sort_values("settlement_date")

    failures = 0
    checked = 0

    for market in ("US", "HK"):
        panel = build_market_panel(raw, market)
        dates = [pd.Timestamp(d) for d in panel.dates]
        rng = random.Random(20261022)
        sample = rng.sample(range(60, len(dates) - 25), SAMPLE_DATES)

        for di in sample:
            day = dates[di]
            market_ids = set(raw["stocks"].loc[raw["stocks"]["market"] == market, "id"])
            sub = prices[(prices["trade_date"] == day) & (prices["stock_id"].isin(market_ids))]
            picked = rng.sample(list(sub["stock_id"].unique()), min(SAMPLE_STOCKS, sub["stock_id"].nunique()))

            for sid in picked:
                hist = prices[(prices["stock_id"] == sid) & (prices["trade_date"] <= day)]
                if len(hist) < 35:
                    continue
                hist = hist.sort_values("trade_date").reset_index(drop=True)
                o = hist["open"].astype(float)
                c = hist["close"].astype(float)
                v = hist["volume"].astype(float)

                ma5 = c.rolling(5).mean()
                ma20 = c.rolling(20).mean()
                crowded = (v.rolling(5).mean() / v.rolling(30).mean()).iloc[-1]
                ret1m = (c.iloc[-1] / c.iloc[-22] - 1) * 100 if len(c) >= 22 else np.nan

                is_green = (c > o).astype(float)
                is_red = (c < o).astype(float)
                win = hist.tail(21)
                og, cg, vg = win["open"].astype(float), win["close"].astype(float), win["volume"].astype(float)
                green_vol = (vg * (cg > og)).sum()
                red_vol = (vg * (cg < og)).sum()
                share = (green_vol - red_vol) / (green_vol + red_vol) if (green_vol + red_vol) > 0 else np.nan

                up = ((cg - og) * (cg > og)).sum()
                down = ((og - cg) * (cg < og)).sum()
                up_impact = up / green_vol if green_vol > 0 else 0.0
                down_impact = down / red_vol if red_vol > 0 else 0.0
                total_impact = up_impact + down_impact
                ease = (up_impact - down_impact) / total_impact if total_impact > 0 else np.nan

                dd = (c / c.rolling(30, min_periods=1).max() - 1.0).rolling(30, min_periods=30).min().iloc[-1]
                avg_vol30 = v.tail(30).mean()

                si_rows = si[(si["stock_id"] == sid) & (si["settlement_date"] <= day)]
                dtc = None
                si_chg = None
                if len(si_rows):
                    last = si_rows.iloc[-1]
                    dtc = float(last["short_interest"]) / avg_vol30 if avg_vol30 > 0 else None
                    if not np.isnan(last["change_pct"]):
                        si_chg = float(last["change_pct"])
                    elif not np.isnan(last["prior_short_interest"]) and last["prior_short_interest"] > 0:
                        si_chg = (float(last["short_interest"]) - float(last["prior_short_interest"])) / float(last["prior_short_interest"]) * 100
                    elif len(si_rows) >= 2 and si_rows.iloc[-2]["short_interest"] > 0:
                        si_chg = (float(last["short_interest"]) - float(si_rows.iloc[-2]["short_interest"])) / float(si_rows.iloc[-2]["short_interest"]) * 100
                sq = squeeze_score_from_scratch(si_chg, dtc, float(dd) if not pd.isna(dd) else None,
                                                float(crowded) if not pd.isna(crowded) else None)

                symbol = panel.symbols[panel.stock_index[
                    raw["stocks"].set_index("id").loc[sid, "symbol"]]]
                col = panel.stock_index[symbol]
                row = panel.date_index[day]

                checks = [
                    ("ret1m", ret1m, panel.fields["ret1m"][row, col]),
                    ("crowded", crowded, panel.fields["crowded"][row, col]),
                    ("share", share, panel.fields["share"][row, col]),
                    ("ease", ease, panel.fields["ease"][row, col]),
                    ("ma5_slope", ma5.diff().iloc[-1], panel.fields["ma5_slope"][row, col]),
                    ("ma20_slope", ma20.diff().iloc[-1], panel.fields["ma20_slope"][row, col]),
                    ("squeeze", sq, panel.fields["squeeze"][row, col]),
                ]
                for name, expected, actual in checks:
                    if expected is None or (isinstance(expected, float) and not np.isfinite(expected)):
                        continue
                    checked += 1
                    if actual is None or not np.isfinite(actual) or abs(float(actual) - float(expected)) > 1e-6:
                        failures += 1
                        print(f"MISMATCH {market} {symbol} {day.date()} {name}: "
                              f"scratch={expected} panel={actual}")

        print(f"{market}: checked {checked} values, {failures} mismatches")

    print(f"\n{'ALL CHECKS PASSED' if failures == 0 else f'{failures} MISMATCHES'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
