"""yfinance adapter — wraps the external library so the rest of the worker
doesn't import it directly."""

from eyesinvest_worker.providers.analytics import compute_analytics
from eyesinvest_worker.providers.indexes import fetch_index_quote
from eyesinvest_worker.providers.yfinance import (
    fetch_daily_history,
    fetch_fundamentals,
    fetch_quote_snapshot,
)

__all__ = [
    "compute_analytics",
    "fetch_daily_history",
    "fetch_fundamentals",
    "fetch_index_quote",
    "fetch_quote_snapshot",
]
