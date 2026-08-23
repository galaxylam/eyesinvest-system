"""Compute technical indicators + risk metrics from OHLC history.

Pure pandas / numpy — no external TA library. Indicators implemented:

  - Moving averages:        MA20, MA50, MA200 (close-based, simple)
  - RSI(14):                Wilder smoothing
  - MACD(12, 26, 9):        EMA-based
  - Volatility(30d):        stdev of log returns × sqrt(252)
  - Max drawdown(30d):      peak-to-trough, negative fraction
  - Trailing returns:       1m, 3m, 6m, 1y close / close - 1

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


# ---------- main entry point -------------------------------------------------

@dataclass
class ComputeResult:
    rows: list[StockAnalyticsRow]
    as_of_date: date


def compute_analytics(
    stock_id: str,
    bars: list[dict],
) -> ComputeResult | None:
    """`bars` is a list of {trade_date, close, ...} dicts, ANY order.

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

    df["return_1m"] = _return_n(close, 21)   # ~1 calendar month in trading days
    df["return_3m"] = _return_n(close, 63)
    df["return_6m"] = _return_n(close, 126)
    df["return_1y"] = _return_n(close, 252)

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
            )
        )

    return ComputeResult(rows=rows, as_of_date=df["trade_date"].iloc[-1])


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
