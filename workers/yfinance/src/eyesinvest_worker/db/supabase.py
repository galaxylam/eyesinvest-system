"""Service-role Supabase helpers — read ey_stocks, upsert into the ey_* tables."""

from __future__ import annotations

from typing import Any

from supabase import Client, create_client

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import (
    Fundamentals,
    IndexQuote,
    PriceBar,
    QuoteSnapshot,
    StockAnalyticsRow,
    StockRecord,
)


def make_client(url: str, key: str) -> Client:
    return create_client(url, key)


def fetch_active_stocks(client: Client) -> list[StockRecord]:
    """Read all `is_active = true` rows from `ey_stocks`."""
    resp = (
        client.table("ey_stocks")
        .select("id, symbol, market, currency")
        .eq("is_active", True)
        .order("market")
        .order("symbol")
        .execute()
    )
    rows: list[dict[str, Any]] = resp.data or []
    return [StockRecord(**r) for r in rows]


def _chunks(xs: list[Any], size: int) -> list[list[Any]]:
    return [xs[i : i + size] for i in range(0, len(xs), size)]


def upsert_price_bars(client: Client, bars: list[PriceBar]) -> int:
    """Upsert in chunks of 500. Returns total rows written."""
    if not bars:
        return 0
    payload = [b.model_dump(mode="json") for b in bars]
    written = 0
    for chunk in _chunks(payload, 500):
        resp = (
            client.table("ey_price_1d")
            .upsert(chunk, on_conflict="stock_id,trade_date")
            .execute()
        )
        written += len(resp.data or chunk)
    logger.info(f"upserted {written} rows into ey_price_1d")
    return written


def upsert_quote_snapshot(client: Client, quotes: list[QuoteSnapshot]) -> int:
    if not quotes:
        return 0
    payload = [q.model_dump(mode="json") for q in quotes]
    resp = (
        client.table("ey_quote_snapshot")
        .upsert(payload, on_conflict="stock_id")
        .execute()
    )
    written = len(resp.data or payload)
    logger.info(f"upserted {written} rows into ey_quote_snapshot")
    return written


def upsert_fundamentals(
    client: Client,
    symbol_to_fundamentals: dict[str, Fundamentals],
    stocks: list[StockRecord],
) -> int:
    """Write fundamentals to ey_stocks (UPDATE, not UPSERT — stock rows exist)."""
    if not symbol_to_fundamentals:
        return 0
    written = 0
    for symbol, f in symbol_to_fundamentals.items():
        stock = next((s for s in stocks if s.symbol == symbol), None)
        if stock is None:
            logger.warning(f"fundamentals: unknown symbol {symbol}")
            continue
        payload = f.model_dump(mode="json")
        try:
            (
                client.table("ey_stocks")
                .update(payload)
                .eq("id", stock.id)
                .execute()
            )
            written += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"fundamentals: update for {symbol} failed: {exc}")
    logger.info(f"updated {written} ey_stocks rows with fundamentals")
    return written


def fetch_price_history(client: Client, stock_id: str) -> list[dict[str, Any]]:
    """Read every row of ey_price_1d for a stock. Returns {trade_date, close, ...} dicts."""
    resp = (
        client.table("ey_price_1d")
        .select("trade_date, open, high, low, close, volume")
        .eq("stock_id", stock_id)
        .order("trade_date", desc=False)
        .execute()
    )
    return list(resp.data or [])


def upsert_analytics_rows(client: Client, rows: list[StockAnalyticsRow]) -> int:
    """Upsert per-day indicator rows. PK conflict on (stock_id, as_of_date)."""
    if not rows:
        return 0
    payload = [r.model_dump(mode="json") for r in rows]
    written = 0
    for chunk in _chunks(payload, 500):
        resp = (
            client.table("ey_stock_analytics")
            .upsert(chunk, on_conflict="stock_id,as_of_date")
            .execute()
        )
        written += len(resp.data or chunk)
    logger.info(f"upserted {written} rows into ey_stock_analytics")
    return written


def upsert_index_quotes(client: Client, quotes: list[IndexQuote]) -> int:
    """Upsert latest index quotes. PK conflict on (code)."""
    if not quotes:
        return 0
    written = 0
    for q in quotes:
        payload = q.model_dump(mode="json")
        try:
            (
                client.table("ey_index_quote")
                .upsert(payload, on_conflict="code")
                .execute()
            )
            written += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"index {q.code}: upsert failed: {exc}")
    logger.info(f"upserted {written} rows into ey_index_quote")
    return written
