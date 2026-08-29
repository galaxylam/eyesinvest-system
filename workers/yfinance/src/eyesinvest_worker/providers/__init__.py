"""yfinance adapter — wraps the external library so the rest of the worker
doesn't import it directly."""

from eyesinvest_worker.providers.analytics import compute_analytics
from eyesinvest_worker.providers.article_crawler import (
    CrawlSource,
    crawl_source,
    default_yahoo_finance_source,
)
from eyesinvest_worker.providers.hkex_daily import (
    sync_hkex_am_short_sales,
    sync_hkex_short_sales,
    sync_hkex_short_sales_combined,
)
from eyesinvest_worker.providers.index_history import fetch_index_trailing_returns
from eyesinvest_worker.providers.indexes import fetch_index_quote
from eyesinvest_worker.providers.news import compute_news
from eyesinvest_worker.providers.sector_strength import compute_sector_strength
from eyesinvest_worker.providers.sfc_weekly import sync_sfc_short_interest
from eyesinvest_worker.providers.shorts import (
    fetch_finra_short_interest,
    fetch_finra_short_sale,
    sync_short_interest,
    sync_short_sales,
)
from eyesinvest_worker.providers.yfinance import (
    fetch_daily_history,
    fetch_fundamentals,
    fetch_quote_snapshot,
)

__all__ = [
    "CrawlSource",
    "compute_analytics",
    "compute_news",
    "compute_sector_strength",
    "crawl_source",
    "default_yahoo_finance_source",
    "fetch_daily_history",
    "fetch_finra_short_interest",
    "fetch_finra_short_sale",
    "fetch_fundamentals",
    "fetch_index_quote",
    "fetch_index_trailing_returns",
    "fetch_quote_snapshot",
    "sync_hkex_am_short_sales",
    "sync_hkex_short_sales",
    "sync_hkex_short_sales_combined",
    "sync_sfc_short_interest",
    "sync_short_interest",
    "sync_short_sales",
]