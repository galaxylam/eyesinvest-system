"""Index quote fetcher — pulls SPX + HSI from yfinance and normalizes."""

from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import IndexQuote


# Maps our internal index code → yfinance ticker symbol.
INDEX_YF_TICKERS = {
    "SPX": "^GSPC",   # S&P 500
    "HSI": "^HSI",    # Hang Seng Index
}

# Localized names — mirror packages/types/src/indexQuote.ts `MARKET_INDICES`.
INDEX_NAMES = {
    "SPX": {
        "name_en": "S&P 500",
        "name_zh_hk": "標普500",
        "name_zh_cn": "标普500",
    },
    "HSI": {
        "name_en": "Hang Seng Index",
        "name_zh_hk": "恆生指數",
        "name_zh_cn": "恒生指数",
    },
}


def fetch_index_quote(code: str) -> IndexQuote | None:
    """Fetch the latest daily close + previous close for `code`."""
    yf_symbol = INDEX_YF_TICKERS.get(code)
    if yf_symbol is None:
        logger.warning(f"unknown index code: {code}")
        return None
    names = INDEX_NAMES.get(code)
    if names is None:
        logger.warning(f"no localized names for index {code}")
        return None

    ticker = yf.Ticker(yf_symbol)
    end = datetime.utcnow().date()
    start = end - timedelta(days=14)  # cover weekends / holidays
    try:
        df: pd.DataFrame = ticker.history(
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=False,
            actions=False,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"{code} ({yf_symbol}): history() failed: {exc}")
        return None

    if df is None or df.empty:
        logger.warning(f"{code} ({yf_symbol}): empty history")
        return None

    last_close = float(df["Close"].iloc[-1])
    last_idx = df.index[-1]
    as_of = last_idx.date() if hasattr(last_idx, "date") else last_idx
    prev_close = float(df["Close"].iloc[-2]) if len(df) >= 2 else last_close

    market = "US" if code == "SPX" else "HK"

    return IndexQuote(
        code=code,
        market=market,
        name_en=names["name_en"],
        name_zh_hk=names["name_zh_hk"],
        name_zh_cn=names["name_zh_cn"],
        last=last_close,
        previous_close=prev_close,
        as_of=as_of,
    )
