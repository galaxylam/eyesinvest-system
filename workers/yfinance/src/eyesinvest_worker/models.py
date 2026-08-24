"""Pydantic DTOs shared by the yfinance adapter and Supabase writers."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class PriceBar(BaseModel):
    """One row for `ey_price_1d`."""

    stock_id: str
    trade_date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    currency: str
    source: str = "yfinance"
    fetched_at: datetime = Field(default_factory=lambda: datetime.utcnow())


class QuoteSnapshot(BaseModel):
    """One row for `ey_quote_snapshot`."""

    stock_id: str
    last_price: float
    previous_close: float
    volume: int
    as_of: date
    source: str = "yfinance"
    fetched_at: datetime = Field(default_factory=lambda: datetime.utcnow())


class Fundamentals(BaseModel):
    """Subset of `ey_stocks` populated by `sync-fundamentals`."""

    market_cap: int | None = None
    shares_outstanding: int | None = None
    pe_ratio: float | None = None
    dividend_yield: float | None = None
    fifty_two_week_high: float | None = None
    fifty_two_week_low: float | None = None
    fundamentals_source: Literal["yfinance"] = "yfinance"
    fundamentals_fetched_at: datetime = Field(default_factory=lambda: datetime.utcnow())


class StockRecord(BaseModel):
    """Minimal info about an active stock read from `ey_stocks`."""

    id: str
    symbol: str
    market: str
    currency: str


class StockAnalyticsRow(BaseModel):
    """One row of `ey_stock_analytics`."""

    stock_id: str
    as_of_date: date
    ma20: float | None = None
    ma50: float | None = None
    ma200: float | None = None
    rsi14: float | None = None
    macd_line: float | None = None
    macd_signal: float | None = None
    macd_hist: float | None = None
    volatility_30d: float | None = None
    max_drawdown_30d: float | None = None
    return_1m: float | None = None
    return_3m: float | None = None
    return_6m: float | None = None
    return_1y: float | None = None
    source: str = "worker"


class IndexQuote(BaseModel):
    """One row of `ey_index_quote`."""

    code: str
    market: str
    name_en: str
    name_zh_hk: str
    name_zh_cn: str
    last: float
    previous_close: float
    as_of: date
    source: str = "yfinance"


class ShortSaleRow(BaseModel):
    """One row of `ey_short_sale_1d`.

    US source is FINRA `regShoDaily` (T+1, has `total_volume`).
    HK source is HKEX public daily page (T+0 — populated only after
    16:00 HKT market close; `total_volume` is not published, leave 0).
    """

    stock_id: str
    trade_date: date
    market: Literal["US", "HK"] = "US"
    short_volume: int
    short_exempt_volume: int = 0
    total_volume: int = 0
    short_value_hkd: float | None = None  # HKEX HKD turnover; NULL for US
    source: str = "finra"


class ShortInterestRow(BaseModel):
    """One row of `ey_short_interest` (positions outstanding).

    US source is FINRA `consolidatedShortInterest` (bi-weekly).
    HK source is SFC weekly aggregated reportable short positions — see
    `providers/sfc_weekly.py`. SFC's published CSV only carries current
    aggregated positions, so `days_to_cover` / `change_pct` /
    `prior_short_interest` are left NULL on HK rows; the UI's
    query-time derivation still computes a usable `daysToCover`.
    """

    stock_id: str
    settlement_date: date
    market: Literal["US", "HK"] = "US"
    short_interest: int
    days_to_cover: float | None = None
    prior_short_interest: int | None = None
    change_pct: float | None = None
    source: str = "finra"
