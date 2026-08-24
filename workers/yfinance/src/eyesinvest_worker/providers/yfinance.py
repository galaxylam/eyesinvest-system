"""Thin yfinance adapter — turns yfinance responses into our Pydantic models.

Why an adapter:
- yfinance is unofficial and returns pandas DataFrames with implicit types;
  our worker code should see typed DTOs.
- Centralises the `(symbol, market)` → yfinance ticker translation
  (ey_stocks.symbol already matches yfinance format, so no transformation
  is required — but the indirection keeps it cheap if we ever change).
- Lets us swap providers later by changing one file.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
import yfinance as yf

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import Fundamentals, PriceBar, QuoteSnapshot


def _to_yf_ticker(symbol: str) -> str:
    """`ey_stocks.symbol` is already in yfinance format ('AAPL', '0700.HK')."""
    return symbol


def fetch_daily_history(
    stock_id: str,
    symbol: str,
    currency: str,
    years: int = 3,
) -> list[PriceBar]:
    """Pull `years` of daily OHLC for `symbol`."""
    ticker = yf.Ticker(_to_yf_ticker(symbol))
    end = datetime.utcnow().date()
    start = end - timedelta(days=int(years * 365.25))
    try:
        df: pd.DataFrame = ticker.history(
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=False,
            actions=False,
        )
    except Exception as exc:  # noqa: BLE001 — yfinance raises opaque exceptions
        logger.warning(f"{symbol}: history() failed: {exc}")
        return []

    if df is None or df.empty:
        logger.warning(f"{symbol}: empty history frame")
        return []

    bars: list[PriceBar] = []
    now = datetime.utcnow()
    for idx, row in df.iterrows():
        # idx is a Timestamp in exchange-local tz; we drop the time and keep date.
        trade_date = idx.date() if hasattr(idx, "date") else idx
        try:
            open = float(row["Open"])
            high = float(row["High"])
            low = float(row["Low"])
            close = float(row["Close"])
            volume = int(row.get("Volume", 0) or 0)
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning(f"{symbol}: skipping malformed row {trade_date}: {exc}")
            continue
        # yfinance occasionally returns NaN for any OHLC field on newly-
        # listed stocks, delisted tickers, or rows with no trades that day.
        # NaN must NOT reach Supabase — stdlib json.dumps rejects it and
        # would abort the whole 500-bar chunk. Drop the row instead.
        if not (
            math.isfinite(open)
            and math.isfinite(high)
            and math.isfinite(low)
            and math.isfinite(close)
        ):
            logger.warning(f"{symbol}: skipping row {trade_date} with NaN OHLC")
            continue
        bar = PriceBar(
            stock_id=stock_id,
            trade_date=trade_date,
            open=open,
            high=high,
            low=low,
            close=close,
            volume=volume,
            currency=currency,
            fetched_at=now,
        )
        bars.append(bar)
    return bars


def fetch_quote_snapshot(stock_id: str, symbol: str) -> QuoteSnapshot | None:
    """Build a QuoteSnapshot from the latest two daily bars."""
    ticker = yf.Ticker(_to_yf_ticker(symbol))
    end = datetime.utcnow().date()
    start = end - timedelta(days=10)  # last ~2 weeks covers weekends / holidays
    try:
        df = ticker.history(
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=False,
            actions=False,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"{symbol}: history() for quote failed: {exc}")
        return None
    if df is None or df.empty or len(df) < 1:
        logger.warning(f"{symbol}: empty history for quote")
        return None

    last_idx = df.index[-1]
    last_close = float(df["Close"].iloc[-1])
    last_volume = int(df["Volume"].iloc[-1] or 0)
    last_date = last_idx.date() if hasattr(last_idx, "date") else last_idx

    if len(df) >= 2:
        prev_close = float(df["Close"].iloc[-2])
    else:
        prev_close = last_close

    # Drop quotes that would carry a NaN price through to the DB — Supabase
    # stdlib JSON rejects NaN, and a quote with a missing last_price is
    # useless on the screener anyway.
    if not (math.isfinite(last_close) and math.isfinite(prev_close)):
        logger.warning(f"{symbol}: dropping quote with NaN close (last={last_close}, prev={prev_close})")
        return None

    return QuoteSnapshot(
        stock_id=stock_id,
        last_price=last_close,
        previous_close=prev_close,
        volume=last_volume,
        as_of=last_date,
    )


def fetch_fundamentals(symbol: str) -> Fundamentals | None:
    """Pull .info metrics. Returns None if the provider doesn't expose them."""
    ticker = yf.Ticker(_to_yf_ticker(symbol))
    try:
        info: dict[str, Any] = ticker.info or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"{symbol}: .info failed: {exc}")
        return None

    def _int(value: Any) -> int | None:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _float(value: Any) -> float | None:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    return Fundamentals(
        market_cap=_int(info.get("marketCap")),
        shares_outstanding=_int(info.get("sharesOutstanding")),
        pe_ratio=_float(info.get("trailingPE")),
        dividend_yield=_float(info.get("dividendYield")),
        fifty_two_week_high=_float(info.get("fiftyTwoWeekHigh")),
        fifty_two_week_low=_float(info.get("fiftyTwoWeekLow")),
    )
