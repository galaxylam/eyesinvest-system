"""Run the screener-filter combination backtest for US and HK.

    workers/yfinance/.venv/bin/python scripts/backtest/run_backtest.py

Outputs (scripts/backtest/out/):
  results.csv          — every combination with its full metric set
  results.json         — same data + benchmark + run metadata
  report.html          — self-contained HTML report (open in a browser)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline import (  # noqa: E402
    FILTERS,
    HOLD_DAYS,
    MarketPanel,
    all_combos,
    build_market_panel,
    combo_label,
    combo_ui,
    combo_url,
    evaluate_combo,
    load_raw,
    portfolio_metrics,
)

OUT_DIR = Path(__file__).resolve().parent / "out"

WARMUP = 40          # sessions of indicator warm-up before the first rebalance
REBALANCE_STEP = HOLD_DAYS
TOP_CURVES = 12      # equity curves exported per market
MAX_FILTERS = 4      # how many filters may be combined in one strategy

# Credibility gate — a combination only counts as a finding if it actually
# produced a tradable basket often enough to measure.
MIN_AVG_PICKS = 5.0     # ≥5 names in the basket on a typical rebalance
MIN_PERIODS = 12        # ≥12 monthly periods with a position
MIN_PICKS = 500         # ≥500 stock-level observations behind the t-stat

# Selectivity gate — the "fewer, better names" shortlist the screener UI
# needs: a small basket on a typical rebalance, a non-empty screen today,
# and enough observations to trust the hit rate.
SELECTIVE_MAX_AVG_PICKS = 20.0
SELECTIVE_MIN_PICKS = 300
SELECTIVE_MIN_SIGNAL_DATES = 12
SELECTIVE_TOP = 40           # candidates carried into the shortlist per market

ROUND_TRIP_COST = 0.0025   # 25bp per round trip, charged once per monthly rebalance


def rebalance_indices(n_dates: int) -> np.ndarray:
    return np.arange(WARMUP, n_dates - (HOLD_DAYS + 2), REBALANCE_STEP)


def benchmark_port(panel: MarketPanel, sel: np.ndarray) -> np.ndarray:
    """Equal-weight universe — the market the filters have to beat."""
    fwd = panel.fields["fwd21"]
    out = np.full(len(sel), np.nan)
    for i, r in enumerate(sel):
        row = fwd[r]
        row = row[np.isfinite(row)]
        if row.size:
            out[i] = float(row.mean())
    return out


def run_market(panel: MarketPanel) -> tuple[pd.DataFrame, dict, list[dict]]:
    sel = rebalance_indices(len(panel.dates))
    bench_port = benchmark_port(panel, sel)
    bench = portfolio_metrics(bench_port)
    half = len(sel) // 2
    # Universe-average 21-session forward return — the "alpha" baseline every
    # filter has to beat, independent of how the market itself performed.
    all_fwd = panel.fields["fwd21"]
    universe_mean_fwd = float(np.nanmean(all_fwd))
    # Universe-wide hit rate — the baseline every combination's win rate has
    # to beat (a 55% hit rate is only interesting if the market does 45%).
    universe_win_rate = float((all_fwd[np.isfinite(all_fwd)] > 0).mean())

    combos = all_combos(max_filters=MAX_FILTERS)
    rows: list[dict] = []
    curves: list[dict] = []
    for combo in combos:
        res = evaluate_combo(panel, combo, sel)
        port = res.pop("_port")
        res.pop("_sel", None)
        is_metrics = portfolio_metrics(port[:half])
        oos_metrics = portfolio_metrics(port[half:])
        # Three-way walk-forward split: train (50%) → validation (25%) →
        # test (25%). Candidates are ranked on TRAIN only; validation and
        # test are then read as genuinely unseen evidence.
        q = len(port) // 4
        tr = portfolio_metrics(port[:half])
        va = portfolio_metrics(port[half:half + q])
        te = portfolio_metrics(port[half + q:])
        # cost-adjusted view — one round trip charged per monthly rebalance
        net_metrics = portfolio_metrics(port - ROUND_TRIP_COST)
        # three-way regime split — is the edge stable across sub-periods?
        seg = portfolio_metrics(port[: len(port) // 3])["sharpe"]
        seg2 = portfolio_metrics(port[len(port) // 3: 2 * len(port) // 3])["sharpe"]
        seg3 = portfolio_metrics(port[2 * len(port) // 3:])["sharpe"]
        credible = (
            res["avg_picks"] >= MIN_AVG_PICKS
            and res["n_periods"] >= MIN_PERIODS
            and res["n_picks"] >= MIN_PICKS
        )
        selective = (
            credible
            and res["avg_picks"] <= SELECTIVE_MAX_AVG_PICKS
            and res["cur_picks"] >= 1
            and res["n_picks"] >= SELECTIVE_MIN_PICKS
            and res["n_signal_dates"] >= SELECTIVE_MIN_SIGNAL_DATES
        )
        rows.append(
            {
                "market": panel.market,
                "n_filters": len(combo),
                "combo": combo_label(combo),
                "combo_ui": combo_ui(combo),
                "combo_url": combo_url(combo, panel.market),
                **res,
                "alpha_fwd21": res["mean_fwd21"] - universe_mean_fwd,
                "universe_mean_fwd21": universe_mean_fwd,
                "excess_win_rate": res["win_rate"] - universe_win_rate,
                "is_sharpe": is_metrics["sharpe"],
                "is_cagr": is_metrics["cagr"],
                "is_n_periods": is_metrics["n_periods"],
                "oos_sharpe": oos_metrics["sharpe"],
                "oos_cagr": oos_metrics["cagr"],
                "oos_n_periods": oos_metrics["n_periods"],
                "seg1_sharpe": seg,
                "seg2_sharpe": seg2,
                "seg3_sharpe": seg3,
                "train_sharpe": tr["sharpe"],
                "train_cagr": tr["cagr"],
                "val_sharpe": va["sharpe"],
                "val_cagr": va["cagr"],
                "test_sharpe": te["sharpe"],
                "test_cagr": te["cagr"],
                "test_n_periods": te["n_periods"],
                "excess_sharpe": (res["sharpe"] - bench["sharpe"]) if np.isfinite(res["sharpe"]) else float("nan"),
                "excess_cagr": (res["cagr"] - bench["cagr"]) if np.isfinite(res["cagr"]) else float("nan"),
                "net_sharpe": net_metrics["sharpe"],
                "net_cagr": net_metrics["cagr"],
                "credible": credible,
                "selective": selective,
            }
        )
        curves.append({"combo": combo, "label": combo_label(combo), "port": port.tolist()})

    df = pd.DataFrame(rows)
    meta = {
        "market": panel.market,
        "n_stocks": len(panel.symbols),
        "n_dates": len(panel.dates),
        "first_date": str(pd.Timestamp(panel.dates[0]).date()),
        "last_date": str(pd.Timestamp(panel.dates[-1]).date()),
        "n_rebalances": int(len(sel)),
        "is_periods": int(half),
        "oos_periods": int(len(sel) - half),
        "is_end": str(pd.Timestamp(panel.dates[sel[half - 1]]).date()),
        "oos_start": str(pd.Timestamp(panel.dates[sel[half]]).date()),
        "rebalance_dates": [str(pd.Timestamp(panel.dates[r]).date()) for r in sel],
        "benchmark": bench,
        "benchmark_net": portfolio_metrics(bench_port - ROUND_TRIP_COST),
        "benchmark_port": bench_port.tolist(),
        "benchmark_train": portfolio_metrics(bench_port[:half]),
        "benchmark_val": portfolio_metrics(bench_port[half:half + len(bench_port) // 4]),
        "benchmark_test": portfolio_metrics(bench_port[half + len(bench_port) // 4:]),
        "universe_mean_fwd21": universe_mean_fwd,
        "universe_win_rate": universe_win_rate,
    }
    return df, meta, curves


def build_shortlist(df: pd.DataFrame, meta: dict, market: str) -> list[dict]:
    """Candidates ranked on the TRAIN half only, then read out-of-sample.

    Ranking on the full sample (or on the OOS half) would contaminate the
    result with selection bias — with ~18k combinations tested, the top
    Sharpe of the full sample is mostly noise. The shortlist therefore
    selects on train and reports validation + test honestly.
    """
    d = df[(df["market"] == market) & df["selective"]].copy()
    d = d.sort_values("train_sharpe", ascending=False).head(SELECTIVE_TOP)
    bench_test = meta["benchmark_test"]["sharpe"]
    bench_val = meta["benchmark_val"]["sharpe"]
    out = []
    for _, r in d.iterrows():
        out.append(
            {
                "combo": r["combo"],
                "combo_ui": r["combo_ui"],
                "combo_url": r["combo_url"],
                "n_filters": int(r["n_filters"]),
                "avg_picks": float(r["avg_picks"]),
                "cur_picks": int(r["cur_picks"]),
                "train_sharpe": float(r["train_sharpe"]),
                "val_sharpe": float(r["val_sharpe"]),
                "test_sharpe": float(r["test_sharpe"]),
                "test_cagr": float(r["test_cagr"]),
                "oos_sharpe": float(r["oos_sharpe"]),
                "net_sharpe": float(r["net_sharpe"]),
                "sharpe": float(r["sharpe"]),
                "cagr": float(r["cagr"]),
                "max_dd": float(r["max_dd"]),
                "win_rate": float(r["win_rate"]),
                "excess_win_rate": float(r["excess_win_rate"]),
                "profit_factor": float(r["profit_factor"]),
                "t_stat": float(r["t_stat"]),
                "beats_bench_val": bool(np.isfinite(r["val_sharpe"]) and r["val_sharpe"] > bench_val),
                "beats_bench_test": bool(np.isfinite(r["test_sharpe"]) and r["test_sharpe"] > bench_test),
            }
        )
    return out


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("loading raw data...")
    raw = load_raw()

    frames = []
    metas = {}
    curve_payload = {}
    for market in ("US", "HK"):
        print(f"building {market} panel...")
        panel = build_market_panel(raw, market)
        print(f"  {market}: {len(panel.symbols)} stocks x {len(panel.dates)} sessions "
              f"({pd.Timestamp(panel.dates[0]).date()} -> {pd.Timestamp(panel.dates[-1]).date()})")
        df, meta, curves = run_market(panel)
        frames.append(df)
        metas[market] = meta
        bench = meta["benchmark"]
        print(f"  {market} benchmark: sharpe={bench['sharpe']:.2f} cagr={bench['cagr']*100:.1f}% "
              f"maxDD={bench['max_dd']*100:.1f}% periods={bench['n_periods']}")
        print(f"  {market} evaluated {len(df)} combinations")
        sel_df = df[df["selective"]]
        print(f"  {market} selective candidates (avg picks <= {SELECTIVE_MAX_AVG_PICKS:.0f}, "
              f"non-empty screen today): {len(sel_df)}")

        # top combos by OOS Sharpe get equity curves
        ranked = df[df["credible"]].sort_values("oos_sharpe", ascending=False).head(TOP_CURVES)
        by_label = {c["label"]: c["port"] for c in curves}
        curve_payload[market] = [
            {
                "label": row["combo"],
                "oos_sharpe": float(row["oos_sharpe"]),
                "sharpe": float(row["sharpe"]),
                "cagr": float(row["cagr"]),
                "port": by_label.get(row["combo"], []),
            }
            for _, row in ranked.iterrows()
            if np.isfinite(row["oos_sharpe"])
        ]

    results = pd.concat(frames, ignore_index=True)
    results.to_csv(OUT_DIR / "results.csv", index=False)
    print(f"wrote {OUT_DIR / 'results.csv'} ({len(results)} rows)")

    shortlists = {m: build_shortlist(results, metas[m], m) for m in ("US", "HK")}
    for m, sl in shortlists.items():
        bt = metas[m]["benchmark_test"]["sharpe"]
        bv = metas[m]["benchmark_val"]["sharpe"]
        keep = [c for c in sl if c["beats_bench_val"] and c["beats_bench_test"]]
        print(f"  {m} shortlist: {len(sl)} train-ranked, {len(keep)} also beat the benchmark "
              f"on both unseen halves (val>{bv:.2f}, test>{bt:.2f})")

    payload = {
        "meta": metas,
        "filters": [
            {
                "key": f.key,
                "label": f.label,
                "values": [{"label": v.label, "ui": v.ui_value} for v in f.values],
            }
            for f in FILTERS
        ],
        "hold_days": HOLD_DAYS,
        "max_filters": MAX_FILTERS,
        "n_combos_per_market": int(len(results) / 2),
        "selective": {
            "max_avg_picks": SELECTIVE_MAX_AVG_PICKS,
            "min_picks": SELECTIVE_MIN_PICKS,
            "min_signal_dates": SELECTIVE_MIN_SIGNAL_DATES,
        },
        "shortlist": shortlists,
        "results": json.loads(results.to_json(orient="records")),
        "curves": curve_payload,
    }
    (OUT_DIR / "results.json").write_text(json.dumps(payload, indent=1))
    print(f"wrote {OUT_DIR / 'results.json'}")

    from report import write_report  # noqa: E402

    write_report(payload, OUT_DIR / "report.html")
    print(f"wrote {OUT_DIR / 'report.html'}")

    from summary_md import build as build_md  # noqa: E402

    doc = Path(__file__).resolve().parents[2] / "docs" / "BACKTEST_FILTER_COMBINATIONS.md"
    doc.write_text(build_md(payload), encoding="utf-8")
    print(f"wrote {doc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
