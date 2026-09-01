"""Compute technical indicators + risk metrics from OHLC history.

Pure pandas / numpy — no external TA library. Indicators implemented:

  - Moving averages:        MA20, MA50, MA200 (close-based, simple)
  - RSI(14):                Wilder smoothing
  - MACD(12, 26, 9):        EMA-based
  - Volatility(30d):        stdev of log returns × sqrt(252)
  - Max drawdown(30d):      peak-to-trough, negative fraction
  - Trailing returns:       1m, 3m, 6m, 1y close / close - 1
  - Volume efficiency:      |changePct| / (volume / shares × 100) per day
  - Crowded ratio:          MA5(volume) / MA30(volume) per day
  - Relative strength:      trailing return − market return (1m only,
                            populated on the most-recent row only — we
                            only refetch current SPX/HSI bars)
  - MA slopes:              MA5_slope, MA20_slope — signed delta vs the
                            prior trading day, used by the screener
                            trend filters
  - Green/red volume ratio: trailing 30d mean(volume on up-bars) ÷
                            mean(volume on down-bars); used by the
                            screener "1M green ≥ N% higher than red"
                            filter

The worker reads `ey_price_1d` for each stock, computes these for every
trading day that has enough history, and upserts the result. Indicators
that don't have enough lookback return null.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from eyesinvest_worker.models import StockAnalyticsRow


# ---------- helpers ----------------------------------------------------------

@dataclass
class ShortInterestInput:
    """Minimal SI input passed by sync-squeeze — desc-sorted, length >= 1.

    Mirrors `ey_short_interest` row shape but only the columns the squeeze
    formula needs. `change_pct` is FINRA-API populated; CDN-only rows have
    it NULL and `_si_change_pct_1w` falls back to a derivation against
    `prior_short_interest`.
    """

    short_interest: int
    prior_short_interest: int | None = None  # NULL when only 1 SI row available
    change_pct: float | None = None


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI."""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    # Wilder smoothing = EMA with alpha=1/period.
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _annualized_vol(close: pd.Series, window: int = 30) -> pd.Series:
    """Annualized 30-day volatility. Stays float64 throughout so
    `.rolling().std()` doesn't trip on object dtype."""
    # np.log keeps dtype as float64 even when the leading value is NaN.
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(window, min_periods=window).std() * math.sqrt(252)


def _max_drawdown(close: pd.Series, window: int = 30) -> pd.Series:
    """Rolling max drawdown — most negative peak-to-trough over `window` days."""
    rolling_max = close.rolling(window, min_periods=1).max()
    drawdown = close / rolling_max - 1.0
    return drawdown.rolling(window, min_periods=window).min()


def _return_n(close: pd.Series, days: int) -> pd.Series:
    """Trailing return over `days` bars. Stored as **percent** (already-scaled),
    e.g. +37.6 not 0.376 — matches what `formatSignedPercent` expects."""
    shifted = close.shift(days)
    return (close / shifted - 1.0) * 100.0


def _volume_efficiency(
    close: pd.Series, volume: pd.Series, shares_outstanding: int | None
) -> pd.Series:
    """|changePct| / (volume / sharesOutstanding × 100) per row.

    Returns an all-NaN series when `shares_outstanding` is missing or zero
    (no float data). The chart contract treats NaN as "no value today".
    """
    if shares_outstanding is None or shares_outstanding <= 0:
        return pd.Series(np.nan, index=close.index, dtype="float64")
    turnover_pct = volume / float(shares_outstanding) * 100.0
    prev = close.shift(1)
    daily_change_pct = (close - prev) / prev * 100.0
    # turnover can be 0 on a no-trade day → divide produces inf → NaN.
    return (daily_change_pct.abs() / turnover_pct.replace(0, np.nan))


def _crowded_ratio(volume: pd.Series) -> pd.Series:
    """MA5(volume) / MA30(volume) per day. Matches the existing chart definition
    in `apps/web/src/lib/stocks/queries.ts:853-937`.

    First 4 days have no MA5, first 29 days have no MA30 — both produce NaN,
    which `_maybe_float` coerces to null in the row.
    """
    ma5 = volume.rolling(5, min_periods=5).mean()
    ma30 = volume.rolling(30, min_periods=30).mean()
    return ma5 / ma30.replace(0, np.nan)


def _relative_strength(
    stock_return_pct: float | None, market_return_pct: float | None
) -> float | None:
    """stock_return − market_return, both in percent points. Returns None if
    either input is missing (no fallback math — preserves the "no benchmark"
    signal all the way through to the UI)."""
    if stock_return_pct is None or market_return_pct is None:
        return None
    return round(stock_return_pct - market_return_pct, 6)


def _green_red_volume_ratio_1m(
    open_: pd.Series, close: pd.Series, volume: pd.Series, window: int = 30,
) -> pd.Series:
    """Trailing-30-day ratio of mean(volume on up-bars) to mean(volume on
    down-bars). NaN when no green or no red bars are present in the window
    — preserves the "no signal" state all the way to the UI.

    Bars where close == open (dojis) are excluded from both sides; they
    don't move the price and shouldn't move the ratio either.
    """
    is_green = (close > open_).astype(float)
    is_red = (close < open_).astype(float)
    green_vol_sum = (volume * is_green).rolling(window, min_periods=window).sum()
    red_vol_sum = (volume * is_red).rolling(window, min_periods=window).sum()
    green_count = is_green.rolling(window, min_periods=window).sum()
    red_count = is_red.rolling(window, min_periods=window).sum()
    green_avg = green_vol_sum / green_count.replace(0, np.nan)
    red_avg = red_vol_sum / red_count.replace(0, np.nan)
    return green_avg / red_avg.replace(0, np.nan)


def _green_red_volume_share_1m(
    open_: pd.Series, close: pd.Series, volume: pd.Series, window: int = 21,
) -> pd.Series:
    """Trailing-21-day signed share of total volume on the dominant side.

        green_share = sum(volume on up-bars) / (sum on up + sum on down)

    Signed so the sign carries the colour zone and the magnitude carries
    how decisively one side is winning:

      * share >= 0.5 (green dominant) → result = +green_share
      * share  < 0.5 (red   dominant) → result = -red_share

    Range [-1, 1] (was [0, 1]). NaN when the window has no up or no down
    bars (no green-or-red signal to share against).

    The sign is what the screener and stocks page compare to classify a
    row as "in green" (value > 0) or "in red" (value < 0), and the
    magnitude is the side that's winning — so "> +50%" means
    green-share > 50% (strong green) and "< -50%" means red-share > 50%
    (strong red). A row that's "in red" can never appear under a green
    filter option (or vice-versa) regardless of the threshold.

    Window matches the stocks page Range picker's "1M" definition
    (RANGE_DAYS['1M'] = 21 trading days).

    Differs from `_green_red_volume_ratio_1m` (avg_green / avg_red) by
    weighting: a single huge-volume day moves `share` dramatically but
    barely moves `ratio`. Both metrics are complementary.

    Dojis (close == open) are excluded from both sides; they don't move
    the price and shouldn't move the share either.
    """
    is_green = (close > open_).astype(float)
    is_red = (close < open_).astype(float)
    green_vol_sum = (volume * is_green).rolling(window, min_periods=window).sum()
    red_vol_sum = (volume * is_red).rolling(window, min_periods=window).sum()
    total = green_vol_sum + red_vol_sum
    # total == 0 → window was all dojis / missing volume; NaN propagates.
    green_share = green_vol_sum / total.replace(0, np.nan)
    # Sign: +1 when green dominant, -1 when red dominant. Magnitude is the
    # dominant side's share (green_share for green-dominant, 1-green_share
    # for red-dominant). Boundary (== 0.5) counts as green-dominant to
    # preserve the old `>= 0.5` classification.
    sign = np.where(green_share >= 0.5, 1.0, -1.0)
    magnitude = np.where(green_share >= 0.5, green_share, 1.0 - green_share)
    return pd.Series(sign * magnitude, index=green_share.index)


def _green_red_impact_ease_1m(
    open_: pd.Series, close: pd.Series, volume: pd.Series, window: int = 21,
) -> pd.Series:
    """Trailing-21-day SIGNED ease-of-push score in [-1, 1].

    Captures the classical "use the same 1 dollar, how far can the stock
    be pushed up vs down" theory. Companion to
    `_green_red_volume_share_1m`:
      * share → where the volume went (effort distribution)
      * ease  → how efficiently the volume moved the price (push efficiency)

        up_impact   = Σ(close − open) / Σ(volume)   on close>open bars
        down_impact = Σ(open − close) / Σ(volume)   on close<open bars
        ease        = (up_impact − down_impact)
                      / (up_impact + down_impact)

    Both impacts are positive magnitudes; the ratio cancels absolute
    price/volume scale, yielding a normalized ease score:
      * ease > 0 → 1 dollar pushes the stock further up than down
                   (buyers had an easier time during the window)
      * ease < 0 → 1 dollar pushes the stock further down than up
                   (sellers had an easier time during the window)
      * ease = +1 / −1 → one-sided window (all up-bars or all down-bars)

    NaN when the window has no up or no down bars (no signal), or when
    both impacts are zero (degenerate window — both sides present but
    no price change).

    Dojis (close == open) are excluded from both sides; they contribute
    no price move and shouldn't shift the ease calculation.
    """
    is_green = (close > open_).astype(float)
    is_red = (close < open_).astype(float)

    # Per-bar contribution to (close − open) on each side; dojis contribute
    # 0 to both because the gating masks them out before multiplication.
    up_move = (close - open_) * is_green
    down_move = (open_ - close) * is_red

    up_move_sum = up_move.rolling(window, min_periods=window).sum()
    down_move_sum = down_move.rolling(window, min_periods=window).sum()
    green_vol_sum = (volume * is_green).rolling(window, min_periods=window).sum()
    red_vol_sum = (volume * is_red).rolling(window, min_periods=window).sum()

    # Volume-weighted impact per dollar of trading on each side. 0 in the
    # denominator → that side had no bars in the window → NaN propagates.
    up_impact = up_move_sum / green_vol_sum.replace(0, np.nan)
    down_impact = down_move_sum / red_vol_sum.replace(0, np.nan)
    # Fill NaN with 0 BEFORE summing so one-sided windows collapse to
    # ±1 instead of NaN: if only the up-side has impact, total_impact
    # becomes `up_impact + 0 = up_impact` and the ratio is +1; symmetric
    # for the down-only case. The denominator still rejects the truly
    # degenerate windows (both sides empty, or both impacts zero).
    total_impact = up_impact.fillna(0) + down_impact.fillna(0)
    diff = up_impact.fillna(0) - down_impact.fillna(0)

    # Symmetric ratio: +1 means "all impact came from up-side",
    # −1 means "all impact came from down-side". When total_impact is 0
    # (both sides had zero price change), result is NaN — that's a
    # degenerate window, not a "perfectly symmetric" signal.
    return diff / total_impact.replace(0, np.nan)


# ----- Phase 3+ squeeze-score helpers ----------------------------------------


def _days_to_cover(
    short_interest: int | None, avg_daily_volume_30d: float | None,
) -> float | None:
    """DTC = SI / 30d avg daily volume. None when either input missing or
    avg volume is non-positive (no trading days in window)."""
    if short_interest is None or avg_daily_volume_30d is None or avg_daily_volume_30d <= 0:
        return None
    return round(short_interest / avg_daily_volume_30d, 2)


def _si_change_pct_1w(rows: list[ShortInterestInput]) -> float | None:
    """Prioritized derivation:
      1. ``rows[0].change_pct`` if FINRA API populated it.
      2. Otherwise compute ``(latest - prior) / prior * 100`` from the
         row's own ``prior_short_interest`` column (FINRA gives this even
         on CDN-only paths).
      3. Otherwise derive from ``rows[1].short_interest`` when the worker
         pulled 2+ rows (the CDN-only path stores this implicitly).
      4. None when no prior settlement is available.
    """
    if not rows:
        return None
    latest = rows[0]
    if latest.change_pct is not None:
        return latest.change_pct
    if latest.prior_short_interest is not None and latest.prior_short_interest > 0:
        return round(
            (latest.short_interest - latest.prior_short_interest)
            / latest.prior_short_interest * 100.0, 4,
        )
    if len(rows) >= 2 and rows[1].short_interest > 0:
        return round(
            (latest.short_interest - rows[1].short_interest)
            / rows[1].short_interest * 100.0, 4,
        )
    return None


def _am_ratio(
    am_short_volume: int | None, full_short_volume: int | None,
) -> float | None:
    """HK-only AM share of full-day short volume (%). None when either
    input is missing or full_short_volume is non-positive (no full-day row
    captured yet — same case as the AM overlap bar missing in the UI)."""
    if am_short_volume is None or full_short_volume is None or full_short_volume <= 0:
        return None
    return round(am_short_volume / full_short_volume * 100.0, 2)


def _volume_spike(volume: pd.Series, short_window: int = 5, long_window: int = 30) -> pd.Series:
    """mean(volume[-short_window:]) ÷ mean(volume[-long_window:]). NaN
    until either rolling mean has enough history (5 days / 30 days).
    """
    ma_short = volume.rolling(short_window, min_periods=short_window).mean()
    ma_long = volume.rolling(long_window, min_periods=long_window).mean()
    return ma_short / ma_long.replace(0, np.nan)


def _clip01(x: float | None, lo: float, hi: float) -> float:
    """Linear-normalise ``x`` from ``[lo, hi]`` to ``[0, 1]`` and clip.

    None contributes 0 — caller decides whether to write NULL or 0.
    """
    if x is None or hi == lo:
        return 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def _squeeze_score(
    dtc: float | None,
    si_chg_1w: float | None,
    drawdown: float | None,
    vol_spike: float | None,
    am_ratio: float | None,
) -> float | None:
    """0..100 composite. None when every component is None — the caller
    surfaces "no data" instead of a misleading 0.

    Components (each normalised to [0, 1]):
      0.30 × DTC        (0..10 trading days)
      0.25 × SI Δ 1W    (-30..+30 %)
      0.20 × |drawdown| (0..30 % of peak; drawdown is fed in already-negative)
      0.15 × vol spike  (1×..5×)
      0.10 × AM ratio   (40..80 %, HK only — null for US)
    """
    # drawdown is a negative fraction (e.g. -0.18 = -18%). The component
    # wants "how deep is the drawdown?" — i.e. magnitude, normalised over
    # a 0..0.30 (0%..30%) range. Feed -drawdown when the caller passed
    # the raw value.
    drawdown_mag = -drawdown if drawdown is not None else None
    parts = [
        0.30 * _clip01(dtc,           0,   10),
        0.25 * _clip01(si_chg_1w,   -30,   30),
        0.20 * _clip01(drawdown_mag,  0, 0.30),  # fraction, not percent
        0.15 * _clip01(vol_spike,     1,    5),
        0.10 * _clip01(am_ratio,     40,   80),
    ]
    if all(p == 0.0 for p in parts):
        return None
    return round(sum(parts) * 100.0, 2)


# ---------- main entry point -------------------------------------------------

@dataclass
class ComputeResult:
    rows: list[StockAnalyticsRow]
    as_of_date: date


def compute_analytics(
    stock_id: str,
    bars: list[dict],
    *,
    shares_outstanding: int | None = None,
    market_returns: dict[str, float] | None = None,
    short_interest_rows: list[ShortInterestInput] | None = None,
    latest_short_sale: tuple[int | None, int | None] | None = None,
) -> ComputeResult | None:
    """`bars` is a list of {trade_date, close, ...} dicts, ANY order.

    `shares_outstanding` (optional) enables the per-day `volume_efficiency`
    column. When None or 0, every row's `volume_efficiency` is null.

    `market_returns` (optional) is the trailing-return dict for the stock's
    market, e.g. {"1m": 4.2, "3m": 6.7, ...}. Populated by
    `providers/index_history.py` for the stock's market (SPX for US, HSI for
    HK). The 1m value is used to compute `relative_strength` on the most-
    recent row only — we only refetch current SPX/HSI bars, so historical
    rows cannot have a meaningful RS. When None or empty, every row's
    `relative_strength` is null.

    `short_interest_rows` (optional) — desc-sorted latest N (`N` is 1 or 2)
    SI rows for the stock. Drives `squeeze_dtc`, `squeeze_si_chg_1w`.
    Pass None from `sync-analytics` (the squeeze columns then stay null —
    no regressions). Only `sync-squeeze` should pass them.

    `latest_short_sale` (optional) — `(am_short_volume, short_volume)` of
    the most-recent `ey_short_sale_1d` row. Drives `squeeze_am_ratio`
    (HK-only signal). For US rows, leave None.

    Returns rows for every date that has enough history to compute at
    least one indicator. Most-recent date becomes the "current" snapshot.
    """
    if not bars:
        return None

    df = pd.DataFrame(bars)
    if df.empty or "trade_date" not in df.columns or "close" not in df.columns:
        return None

    df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
    df = (
        df.dropna(subset=["close"])
        .sort_values("trade_date")
        .reset_index(drop=True)
    )

    if len(df) < 2:
        return None

    # Coerce once to float64 — every downstream rolling operation needs
    # this to avoid object-dtype errors when NA appears in the leading row.
    close = pd.to_numeric(df["close"], errors="coerce").astype(float)
    if "volume" in df.columns:
        volume_series = pd.to_numeric(df["volume"], errors="coerce").astype(float)
    else:
        volume_series = pd.Series(0, index=df.index, dtype="float64")
    if "open" in df.columns:
        open_series = pd.to_numeric(df["open"], errors="coerce").astype(float)
    else:
        # Fallback to close — keeps the green/red ratio defined but yields
        # ratio = 1 (no green/red distinction). Better than NaN across the
        # whole history.
        open_series = close.copy()

    df["ma5"] = close.rolling(5).mean()
    df["ma20"] = close.rolling(20).mean()
    df["ma50"] = close.rolling(50).mean()
    df["ma200"] = close.rolling(200).mean()
    df["ma5_slope"] = df["ma5"].diff()
    df["ma20_slope"] = df["ma20"].diff()
    df["rsi14"] = _rsi(close, 14)

    ema12 = _ema(close, 12)
    ema26 = _ema(close, 26)
    df["macd_line"] = ema12 - ema26
    df["macd_signal"] = _ema(df["macd_line"], 9)
    df["macd_hist"] = df["macd_line"] - df["macd_signal"]

    df["volatility_30d"] = _annualized_vol(close, 30)
    df["max_drawdown_30d"] = _max_drawdown(close, 30)

    df["return_1w"] = _return_n(close, 5)    # ~1 calendar week in trading days
    df["return_1m"] = _return_n(close, 21)   # ~1 calendar month in trading days
    df["return_3m"] = _return_n(close, 63)
    df["return_6m"] = _return_n(close, 126)
    df["return_1y"] = _return_n(close, 252)

    # Phase 3+ sector-strength columns — same per-row pattern as above.
    df["volume_efficiency"] = _volume_efficiency(close, volume_series, shares_outstanding)
    df["crowded_ratio"] = _crowded_ratio(volume_series)
    df["green_red_volume_ratio_1m"] = _green_red_volume_ratio_1m(
        open_series, close, volume_series, window=30,
    )
    df["green_red_volume_share_1m"] = _green_red_volume_share_1m(
        open_series, close, volume_series, window=21,
    )
    df["green_red_impact_ease_1m"] = _green_red_impact_ease_1m(
        open_series, close, volume_series, window=21,
    )
    df["relative_strength"] = pd.Series(np.nan, index=df.index, dtype="float64")

    # Phase 3+ squeeze-score components — per-row trailing-window series so
    # any historical `as_of_date` can carry the latest breakdown. The
    # composite `squeeze_score` itself is constant across rows (driven by
    # stock-level inputs that don't change day-to-day).
    df["volume_spike"] = _volume_spike(volume_series)

    # Relative strength is only meaningful for the most-recent row — we
    # only fetched today's market returns, not historical SPX/HSI bars.
    last_date = df["trade_date"].iloc[-1]
    last_return_1m = _maybe_float(df["return_1m"].iloc[-1])
    market_return_1m = (market_returns or {}).get("1m")
    rs_today = _relative_strength(last_return_1m, market_return_1m)
    if rs_today is not None:
        df.loc[df.index[-1], "relative_strength"] = rs_today

    # Squeeze-score stock-level inputs — once per call. The 30d avg
    # denominator for DTC is computed from the same df the breakdown rows
    # read from, so every as_of_date gets the same DTC (DTC is a stock-
    # level concept, not per-day).
    if len(volume_series) >= 30:
        avg_vol_30d = float(volume_series.iloc[-30:].mean())
    else:
        avg_vol_30d = None
    squeeze_dtc = _days_to_cover(
        short_interest_rows[0].short_interest if short_interest_rows else None,
        avg_vol_30d,
    )
    squeeze_si_chg_1w = _si_change_pct_1w(short_interest_rows or [])
    squeeze_am_ratio = _am_ratio(*latest_short_sale) if latest_short_sale else None
    squeeze_score = _squeeze_score(
        dtc=squeeze_dtc,
        si_chg_1w=squeeze_si_chg_1w,
        drawdown=_maybe_float(df["max_drawdown_30d"].iloc[-1]) if len(df) else None,
        vol_spike=_maybe_float(df["volume_spike"].iloc[-1]) if len(df) else None,
        am_ratio=squeeze_am_ratio,
    )

    rows: list[StockAnalyticsRow] = []
    for _, r in df.iterrows():
        rows.append(
            StockAnalyticsRow(
                stock_id=stock_id,
                as_of_date=r["trade_date"],
                ma5=_maybe_float(r.get("ma5")),
                ma20=_maybe_float(r.get("ma20")),
                ma50=_maybe_float(r.get("ma50")),
                ma200=_maybe_float(r.get("ma200")),
                ma5_slope=_maybe_float(r.get("ma5_slope")),
                ma20_slope=_maybe_float(r.get("ma20_slope")),
                rsi14=_maybe_float(r.get("rsi14")),
                macd_line=_maybe_float(r.get("macd_line")),
                macd_signal=_maybe_float(r.get("macd_signal")),
                macd_hist=_maybe_float(r.get("macd_hist")),
                volatility_30d=_maybe_float(r.get("volatility_30d")),
                max_drawdown_30d=_maybe_float(r.get("max_drawdown_30d")),
                return_1m=_maybe_float(r.get("return_1m")),
                return_3m=_maybe_float(r.get("return_3m")),
                return_6m=_maybe_float(r.get("return_6m")),
                return_1y=_maybe_float(r.get("return_1y")),
                return_1w=_maybe_float(r.get("return_1w")),
                volume_efficiency=_maybe_float(r.get("volume_efficiency")),
                crowded_ratio=_maybe_float(r.get("crowded_ratio")),
                green_red_volume_ratio_1m=_maybe_float(r.get("green_red_volume_ratio_1m")),
                green_red_volume_share_1m=_maybe_float(r.get("green_red_volume_share_1m")),
                green_red_impact_ease_1m=_maybe_float(r.get("green_red_impact_ease_1m")),
                relative_strength=_maybe_float(r.get("relative_strength")),
                squeeze_score=squeeze_score,
                squeeze_dtc=squeeze_dtc,
                squeeze_si_chg_1w=squeeze_si_chg_1w,
                squeeze_drawdown_30d=_maybe_float(r.get("max_drawdown_30d")),
                squeeze_volume_spike=_maybe_float(r.get("volume_spike")),
                squeeze_am_ratio=squeeze_am_ratio,
            )
        )

    return ComputeResult(rows=rows, as_of_date=last_date)


def _maybe_float(v) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        if pd.isna(f) or np.isnan(f):
            return None
        return f
    except (TypeError, ValueError):
        return None
