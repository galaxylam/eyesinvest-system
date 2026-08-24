"""Index trailing-return fetcher — refetches SPX + HSI from yfinance.

Used by `sync-sector-strength` to compute per-stock and per-sector relative
strength. Two yfinance `history()` calls per run (one per index); the result
stays in memory and is not persisted to Supabase.

Returns a dict per index of {window: percent_return}, e.g.
    {"SPX": {"1m": 2.4, "3m": 5.8, "6m": 9.1, "1y": 18.3}, ...}

Per-index failures log a warning and return `{code: {}}` so the caller can
leave RS columns null instead of aborting the run.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

from eyesinvest_worker.log import logger
from eyesinvest_worker.providers.indexes import INDEX_YF_TICKERS

# Approximate trading-day count per window. Used to look back from the latest
# available close. Real counts vary (252 trading days ≈ 365 calendar days).
WINDOWS: dict[str, int] = {
    "1w": 5,
    "1m": 21,
    "3m": 63,
    "6m": 126,
    "1y": 252,
}


def fetch_index_trailing_returns(_cfg) -> dict[str, dict[str, float]]:
    """Refetch SPX + HSI from yfinance and compute trailing percent returns.

    `cfg` is accepted for future throttling / override hooks but unused today.
    """
    end = datetime.utcnow().date() + timedelta(days=1)
    # Pull ~400 calendar days so we cover 252 trading days even with holidays.
    start = end - timedelta(days=400)

    out: dict[str, dict[str, float]] = {}
    for code, yf_symbol in INDEX_YF_TICKERS.items():
        try:
            df: pd.DataFrame = yf.Ticker(yf_symbol).history(
                start=start.isoformat(),
                end=end.isoformat(),
                interval="1d",
                auto_adjust=False,
                actions=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"index-history: {code} ({yf_symbol}) fetch failed: {exc}")
            out[code] = {}
            continue

        if df is None or df.empty:
            logger.warning(f"index-history: {code} ({yf_symbol}) empty history")
            out[code] = {}
            continue

        closes = df["Close"].astype("float64").dropna()
        if closes.empty:
            logger.warning(f"index-history: {code} ({yf_symbol}) no closes after dropna")
            out[code] = {}
            continue

        last_close = float(closes.iloc[-1])
        if last_close <= 0:
            logger.warning(f"index-history: {code} ({yf_symbol}) non-positive last close")
            out[code] = {}
            continue

        returns: dict[str, float] = {}
        for window, days in WINDOWS.items():
            if len(closes) < days:
                # Not enough history yet — skip this window for this index.
                continue
            prior_close = float(closes.iloc[-days])
            if prior_close <= 0:
                continue
            returns[window] = round((last_close / prior_close - 1.0) * 100.0, 6)
        out[code] = returns

    logger.info(
        f"index-history: trailing returns computed for "
        f"{sorted(c for c, v in out.items() if v)}"
    )
    return out
