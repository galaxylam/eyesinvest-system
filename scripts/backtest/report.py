"""Render the backtest payload into a self-contained HTML report."""

from __future__ import annotations

import html
import math
from pathlib import Path

CSS = """
:root {
  --bg: #0e1116; --panel: #161b22; --panel2: #1c2230; --line: #2a3242;
  --fg: #e6edf3; --muted: #8b98a9; --accent: #4c9aff; --good: #3fb950;
  --bad: #f85149; --warn: #d29922; --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 32px 22px 80px; }
h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
h2 { font-size: 19px; margin: 38px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
h3 { font-size: 15px; margin: 22px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
p { margin: 10px 0; }
.sub { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin: 18px 0 8px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.card .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.card .v { font-size: 22px; font-weight: 600; margin-top: 4px; font-family: var(--mono); }
.card .n { color: var(--muted); font-size: 12px; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 6px; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px;
  text-transform: uppercase; letter-spacing: .05em; padding: 8px 8px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--bg); }
td { padding: 7px 8px; border-bottom: 1px solid #1e2430; vertical-align: top; }
tr:hover td { background: #171d27; }
td.num, th.num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; }
.pos { color: var(--good); } .neg { color: var(--bad); } .mut { color: var(--muted); }
.tag { display: inline-block; padding: 1px 7px; border-radius: 20px; font-size: 11px;
  font-family: var(--mono); border: 1px solid var(--line); color: var(--muted); }
.tag.ok { color: var(--good); border-color: #1c5c31; background: #0f2716; }
.tag.no { color: var(--bad); border-color: #6b2222; background: #2a1414; }
.note { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 8px; padding: 12px 16px; color: #c9d4e2; font-size: 13px; }
.note ul { margin: 8px 0 0; padding-left: 18px; } .note li { margin: 4px 0; }
.mono { font-family: var(--mono); font-size: 12px; }
.small { font-size: 12px; color: var(--muted); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
.scroll { max-height: 560px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; }
details { margin: 12px 0; }
summary { cursor: pointer; color: var(--accent); font-size: 13px; }
.bar-row { display: grid; grid-template-columns: 260px 1fr 74px; gap: 10px; align-items: center;
  margin: 3px 0; font-size: 12.5px; }
.bar-track { background: #10151d; border-radius: 4px; height: 15px; position: relative; }
.bar-fill { position: absolute; top: 0; height: 15px; border-radius: 4px; }
.axis { color: var(--muted); font-size: 11px; font-family: var(--mono); }
svg text { fill: var(--muted); font-size: 10px; }
svg .lbl { fill: var(--fg); font-size: 11px; }
"""


def esc(x) -> str:
    return html.escape(str(x))


def fmt(x, digits=2, pct=False, sign=False):
    if x is None:
        return "—"
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "—"
    if not math.isfinite(v):
        return "—"
    if pct:
        v *= 100.0
    s = f"{v:+.{digits}f}" if sign else f"{v:.{digits}f}"
    return s + ("%" if pct else "")


def pctf(x, digits=1, sign=False) -> str:
    """Percent-safe formatter: None/NaN -> em dash."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "—"
    if not math.isfinite(v):
        return "—"
    return fmt(v * 100.0, digits, pct=False, sign=sign) + "%"


def credible(r) -> bool:
    """A finding only counts if the basket was big enough to be tradable."""
    return bool(r.get("credible"))


def fin(x) -> bool:
    """JSON round-trip turns NaN into None — treat both as 'no value'."""
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def cls(x) -> str:
    if x is None or not math.isfinite(float(x)):
        return "mut"
    return "pos" if float(x) > 0 else ("neg" if float(x) < 0 else "mut")


# ---------------------------------------------------------------------------
# SVG helpers
# ---------------------------------------------------------------------------

def bar_rows(items, width=520):
    """items: list of (label, value). Horizontal bars centred on zero."""
    if not items:
        return ""
    max_abs = max(abs(v) for _, v in items) or 1.0
    left, right = 250, 60
    bar_w = width - left - right
    mid = left + bar_w / 2
    out = [f'<svg viewBox="0 0 {width} {len(items) * 20 + 10}" width="100%" height="{len(items) * 20 + 10}">']
    zero_x = mid
    scale = (bar_w / 2) / max_abs
    out.append(f'<line x1="{zero_x:.1f}" y1="0" x2="{zero_x:.1f}" y2="{len(items) * 20 + 6}" stroke="#2a3242"/>')
    for i, (label, value) in enumerate(items):
        y = i * 20 + 4
        w = abs(value) * scale
        x = zero_x if value >= 0 else zero_x - w
        color = "#3fb950" if value >= 0 else "#f85149"
        out.append(f'<text class="lbl" x="{left - 8}" y="{y + 12}" text-anchor="end">{esc(label)}</text>')
        out.append(f'<rect x="{x:.1f}" y="{y}" width="{max(w, 1):.1f}" height="14" fill="{color}" opacity="0.75" rx="2"/>')
        out.append(f'<text x="{width - 52}" y="{y + 12}">{value:+.2f}</text>')
    out.append("</svg>")
    return "".join(out)


def scatter(points, width=560, height=340, title=""):
    """points: list of (x, y, label, highlight)"""
    if not points:
        return ""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    pad = 0.08
    xr = (xmax - xmin) or 1.0
    yr = (ymax - ymin) or 1.0
    xmin -= xr * pad; xmax += xr * pad
    ymin -= yr * pad; ymax += yr * pad
    m = 38

    def sx(v):
        return m + (v - xmin) / (xmax - xmin) * (width - m - 14)

    def sy(v):
        return height - m - (v - ymin) / (ymax - ymin) * (height - m - 14)

    out = [f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}">']
    out.append(f'<line x1="{sx(xmin):.1f}" y1="{sy(0):.1f}" x2="{sx(xmax):.1f}" y2="{sy(0):.1f}" stroke="#2a3242"/>')
    out.append(f'<line x1="{sx(0):.1f}" y1="{sy(ymin):.1f}" x2="{sx(0):.1f}" y2="{sy(ymax):.1f}" stroke="#2a3242"/>')
    out.append(f'<line x1="{sx(xmin):.1f}" y1="{sy(xmin):.1f}" x2="{sx(xmax):.1f}" y2="{sy(xmax):.1f}" stroke="#3fb950" stroke-dasharray="4 4" opacity="0.5"/>')
    for x, y, label, hi in points:
        r = 5 if hi else 2.6
        op = 0.95 if hi else 0.45
        color = "#4c9aff" if hi else "#6b7b91"
        out.append(f'<circle cx="{sx(x):.1f}" cy="{sy(y):.1f}" r="{r}" fill="{color}" opacity="{op}"/>')
        if hi:
            out.append(f'<text class="lbl" x="{sx(x) + 7:.1f}" y="{sy(y) - 6:.1f}">{esc(label[:44])}</text>')
    out.append(f'<text x="{m}" y="14">out-of-sample Sharpe →</text>')
    out.append(f'<text x="4" y="{height - 12}">in-sample Sharpe</text>')
    out.append("</svg>")
    return "".join(out)


def equity_chart(series, labels, width=760, height=280):
    """series: list of (name, values, color)"""
    all_vals = [v for _, vals, _ in series for v in vals if v is not None]
    if not all_vals:
        return ""
    lo, hi = min(all_vals), max(all_vals)
    lo = min(lo, 1.0)
    span = (hi - lo) or 1.0
    m = 30
    n = max(len(vals) for _, vals, _ in series)

    def sx(i):
        return m + (i / max(n - 1, 1)) * (width - m - 10)

    def sy(v):
        return height - m - ((v - lo) / span) * (height - m - 20)

    out = [f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}">']
    for frac in (0.0, 0.5, 1.0):
        v = lo + span * frac
        out.append(f'<line x1="{m}" y1="{sy(v):.1f}" x2="{width - 10}" y2="{sy(v):.1f}" stroke="#1e2430"/>')
        out.append(f'<text x="2" y="{sy(v) + 4:.1f}">{v:.2f}</text>')
    for name, vals, color in series:
        pts = " ".join(f"{sx(i):.1f},{sy(v):.1f}" for i, v in enumerate(vals) if v is not None)
        out.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="1.8"/>')
    out.append(f'<text x="{m}" y="14" class="lbl">growth of 1.00 (monthly rebalance, {HOLD_LABEL})</text>')
    out.append("</svg>")
    legend = "  ".join(
        f'<span style="color:{c}">● {esc(nm)}</span>' for nm, _, c in series
    )
    return "".join(out) + f'<div class="small" style="margin-top:-6px">{legend}</div>'


HOLD_LABEL = "21-session holds"


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _table(headers, rows, classes=None):
    """headers: list of (label, is_num). rows: list of list of html strings."""
    out = ["<table><thead><tr>"]
    for label, is_num in headers:
        out.append(f'<th class="{"num" if is_num else ""}">{esc(label)}</th>')
    out.append("</tr></thead><tbody>")
    for row in rows:
        out.append("<tr>")
        for i, cell in enumerate(row):
            is_num = headers[i][1]
            out.append(f'<td class="{"num " if is_num else ""}{classes[i] if classes else ""}">{cell}</td>')
        out.append("</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def write_report(payload: dict, out_path: Path) -> None:
    results = payload["results"]
    meta = payload["meta"]
    curves = payload.get("curves", {})
    markets = ["US", "HK"]

    by_market = {m: [r for r in results if r["market"] == m] for m in markets}
    parts: list[str] = []
    parts.append("<!doctype html><html lang='en'><head><meta charset='utf-8'>")
    parts.append("<meta name='viewport' content='width=device-width, initial-scale=1'>")
    parts.append("<title>EyesInvest — screener filter combination backtest</title>")
    parts.append(f"<style>{CSS}</style></head><body><div class='wrap'>")

    # --- header -----------------------------------------------------------
    parts.append("<h1>Screener filter combination backtest — US &amp; HK</h1>")
    parts.append(
        "<p class='sub'>Every combination of the 7 screener filters (1 filter, or 2–3 filters "
        "combined) is replayed over the full price history in the production database. "
        "Signal at close T, entry at the close of T+1, exit 21 sessions later, equal weight, "
        "rebalanced monthly.</p>"
    )
    cards = []
    for m in markets:
        mm = meta[m]
        cards.append(
            f"<div class='card'><div class='k'>{m} universe</div>"
            f"<div class='v'>{mm['n_stocks']}</div>"
            f"<div class='n'>{mm['first_date']} → {mm['last_date']} · {mm['n_rebalances']} monthly periods</div></div>"
        )
    n_combos = len(by_market["US"])
    cards.append(
        f"<div class='card'><div class='k'>combinations tested</div>"
        f"<div class='v'>{n_combos * 2}</div>"
        f"<div class='n'>{n_combos} per market (1–3 filters × 3 values each)</div></div>"
    )
    for m in markets:
        b = meta[m]["benchmark"]
        cards.append(
            f"<div class='card'><div class='k'>{m} equal-weight benchmark</div>"
            f"<div class='v'>{fmt(b['sharpe'])}</div>"
            f"<div class='n'>Sharpe · CAGR {pctf(b['cagr'], 1)}% · maxDD {pctf(b['max_dd'], 1)}%</div></div>"
        )
    parts.append("<div class='cards'>" + "".join(cards) + "</div>")

    # --- methodology ------------------------------------------------------
    parts.append("<div class='note'><b>Method &amp; caveats</b><ul>")
    parts.append(
        "<li>Indicators use the exact production formulas from "
        "<span class='mono'>workers/yfinance/src/eyesinvest_worker/providers/analytics.py</span>; "
        "filter comparisons mirror "
        "<span class='mono'>apps/web/src/lib/stocks/queries.ts :: applyScreenerFilters</span> "
        "(nulls never match a filter, <span class='mono'>&gt;</span>/<span class='mono'>&lt;</span> boundaries follow the UI).</li>"
    )
    parts.append(
        "<li>Signals are point-in-time: squeeze score is rebuilt for every date from the short-interest "
        "settlement known on that date, instead of the production worker's habit of writing today's "
        "score onto every historical row.</li>"
    )
    parts.append(
        "<li>Gross of costs in the main tables; the <span class='mono'>Sharpe net</span> column charges a "
        "25bp round trip once per monthly rebalance. No position sizing, no liquidity or market-cap "
        "screen — the pure signal test.</li>"
    )
    parts.append(
        "<li>Universe is the <i>currently active</i> stock list (survivorship bias) and the sample starts "
        "in 2023-08, so every figure is conditional on that 3-year window.</li>"
    )
    parts.append(
        f"<li><b>Multiple testing:</b> {n_combos * 2} combinations were scored. With so many trials, "
        "a positive Sharpe by itself is not evidence of edge — read the out-of-sample column "
        f"(last {meta['US']['oos_periods']} periods, from {meta['US']['oos_start']}) and prefer combinations "
        "that are positive in <i>both</i> halves.</li>"
    )
    parts.append("</ul></div>")

    # --- single filter matrix --------------------------------------------
    parts.append("<h2>1 · Single filters — the 7 × 3 matrix</h2>")
    parts.append(
        "<p class='sub'>Each filter alone, at each of its three values. "
        "Portfolio columns are the non-overlapping monthly backtest; "
        "<span class='mono'>t</span> is the date-clustered t-stat of the average forward 21-session return.</p>"
    )
    for m in markets:
        rows_ = sorted([r for r in by_market[m] if r["n_filters"] == 1],
                       key=lambda r: (r["sharpe"] if fin(r["sharpe"]) else -99), reverse=True)
        b = meta[m]["benchmark"]
        parts.append(f"<h3>{m} — Sharpe by single filter (benchmark {fmt(b['sharpe'])})</h3>")
        parts.append(bar_rows([(r["combo"], r["sharpe"]) for r in rows_
                                if fin(r["sharpe"])], width=560))
        body = []
        for r in rows_:
            body.append([
                esc(r["combo"]),
                f"<span class='{cls(r['sharpe'])}'>{fmt(r['sharpe'])}</span>",
                f"<span class='{cls(r['cagr'])}'>{pctf(r['cagr'], 1)}%</span>",
                f"<span class='{cls(r['max_dd'])}'>{pctf(r['max_dd'], 1)}%</span>",
                f"<span class='{cls(r['hit_rate'])}'>{pctf(r['hit_rate'], 0)}%</span>",
                fmt(r["avg_picks"], 1),
                f"<span class='{cls(r['t_stat'])}'>{fmt(r['t_stat'], 1)}</span>",
                pctf(r["mean_fwd21"], 2) + "%",
                f"<span class='{cls(r['oos_sharpe'])}'>{fmt(r['oos_sharpe'])}</span>",
            ])
        parts.append(_table(
            [("Filter", False), ("Sharpe", True), ("CAGR", True), ("MaxDD", True),
             ("Hit% ", True), ("Avg picks", True), ("t-stat", True), ("Avg fwd 21d", True), ("OOS Sharpe", True)],
            body,
        ))

    # --- pair matrix ------------------------------------------------------
    parts.append("<h2>2 · Filter pairs — best value combination per pair</h2>")
    parts.append(
        "<p class='sub'>For each of the 21 filter pairs, the strongest of the 9 value combinations "
        "(3 values × 3 values). Full 189-combination detail is in <span class='mono'>results.csv</span>.</p>"
    )
    for m in markets:
        parts.append(f"<h3>{m}</h3>")
        body = []
        pairs = sorted([r for r in by_market[m] if r["n_filters"] == 2 and credible(r)],
                       key=lambda r: (r["sharpe"] if fin(r["sharpe"]) else -99), reverse=True)
        seen = set()
        for r in pairs:
            key = tuple(sorted(x.split(" ")[0] for x in r["combo"].split(" AND ")))
            if key in seen:
                continue
            seen.add(key)
            body.append([
                esc(r["combo"]),
                f"<span class='{cls(r['sharpe'])}'>{fmt(r['sharpe'])}</span>",
                f"<span class='{cls(r['cagr'])}'>{pctf(r['cagr'], 1)}%</span>",
                f"<span class='{cls(r['max_dd'])}'>{pctf(r['max_dd'], 1)}%</span>",
                fmt(r["avg_picks"], 1),
                f"<span class='{cls(r['t_stat'])}'>{fmt(r['t_stat'], 1)}</span>",
                f"<span class='{cls(r['alpha_fwd21'])}'>{pctf(r['alpha_fwd21'] * 100, 2)}</span>",
                f"<span class='{cls(r['oos_sharpe'])}'>{fmt(r['oos_sharpe'])}</span>",
            ])
        parts.append(_table(
            [("Best combination", False), ("Sharpe", True), ("CAGR", True), ("MaxDD", True),
             ("Avg picks", True), ("t-stat", True), ("Alpha/mo", True), ("OOS Sharpe", True)],
            body,
        ))

    # --- headline results -------------------------------------------------
    parts.append("<h2>3 · Combinations with positive Sharpe and positive return</h2>")
    for m in markets:
        rows_ = [r for r in by_market[m]
                 if credible(r) and fin(r["sharpe"]) and r["sharpe"] > 0
                 and fin(r["cagr"]) and r["cagr"] > 0]
        robust = [r for r in rows_ if fin(r["oos_sharpe"]) and r["oos_sharpe"] > 0
                  and r["oos_n_periods"] >= 10]
        b = meta[m]["benchmark"]
        credible_n = sum(1 for r in by_market[m] if credible(r))
        parts.append(
            f"<h3>{m} — {credible_n} of {len(by_market[m])} combinations are statistically usable "
            f"(≥5 names per basket, ≥12 months with a position); {len(rows_)} of those beat zero on both "
            f"Sharpe and CAGR (benchmark Sharpe {fmt(b['sharpe'])}); {len(robust)} stay positive out-of-sample</h3>"
        )
        ranked = sorted(robust, key=lambda r: r["oos_sharpe"], reverse=True)[:25]
        body = []
        for r in ranked:
            excess = r["sharpe"] - b["sharpe"]
            body.append([
                esc(r["combo"]),
                str(r["n_filters"]),
                f"<span class='{cls(r['sharpe'])}'>{fmt(r['sharpe'])}</span>",
                f"<span class='{cls(excess)}'>{fmt(excess)}</span>",
                f"<span class='{cls(r['cagr'])}'>{pctf(r['cagr'], 1)}%</span>",
                f"<span class='{cls(r['max_dd'])}'>{pctf(r['max_dd'], 1)}%</span>",
                f"<span class='{cls(r['hit_rate'])}'>{pctf(r['hit_rate'], 0)}%</span>",
                fmt(r["avg_picks"], 1),
                f"<span class='{cls(r['t_stat'])}'>{fmt(r['t_stat'], 1)}</span>",
                f"<span class='{cls(r['oos_sharpe'])}'>{fmt(r['oos_sharpe'])}</span>",
                f"<span class='{cls(r['oos_cagr'])}'>{pctf(r['oos_cagr'], 1)}%</span>",
            ])
        parts.append(_table(
            [("Combination", False), ("#F", True), ("Sharpe", True), ("vs bmk", True),
             ("CAGR", True), ("MaxDD", True), ("Hit%", True), ("Avg picks", True),
             ("t-stat", True), ("OOS Sharpe", True), ("OOS CAGR", True)],
            body,
        ))
        if not body:
            parts.append("<p class='small'>No combination is positive in both the in-sample and out-of-sample halves.</p>")

    # --- overfit diagnostic ----------------------------------------------
    parts.append("<h2>4 · In-sample vs out-of-sample — how much of this is luck</h2>")
    parts.append(
        "<p class='sub'>Each dot is one combination. Points above the dashed diagonal keep their edge "
        "out of sample; points far below it were fitted to noise. The highlighted dots are the "
        "headline picks above.</p>"
    )
    for m in markets:
        head = {r["combo"] for r in sorted(
            [x for x in by_market[m] if credible(x) and fin(x["sharpe"]) and fin(x["oos_sharpe"])],
            key=lambda x: x["oos_sharpe"], reverse=True)[:8]}
        pts = []
        for r in by_market[m]:
            if not (fin(r["sharpe"]) and fin(r["oos_sharpe"])):
                continue
            if not credible(r):
                continue
            pts.append((r["sharpe"], r["oos_sharpe"], r["combo"], r["combo"] in head))
        parts.append(f"<h3>{m}</h3>")
        parts.append(scatter(pts))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if len(xs) > 2:
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            cov = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
            vx = sum((a - mx) ** 2 for a in xs) ** 0.5
            vy = sum((b - my) ** 2 for b in ys) ** 0.5
            corr = cov / (vx * vy) if vx and vy else float("nan")
            parts.append(
                f"<p class='small'>IS↔OOS Sharpe correlation <b>{fmt(corr, 2)}</b> over {len(xs)} combinations "
                f"· {sum(1 for a, b in zip(xs, ys) if b > 0)}/{len(xs)} keep a positive Sharpe out of sample.</p>"
            )

    # --- equity curves ----------------------------------------------------
    if curves:
        parts.append("<h2>5 · Equity curves — top out-of-sample combinations</h2>")
        for m in markets:
            items = curves.get(m) or []
            if not items:
                continue
            dates = meta[m]["rebalance_dates"]
            bench_vals = []
            run = 1.0
            for v in meta[m]["benchmark_port"]:
                if v is None:
                    bench_vals.append(None)
                    continue
                run *= (1 + v)
                bench_vals.append(run)
            series = [(f"top pick: {items[0]['label']}", [], "#4c9aff")]
            vals = []
            run = 1.0
            for v in items[0]["port"]:
                if v is None:
                    vals.append(None)
                    continue
                run *= (1 + v)
                vals.append(run)
            series[0] = (f"top pick: {items[0]['label']}", vals, "#4c9aff")
            series.append(("equal-weight universe", bench_vals, "#d29922"))
            parts.append(f"<h3>{m} — {items[0]['label']}</h3>")
            parts.append(equity_chart(series, dates))
            body = []
            for it in items:
                body.append([
                    esc(it["label"]),
                    f"<span class='{cls(it['sharpe'])}'>{fmt(it['sharpe'])}</span>",
                    f"<span class='{cls(it['cagr'])}'>{pctf(it['cagr'], 1)}%</span>",
                    f"<span class='{cls(it['oos_sharpe'])}'>{fmt(it['oos_sharpe'])}</span>",
                ])
            parts.append(_table(
                [("Combination", False), ("Sharpe", True), ("CAGR", True), ("OOS Sharpe", True)],
                body,
            ))

    # --- appendix: all combos --------------------------------------------
    parts.append("<h2>6 · Appendix — every combination</h2>")
    parts.append(
        "<p class='sub'>Full results for all "
        f"{n_combos * 2} combinations (also in <span class='mono'>results.csv</span> / "
        "<span class='mono'>results.json</span>).</p>"
    )
    for m in markets:
        rows_ = sorted(by_market[m], key=lambda r: (r["sharpe"] if fin(r["sharpe"]) else -99),
                       reverse=True)
        body = []
        for r in rows_:
            body.append([
                esc(r["combo"]),
                f"<span class='{cls(r['sharpe'])}'>{fmt(r['sharpe'])}</span>",
                f"<span class='{cls(r['cagr'])}'>{pctf(r['cagr'], 1)}%</span>",
                fmt(r["avg_picks"], 1),
                f"<span class='{cls(r['t_stat'])}'>{fmt(r['t_stat'], 1)}</span>",
                f"<span class='{cls(r['oos_sharpe'])}'>{fmt(r['oos_sharpe'])}</span>",
                "<span class='tag ok'>usable</span>" if credible(r) else "<span class='tag no'>thin</span>",
            ])
        parts.append(f"<h3>{m}</h3>")
        parts.append("<div class='scroll'>")
        parts.append(_table(
            [("Combination", False), ("Sharpe", True), ("CAGR", True), ("Avg picks", True),
             ("t-stat", True), ("OOS Sharpe", True), ("Sample", False)],
            body,
        ))
        parts.append("</div>")

    parts.append("</div></body></html>")
    out_path.write_text("".join(parts), encoding="utf-8")
