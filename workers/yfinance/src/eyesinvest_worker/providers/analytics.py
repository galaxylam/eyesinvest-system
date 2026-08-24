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

    df["ma20"] = close.rolling(20).mean()
    df["ma50"] = close.rolling(50).mean()
    df["ma200"] = close.rolling(200).mean()
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
    df["relative_strength"] = pd.Series(np.nan, index=df.index, dtype="float64")

    # Relative strength is only meaningful for the most-recent row — we
    # only fetched today's market returns, not historical SPX/HSI bars.
    last_date = df["trade_date"].iloc[-1]
    last_return_1m = _maybe_float(df["return_1m"].iloc[-1])
    market_return_1m = (market_returns or {}).get("1m")
    rs_today = _relative_strength(last_return_1m, market_return_1m)
    if rs_today is not None:
        df.loc[df.index[-1], "relative_strength"] = rs_today

    rows: list[StockAnalyticsRow] = []
    for _, r in df.iterrows():
        rows.append(
            StockAnalyticsRow(
                stock_id=stock_id,
                as_of_date=r["trade_date"],
                ma20=_maybe_float(r.get("ma20")),
                ma50=_maybe_float(r.get("ma50")),
                ma200=_maybe_float(r.get("ma200")),
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
                relative_strength=_maybe_float(r.get("relative_strength")),
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
