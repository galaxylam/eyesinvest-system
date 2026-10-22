"""Point-in-time signal panel + screener filter backtest engine.

Everything here mirrors production semantics:

* indicator formulas are copied from
  `workers/yfinance/src/eyesinvest_worker/providers/analytics.py`
* filter semantics are copied from
  `apps/web/src/lib/stocks/queries.ts :: applyScreenerFilters`
  (nulls never match; `>` / `<` boundaries match the UI dropdowns)

The one deliberate deviation is the squeeze score: the production worker
computes it once from *today's* short-interest snapshot and writes the same
number on every historical `as_of_date`. For a backtest that would be
look-ahead. Here the score is recomputed per date from data available on
that date (point-in-time). The HK morning-session component is dropped
(AM short volume only exists from 2026-08) so the signal stays uniform
across the whole history and across markets.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"

HOLD_DAYS = 21          # trading days held per position (≈ 1 month)
ENTRY_LAG = 1           # enter at the close of the next session after the signal


# ---------------------------------------------------------------------------
# Filter catalogue — every threshold is reachable from the live screener UI
# (dropdown values were read from `ScreenerFilters.tsx`), so each backtested
# combination can be pasted straight into a screener URL.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FilterValue:
    op: str          # ge | gt | le | lt | up | down
    threshold: float | None
    label: str
    ui_value: str    # screener query-param fragment


@dataclass(frozen=True)
class FilterSpec:
    key: str
    label: str
    values: tuple[FilterValue, ...]
    # the screener query param this filter writes to
    ui_param: str = ""


FILTERS: tuple[FilterSpec, ...] = (
    FilterSpec(
        "return1m", "1M return",
        (
            FilterValue("ge", 10.0, "≥ +10%", "ret1m=10"),
            FilterValue("ge", 20.0, "≥ +20%", "ret1m=20"),
            FilterValue("ge", 0.0, "≥ 0%", "ret1m=0"),
            FilterValue("le", 0.0, "≤ 0%", "ret1mmax=0"),
        ),
        "ret1m",
    ),
    FilterSpec(
        "crowded", "Crowded",
        (
            FilterValue("ge", 1.0, "≥ 1.0×", "crowd=1"),
            FilterValue("ge", 1.2, "≥ 1.2×", "crowd=1.2"),
            FilterValue("ge", 1.5, "≥ 1.5×", "crowd=1.5"),
            FilterValue("ge", 2.0, "≥ 2.0×", "crowd=2"),
        ),
        "crowd",
    ),
    FilterSpec(
        "squeeze", "Squeeze",
        (
            # The live dropdown offers 30/40/50/60/70. The three values
            # below are the ones with a usable sample size: ≥60 matches
            # ~0.3% of US stock-days (~9% of HK) and ≥70 matches almost
            # nothing — too thin to backtest. The score here is recomputed
            # point-in-time from the raw short data, so it is unaffected by
            # the production pipeline's write-order bug.
            FilterValue("ge", 30.0, "≥ 30 (Normal+)", "sq=30"),
            FilterValue("ge", 40.0, "≥ 40", "sq=40"),
            FilterValue("ge", 50.0, "≥ 50 (Elevated+)", "sq=50"),
        ),
        "sq",
    ),
    FilterSpec(
        "ma5", "MA5",
        (
            FilterValue("up", None, "rising", "ma5=up"),
            FilterValue("down", None, "falling", "ma5=down"),
        ),
        "ma5",
    ),
    FilterSpec(
        "ma20", "MA20",
        (
            FilterValue("up", None, "rising", "ma20=up"),
            FilterValue("down", None, "falling", "ma20=down"),
        ),
        "ma20",
    ),
    FilterSpec(
        "greenshare", "1M Green Share",
        (
            FilterValue("gt", 0.1, "> +10% green", "gs=0.1"),
            FilterValue("gt", 0.2, "> +20% green", "gs=0.2"),
            FilterValue("gt", 0.3, "> +30% green", "gs=0.3"),
            FilterValue("gt", 0.5, "> +50% green", "gs=0.5"),
        ),
        "gs",
    ),
    FilterSpec(
        "ease", "1M Push/Pull Ease",
        (
            FilterValue("lt", -0.1, "≤ −10% easy to push down", "ease=-0.1"),
            FilterValue("lt", -0.2, "≤ −20% easy to push down", "ease=-0.2"),
            FilterValue("lt", -0.3, "≤ −30% easy to push down", "ease=-0.3"),
            FilterValue("gt", 0.2, "≥ +20% easy to push up", "ease=0.2"),
        ),
        "ease",
    ),
    # --- added for the selectivity pass (both already live in the UI) ------
    FilterSpec(
        "eff", "Volume Efficiency",
        (
            FilterValue("ge", 0.5, "≥ 0.5×", "eff=0.5"),
            FilterValue("ge", 1.0, "≥ 1.0×", "eff=1"),
            FilterValue("ge", 2.0, "≥ 2.0×", "eff=2"),
        ),
        "eff",
    ),
    FilterSpec(
        "dd30", "30D Drawdown",
        (
            FilterValue("le", -0.1, "≤ −10%", "dd30=-10"),
            FilterValue("le", -0.2, "≤ −20%", "dd30=-20"),
            FilterValue("le", -0.3, "≤ −30%", "dd30=-30"),
            FilterValue("le", -0.4, "≤ −40%", "dd30=-40"),
        ),
        "dd30",
    ),
)

FILTER_BY_KEY = {f.key: f for f in FILTERS}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_raw() -> dict[str, pd.DataFrame]:
    stocks = pd.read_csv(DATA_DIR / "ey_stocks.csv.gz")
    prices = pd.read_csv(
        DATA_DIR / "ey_price_1d.csv.gz",
        parse_dates=["trade_date"],
        dtype={"stock_id": str, "volume": "float64"},
    )
    for col in ("open", "high", "low", "close"):
        prices[col] = prices[col].astype("float64")
    si = pd.read_csv(
        DATA_DIR / "ey_short_interest.csv.gz",
        parse_dates=["settlement_date"],
        dtype={"stock_id": str, "short_interest": "float64"},
    )
    ss = pd.read_csv(
        DATA_DIR / "ey_short_sale_1d.csv.gz",
        parse_dates=["trade_date"],
        dtype={"stock_id": str, "short_volume": "float64", "am_short_volume": "float64"},
    )
    return {"stocks": stocks, "prices": prices, "short_interest": si, "short_sale": ss}


# ---------------------------------------------------------------------------
# Indicator helpers (worker-identical)
# ---------------------------------------------------------------------------

def _green_red_share(open_: pd.Series, close: pd.Series, volume: pd.Series, window: int = 21) -> pd.Series:
    is_green = (close > open_).astype(float)
    is_red = (close < open_).astype(float)
    green = (volume * is_green).rolling(window, min_periods=window).sum()
    red = (volume * is_red).rolling(window, min_periods=window).sum()
    total = green + red
    return (green - red) / total.replace(0, np.nan)


def _green_red_ease(open_: pd.Series, close: pd.Series, volume: pd.Series, window: int = 21) -> pd.Series:
    is_green = (close > open_).astype(float)
    is_red = (close < open_).astype(float)
    up_move = (close - open_) * is_green
    down_move = (open_ - close) * is_red
    up_sum = up_move.rolling(window, min_periods=window).sum()
    down_sum = down_move.rolling(window, min_periods=window).sum()
    green_vol = (volume * is_green).rolling(window, min_periods=window).sum()
    red_vol = (volume * is_red).rolling(window, min_periods=window).sum()
    up_impact = up_sum / green_vol.replace(0, np.nan)
    down_impact = down_sum / red_vol.replace(0, np.nan)
    total = up_impact.fillna(0) + down_impact.fillna(0)
    return (up_impact.fillna(0) - down_impact.fillna(0)) / total.replace(0, np.nan)


def _max_drawdown(close: pd.Series, window: int = 30) -> pd.Series:
    rolling_max = close.rolling(window, min_periods=1).max()
    drawdown = close / rolling_max - 1.0
    return drawdown.rolling(window, min_periods=window).min()


def _volume_efficiency(
    close: pd.Series, volume: pd.Series, shares_outstanding: int | None
) -> pd.Series:
    """|daily change %| ÷ turnover % — worker-identical (analytics.py).

    Higher = more price impact per unit of turnover = thinner / harder to
    trade, so the screener's `Volume Efficiency ≥ X` filter selects the
    illiquid end of the range.
    """
    if shares_outstanding is None or shares_outstanding <= 0:
        return pd.Series(np.nan, index=close.index, dtype="float64")
    turnover_pct = volume / float(shares_outstanding) * 100.0
    prev = close.shift(1)
    daily_change_pct = (close - prev) / prev * 100.0
    return (daily_change_pct.abs() / turnover_pct.replace(0, np.nan))


def _clip01(x: float | None, lo: float, hi: float) -> float:
    if x is None or hi == lo:
        return 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def _squeeze_score(dtc: float | None, si_chg: float | None, drawdown: float | None,
                   vol_spike: float | None) -> float | None:
    """Worker formula, minus the HK-only AM component (see module docstring)."""
    drawdown_mag = -drawdown if drawdown is not None else None
    parts = [
        0.30 * _clip01(dtc, 0, 10),
        0.25 * _clip01(si_chg, -30, 30),
        0.20 * _clip01(drawdown_mag, 0, 0.30),
        0.15 * _clip01(vol_spike, 1, 5),
    ]
    if all(p == 0.0 for p in parts):
        return None
    return round(sum(parts) * 100.0, 2)


# ---------------------------------------------------------------------------
# Panel construction
# ---------------------------------------------------------------------------

@dataclass
class MarketPanel:
    market: str
    dates: list[pd.Timestamp]
    date_index: dict[pd.Timestamp, int]
    symbols: list[str]
    stock_index: dict[str, int]
    # numpy matrices, shape (n_dates, n_stocks)
    fields: dict[str, np.ndarray]
    masks: dict[tuple[str, int], np.ndarray]   # (filter_key, value_idx) -> bool matrix


def _point_in_time_short_interest(
    si: pd.DataFrame, trade_dates: pd.Series
) -> tuple[np.ndarray, np.ndarray]:
    """As-of-date short interest + 1-period % change for every trade date."""
    si = si.sort_values("settlement_date")
    settle = si["settlement_date"].to_numpy()
    si_val = si["short_interest"].to_numpy(dtype="float64")
    prior = si["prior_short_interest"].to_numpy(dtype="float64")
    chg = si["change_pct"].to_numpy(dtype="float64")

    out_si = np.full(len(trade_dates), np.nan)
    out_chg = np.full(len(trade_dates), np.nan)
    j = 0
    for i, d in enumerate(trade_dates):
        while j < len(settle) and settle[j] <= d.to_datetime64():
            j += 1
        if j == 0:
            continue
        k = j - 1
        out_si[i] = si_val[k]
        c = chg[k]
        if not np.isnan(c):
            out_chg[i] = c
        elif not np.isnan(prior[k]) and prior[k] > 0:
            out_chg[i] = (si_val[k] - prior[k]) / prior[k] * 100.0
        elif k >= 1 and si_val[k - 1] > 0:
            out_chg[i] = (si_val[k] - si_val[k - 1]) / si_val[k - 1] * 100.0
    return out_si, out_chg


def build_market_panel(raw: dict[str, pd.DataFrame], market: str) -> MarketPanel:
    stocks = raw["stocks"]
    stocks = stocks[(stocks["market"] == market) & (stocks["is_active"])]
    prices = raw["prices"].merge(stocks[["id", "symbol"]], left_on="stock_id", right_on="id")
    prices = prices.sort_values(["stock_id", "trade_date"])
    shares_by_id = (
        dict(zip(stocks["id"], stocks["shares_outstanding"]))
        if "shares_outstanding" in stocks.columns
        else {}
    )

    all_dates = sorted(prices["trade_date"].unique())
    date_index = {d: i for i, d in enumerate(all_dates)}
    symbols = sorted(stocks["symbol"].unique())
    stock_index = {s: i for i, s in enumerate(symbols)}
    n_dates, n_stocks = len(all_dates), len(symbols)

    field_names = (
        "close", "ret1m", "crowded", "squeeze", "ma5_slope", "ma20_slope",
        "share", "ease", "fwd21", "fwd63", "fwd21_nextclose", "drawdown30d",
        "eff",
    )
    fields: dict[str, np.ndarray] = {
        k: np.full((n_dates, n_stocks), np.nan) for k in field_names
    }

    si_all = raw["short_interest"]
    si_by_stock = {sid: g for sid, g in si_all.groupby("stock_id")}

    for stock_id, grp in prices.groupby("stock_id", sort=False):
        grp = grp.sort_values("trade_date")
        symbol = grp["symbol"].iloc[0]
        col = stock_index[symbol]
        dates = pd.to_datetime(grp["trade_date"]).reset_index(drop=True)
        close = grp["close"].reset_index(drop=True)
        open_ = grp["open"].reset_index(drop=True)
        volume = grp["volume"].reset_index(drop=True)

        ma5 = close.rolling(5).mean()
        ma20 = close.rolling(20).mean()
        ma5_vol = volume.rolling(5, min_periods=5).mean()
        ma30_vol = volume.rolling(30, min_periods=30).mean()
        crowded = ma5_vol / ma30_vol.replace(0, np.nan)

        ret1m = (close / close.shift(21) - 1.0) * 100.0
        share = _green_red_share(open_, close, volume)
        ease = _green_red_ease(open_, close, volume)
        dd30 = _max_drawdown(close, 30)
        shares = shares_by_id.get(stock_id)
        eff = _volume_efficiency(
            close, volume, int(shares) if shares is not None and not pd.isna(shares) else None
        )

        avg_vol30 = volume.rolling(30, min_periods=30).mean()
        si_rows = si_by_stock.get(stock_id)
        if si_rows is not None:
            si_val, si_chg = _point_in_time_short_interest(si_rows, dates)
        else:
            si_val = np.full(len(dates), np.nan)
            si_chg = np.full(len(dates), np.nan)

        squeeze = np.full(len(dates), np.nan)
        for i in range(len(dates)):
            dtc = None
            if not np.isnan(si_val[i]) and not np.isnan(avg_vol30.iloc[i]) and avg_vol30.iloc[i] > 0:
                dtc = si_val[i] / avg_vol30.iloc[i]
            sc = _squeeze_score(
                dtc,
                None if np.isnan(si_chg[i]) else float(si_chg[i]),
                None if pd.isna(dd30.iloc[i]) else float(dd30.iloc[i]),
                None if pd.isna(crowded.iloc[i]) else float(crowded.iloc[i]),
            )
            if sc is not None:
                squeeze[i] = sc

        # Forward returns. ENTRY_LAG=1 → enter at the close of the session
        # after the signal (no same-close lookahead), exit HOLD_DAYS later.
        # NB: pandas `shift(-k)` moves values FORWARD in time, so a negative
        # shift is what gives us a future value.
        entry = close.shift(-ENTRY_LAG)
        fwd21 = close.shift(-(ENTRY_LAG + HOLD_DAYS)) / entry - 1.0
        fwd63 = close.shift(-(ENTRY_LAG + 63)) / entry - 1.0
        fwd21_nextclose = close.shift(-HOLD_DAYS) / close - 1.0  # optimistic variant

        row_idx = np.array([date_index[d] for d in dates])
        for key, series in (
            ("close", close),
            ("ret1m", ret1m),
            ("crowded", crowded),
            ("ma5_slope", ma5.diff()),
            ("ma20_slope", ma20.diff()),
            ("share", share),
            ("ease", ease),
            ("drawdown30d", dd30),
            ("eff", eff),
            ("fwd21", fwd21),
            ("fwd63", fwd63),
            ("fwd21_nextclose", fwd21_nextclose),
        ):
            arr = np.asarray(series, dtype="float64")
            fields[key][row_idx, col] = arr
        fields["squeeze"][row_idx, col] = squeeze

    stacked = fields
    panel = MarketPanel(
        market=market,
        dates=[pd.Timestamp(d) for d in all_dates],
        date_index=date_index,
        symbols=symbols,
        stock_index=stock_index,
        fields=stacked,
        masks={},
    )
    panel.masks = build_masks(panel)
    return panel


# ---------------------------------------------------------------------------
# Filter masks
# ---------------------------------------------------------------------------

def build_masks(panel: MarketPanel) -> dict[tuple[str, int], np.ndarray]:
    f = panel.fields
    masks: dict[tuple[str, int], np.ndarray] = {}
    for spec in FILTERS:
        for vi, val in enumerate(spec.values):
            if spec.key == "return1m":
                base = f["ret1m"]
                if val.op == "ge":
                    m = np.isfinite(base) & (base >= val.threshold)
                else:
                    m = np.isfinite(base) & (base <= val.threshold)
            elif spec.key == "crowded":
                base = f["crowded"]
                if val.op == "ge":
                    m = np.isfinite(base) & (base >= val.threshold)
                else:
                    m = np.isfinite(base) & (base < val.threshold)
            elif spec.key == "squeeze":
                m = np.isfinite(f["squeeze"]) & (f["squeeze"] >= val.threshold)
            elif spec.key in ("ma5", "ma20"):
                base = f["ma5_slope"] if spec.key == "ma5" else f["ma20_slope"]
                if val.op == "up":
                    m = np.isfinite(base) & (base > 0)
                else:  # down
                    m = np.isfinite(base) & (base < 0)
            elif spec.key == "greenshare":
                base = f["share"]
                m = np.isfinite(base) & ((base > val.threshold) if val.op == "gt" else (base < val.threshold))
            elif spec.key == "ease":
                base = f["ease"]
                m = np.isfinite(base) & ((base > val.threshold) if val.op == "gt" else (base < val.threshold))
            elif spec.key == "eff":
                # `Volume Efficiency ≥ X` selects the illiquid end: the metric
                # is |daily change %| ÷ turnover %, so higher = thicker impact.
                base = f["eff"]
                m = np.isfinite(base) & (base >= val.threshold)
            elif spec.key == "dd30":
                # Drawdown is stored as a negative fraction; the UI encodes it
                # as a percent integer (dd30=-30 → -0.30 internally).
                base = f["drawdown30d"]
                m = np.isfinite(base) & (base <= val.threshold)
            else:  # pragma: no cover
                raise ValueError(f"unknown filter {spec.key}")
            masks[(spec.key, vi)] = m
    return masks


def mask_for(panel: MarketPanel, key: str, value_idx: int) -> np.ndarray:
    return panel.masks[(key, value_idx)]


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def _max_drawdown_pct(equity: np.ndarray) -> float:
    if equity.size == 0:
        return float("nan")
    peak = np.maximum.accumulate(equity)
    return float((equity / peak - 1.0).min())


def portfolio_metrics(period_returns: np.ndarray, periods_per_year: int = 12) -> dict:
    r = period_returns[np.isfinite(period_returns)]
    if r.size < 3:
        return {
            "sharpe": float("nan"), "cagr": float("nan"), "max_dd": float("nan"),
            "vol": float("nan"), "hit_rate": float("nan"), "n_periods": int(r.size),
            "mean_period": float(r.mean()) if r.size else float("nan"),
        }
    mean = float(r.mean())
    std = float(r.std(ddof=1))
    sharpe = mean / std * math.sqrt(periods_per_year) if std > 0 else float("nan")
    equity = np.cumprod(1.0 + r)
    years = r.size / periods_per_year
    cagr = (equity[-1] ** (1.0 / years) - 1.0) if years > 0 and equity[-1] > 0 else float("nan")
    return {
        "sharpe": sharpe,
        "cagr": cagr,
        "max_dd": _max_drawdown_pct(equity),
        "vol": std * math.sqrt(periods_per_year),
        "hit_rate": float((r > 0).mean()),
        "n_periods": int(r.size),
        "mean_period": mean,
    }


@dataclass
class ComboResult:
    market: str
    combo: tuple[tuple[str, int], ...]
    label: str
    n_filters: int
    # event study (overlapping, all signal dates)
    n_picks: int
    mean_fwd21: float
    median_fwd21: float
    win_rate: float
    t_stat: float          # date-clustered t-stat of the daily cross-sectional mean
    n_signal_dates: int
    # portfolio (non-overlapping 21-day holds, monthly rebalance)
    sharpe: float
    cagr: float
    max_dd: float
    vol: float
    hit_rate: float
    n_periods: int
    avg_picks: float
    excess_sharpe: float   # vs equal-weight universe benchmark
    # out-of-sample (second half of the sample)
    oos_sharpe: float
    oos_cagr: float
    oos_n_periods: int
    is_sharpe: float
    is_cagr: float


def evaluate_combo(
    panel: MarketPanel,
    combo: tuple[tuple[str, int], ...],
    rebalance_idx: np.ndarray,
    is_mask: np.ndarray | None = None,
) -> dict:
    mask = np.ones_like(panel.fields["fwd21"], dtype=bool)
    for key, vi in combo:
        mask &= mask_for(panel, key, vi)

    fwd = panel.fields["fwd21"]
    valid = mask & np.isfinite(fwd)

    # --- event study -------------------------------------------------------
    picks = fwd[valid]
    n_picks = int(picks.size)
    if n_picks:
        # date-clustered t-stat: average each signal date cross-sectionally,
        # then test the mean of that daily series (picks on the same day
        # are not independent observations).
        masked = np.where(valid, fwd, 0.0)
        counts = valid.sum(axis=1)
        sums = masked.sum(axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            daily_mean = np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
        daily_mean = daily_mean[np.isfinite(daily_mean)]
        if daily_mean.size > 2 and daily_mean.std(ddof=1) > 0:
            t_stat = float(daily_mean.mean() / (daily_mean.std(ddof=1) / math.sqrt(daily_mean.size)))
        else:
            t_stat = float("nan")
        mean_fwd = float(picks.mean())
        median_fwd = float(np.median(picks))
        win_rate = float((picks > 0).mean())
    else:
        t_stat = mean_fwd = median_fwd = win_rate = float("nan")
    n_signal_dates = int(valid.any(axis=1).sum())

    # --- portfolio ---------------------------------------------------------
    sel = rebalance_idx
    if is_mask is not None:
        sel = sel[is_mask[sel]]
    # port_full is aligned with `sel` (NaN = no position that period).
    port_full = np.full(len(sel), np.nan)
    counts_list = []
    for i, r in enumerate(sel):
        row_mask = valid[r]
        n = int(row_mask.sum())
        counts_list.append(n)
        if n:
            port_full[i] = float(fwd[r][row_mask].mean())
    port = port_full
    pm = portfolio_metrics(port)
    avg_picks = float(np.mean(counts_list)) if counts_list else float("nan")
    max_picks = int(max(counts_list)) if counts_list else 0
    invested = sum(1 for c in counts_list if c > 0)
    pct_periods_invested = invested / len(counts_list) if counts_list else float("nan")

    # --- live-screen size -------------------------------------------------
    # How many names the *current* screener shows for this combination: the
    # filter mask on the panel's last session (no forward return needed).
    cur_picks = int(mask[-1].sum())

    # Profit factor on the monthly portfolio series: gross gain ÷ gross loss.
    r = port[np.isfinite(port)]
    if r.size:
        gains = float(r[r > 0].sum())
        losses = float(-r[r < 0].sum())
        profit_factor = gains / losses if losses > 0 else float("nan")
    else:
        profit_factor = float("nan")

    return {
        "n_picks": n_picks,
        "mean_fwd21": mean_fwd,
        "median_fwd21": median_fwd,
        "win_rate": win_rate,
        "t_stat": t_stat,
        "n_signal_dates": n_signal_dates,
        **pm,
        "avg_picks": avg_picks,
        "max_picks": max_picks,
        "pct_periods_invested": pct_periods_invested,
        "cur_picks": cur_picks,
        "profit_factor": profit_factor,
        "_port": port,
        "_sel": sel,
    }


def all_combos(max_filters: int = 3) -> list[tuple[tuple[str, int], ...]]:
    """All ordered-free combinations of 1..max_filters filters with one value each."""
    out: list[tuple[tuple[str, int], ...]] = []
    for n in range(1, max_filters + 1):
        for keys in itertools.combinations([f.key for f in FILTERS], n):
            value_lists = [[(k, vi) for vi in range(len(FILTER_BY_KEY[k].values))] for k in keys]
            for combo in itertools.product(*value_lists):
                out.append(tuple(combo))
    return out


def combo_label(combo: tuple[tuple[str, int], ...]) -> str:
    parts = []
    for key, vi in combo:
        spec = FILTER_BY_KEY[key]
        parts.append(f"{spec.label} {spec.values[vi].label}")
    return " AND ".join(parts)


def combo_ui(combo: tuple[tuple[str, int], ...]) -> str:
    return " & ".join(
        f"{FILTER_BY_KEY[k].key}={FILTER_BY_KEY[k].values[vi].ui_value}" for k, vi in combo
    )


SCREENER_BASE = "https://eyesinvest-system-web.vercel.app"


def combo_url(combo: tuple[tuple[str, int], ...], market: str) -> str:
    """A paste-ready screener URL for this combination.

    The param names match `apps/web/src/app/[locale]/screener/page.tsx`
    (`parseFilters`) one-for-one, so the link and the dropdowns agree.
    """
    params = [f"market={market}"]
    for key, vi in combo:
        params.append(FILTER_BY_KEY[key].values[vi].ui_value)
    return f"{SCREENER_BASE}/en/screener?" + "&".join(params)
