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


class StockRecordWithSector(BaseModel):
    """Active stock enriched with sector + shares_outstanding for sector-strength work.

    `sector` may be None (rare — only stocks that predate the seed refresh).
    `shares_outstanding` may be None when `sync-fundamentals` hasn't populated it yet.
    """

    id: str
    symbol: str
    market: str
    currency: str
    sector: str | None = None
    shares_outstanding: int | None = None


class StockAnalyticsRow(BaseModel):
    """One row of `ey_stock_analytics`."""

    stock_id: str
    as_of_date: date
    ma5: float | None = None
    ma20: float | None = None
    ma50: float | None = None
    ma200: float | None = None
    # Phase 3+ screener filter inputs — signed delta vs the prior trading day
    # for the screener's "MA upward / downward" filter, and a 30-day
    # mean(volume on green bars) ÷ mean(volume on red bars) for the
    # "green ≥ N% higher than red" filter.
    ma5_slope: float | None = None
    ma20_slope: float | None = None
    # Phase 3+ green/red volume metrics — both populated by sync-analytics.
    # ratio = avg(volume on up-bars) / avg(volume on down-bars) — treats every
    #         day equally. See migration 0008.
    # share = sum(volume on up-bars) / (sum on up + sum on down) — weights
    #         high-volume days more heavily. See migration 0014.
    # Dojis (close == open) are excluded from both.
    green_red_volume_ratio_1m: float | None = None
    green_red_volume_share_1m: float | None = None
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
    return_1w: float | None = None
    # Phase 3+ sector strength — nullable so pre-existing rows stay valid.
    # All three are populated by `sync-sector-strength` (see providers/sector_strength.py).
    volume_efficiency: float | None = None
    crowded_ratio: float | None = None
    relative_strength: float | None = None
    # Phase 3+ short-squeeze score — nullable so pre-existing rows stay valid.
    # All six are populated by `sync-squeeze` (see providers/analytics.py);
    # NULL on rows written by `sync-analytics` alone (no short inputs passed).
    # `squeeze_score` is also NULL when every component is NULL — never a
    # synthetic zero. See docs/SQUEEZE.md for the formula.
    squeeze_score: float | None = None
    squeeze_dtc: float | None = None
    squeeze_si_chg_1w: float | None = None
    squeeze_drawdown_30d: float | None = None
    squeeze_volume_spike: float | None = None
    squeeze_am_ratio: float | None = None
    source: str = "worker"


class SectorDailyRow(BaseModel):
    """One row of `ey_sector_daily` — sector-level rollup for an as-of date.

    `sector` is the English string from `ey_stocks.sector` (US+HK collapse under
    one key; per-market splits are a dashboard filter, not a PK component).
    `rs_vs_market_N` is computed against the global market benchmark — the
    equal-weight mean of SPX and HSI trailing returns for window N. See
    `providers/sector_strength.py` for the formula.
    """

    sector: str
    as_of_date: date
    member_count: int
    sector_return_1w: float | None = None
    sector_return_1m: float | None = None
    sector_return_3m: float | None = None
    sector_return_6m: float | None = None
    sector_return_1y: float | None = None
    rs_vs_market_1w: float | None = None
    rs_vs_market_1m: float | None = None
    rs_vs_market_3m: float | None = None
    rs_vs_market_6m: float | None = None
    rs_vs_market_1y: float | None = None
    breadth_pct: float | None = None
    volume_efficiency_mean: float | None = None
    crowded_ratio_mean: float | None = None
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

    The AM fields are populated by `sync_hkex_short_sales_combined` only when
    HKEX has published the morning-session page (MSHTMAIN / MSHTGEM — around
    12:00–13:00 HKT lunch break). NULL for US rows and for HK rows captured
    before the AM page goes live.
    """

    stock_id: str
    trade_date: date
    market: Literal["US", "HK"] = "US"
    short_volume: int
    short_exempt_volume: int = 0
    total_volume: int = 0
    short_value_hkd: float | None = None  # HKEX HKD turnover; NULL for US
    source: str = "finra"
    # HKEX morning session — see local/supabase/migrations/0012_hkex_am_short_selling.sql
    am_short_volume: int | None = None
    am_short_value_hkd: float | None = None
    am_published_at: datetime | None = None


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


# ===== Phase 7 — News ingestion ============================================


class RssSource(BaseModel):
    """One entry in NEWS_RSS_FEEDS — a feed the worker pulls each run.

    `market` is informational ('US' | 'HK' | 'GLOBAL'); the worker does not
    filter the LLM by market, it just inlines the universe so the model can
    ground its answers.
    """

    name: str
    url: str
    market: Literal["US", "HK", "GLOBAL"] = "GLOBAL"


class NewsArticle(BaseModel):
    """One row of `ey_news_article`. Deduped by `source_url` (UNIQUE in DB).

    Worker fetches, parses, and upserts these. The article is the immutable
    provenance trail — admin never mutates this row, only the mappings /
    relationships that point to it.
    """

    source_url: str
    source_name: str
    title: str
    summary: str | None = None
    published_at: datetime | None = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.utcnow())
    language: Literal["en"] = "en"
    raw_metadata: dict | None = None
    source: str = "rss"


# ===== Phase 8 — AI analysis ================================================


class NewsStockMapping(BaseModel):
    """One row of `ey_news_stock_mapping` — AI's per-impact analysis.

    Worker writes status='pending'; admin flips to 'approved' or 'rejected'
    to make the row canonical. Re-runs UPSERT on (article_id, stock_id)
    and refresh the AI columns in place without touching the approval fields.
    """

    article_id: str
    stock_id: str
    sentiment: Literal["bullish", "bearish", "neutral"] | None = None
    impact_direction: Literal["positive", "negative", "mixed", "none"] | None = None
    impact_severity: Literal["low", "medium", "high", "critical"] | None = None
    confidence: float | None = None
    rationale: str | None = None
    # Approval fields default to None so the worker's UPSERT is a no-op on
    # existing approved rows (only the AI columns get refreshed).
    status: Literal["pending", "approved", "rejected"] | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None
    reviewer_notes: str | None = None
    source: str = "openrouter"


class StockRelationship(BaseModel):
    """One row of `ey_stock_relationship` — knowledge-graph edge.

    Natural key: (source_stock_id, target_stock_id, relationship_type).
    Worker UPSERTs on this; status='pending' on first sight. Admin approves
    to make the edge canonical and reusable across future runs.
    """

    source_stock_id: str
    target_stock_id: str
    relationship_type: Literal[
        "supplier", "competitor", "customer", "partner", "parent_subsidiary"
    ]
    confidence: float | None = None
    rationale: str | None = None
    evidence_news_id: str | None = None
    status: Literal["pending", "approved", "rejected"] | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None
    reviewer_notes: str | None = None
    source: str = "openrouter"
