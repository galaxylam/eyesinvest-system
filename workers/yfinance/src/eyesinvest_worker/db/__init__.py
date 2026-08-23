"""Supabase (service-role) writer — only the worker uses these helpers."""

from eyesinvest_worker.db.supabase import (
    fetch_active_stocks,
    fetch_price_history,
    make_client,
    upsert_analytics_rows,
    upsert_fundamentals,
    upsert_index_quotes,
    upsert_price_bars,
    upsert_quote_snapshot,
    upsert_short_interest,
    upsert_short_sales,
)

__all__ = [
    "fetch_active_stocks",
    "fetch_price_history",
    "make_client",
    "upsert_analytics_rows",
    "upsert_fundamentals",
    "upsert_index_quotes",
    "upsert_price_bars",
    "upsert_quote_snapshot",
    "upsert_short_interest",
    "upsert_short_sales",
]
