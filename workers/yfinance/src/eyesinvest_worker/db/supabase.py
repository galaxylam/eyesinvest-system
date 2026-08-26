"""Service-role Supabase helpers — read ey_stocks, upsert into the ey_* tables."""

from __future__ import annotations

import math
from typing import Any

from supabase import Client, create_client

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import (
    Fundamentals,
    IndexQuote,
    PriceBar,
    QuoteSnapshot,
    SectorDailyRow,
    ShortInterestRow,
    ShortSaleRow,
    StockAnalyticsRow,
    StockRecord,
    StockRecordWithSector,
)


# Upper bound (absolute) of a Postgres `numeric(p, s)` column: 10^s − 1
# divided by 10^s. ey_short_interest.{days_to_cover, change_pct} are
# numeric(10, 4) — any value with |x| > 999_999.9999 trips 22003.
_NUMERIC_10_4_MAX_ABS = 999_999.9999


def _is_finite_numeric(v: float) -> bool:
    """Mirror of math.isfinite — local helper so the upsert code reads clean."""
    return math.isfinite(v)


def _sanitize_for_json(value: Any) -> Any:
    """Recursively replace NaN / ±Inf floats with None.

    Supabase uses stdlib `json.dumps` server-side, which rejects NaN
    ("Out of range float values are not JSON compliant"). Several
    providers (notably yfinance on newly-listed / delisted tickers or
    rows with no trades) can hand us `float('nan')` for OHLC fields,
    `previousClose`, etc. — if any of those reaches an upsert it
    aborts the whole batch. This walks the dumped payload and
    rewrites non-finite floats to None so the upsert proceeds
    (the column lands as NULL, which is the right semantic).

    Lists and dicts are walked recursively. Everything else is
    returned unchanged.
    """
    if isinstance(value, float):
        return None if not math.isfinite(value) else value
    if isinstance(value, dict):
        return {k: _sanitize_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_for_json(v) for v in value]
    return value


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


def fetch_active_stocks_with_sector(client: Client) -> list[StockRecordWithSector]:
    """Read all `is_active = true` rows from `ey_stocks`, enriched with sector + shares.

    Used by `sync-sector-strength` to build the sector rollup. `sector` may be
    NULL for any stocks that predate the seed refresh; the caller skips them.
    """
    resp = (
        client.table("ey_stocks")
        .select("id, symbol, market, currency, sector, shares_outstanding")
        .eq("is_active", True)
        .order("market")
        .order("symbol")
        .execute()
    )
    rows: list[dict[str, Any]] = resp.data or []
    return [StockRecordWithSector(**r) for r in rows]


def _chunks(xs: list[Any], size: int) -> list[list[Any]]:
    return [xs[i : i + size] for i in range(0, len(xs), size)]


def upsert_price_bars(client: Client, bars: list[PriceBar]) -> int:
    """Upsert in chunks of 500. Returns total rows written."""
    if not bars:
        return 0
    payload = [_sanitize_for_json(b.model_dump(mode="json")) for b in bars]
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
    payload = [_sanitize_for_json(q.model_dump(mode="json")) for q in quotes]
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
        payload = _sanitize_for_json(f.model_dump(mode="json"))
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
    payload = [_sanitize_for_json(r.model_dump(mode="json")) for r in rows]
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


def upsert_sector_daily(client: Client, rows: list[SectorDailyRow]) -> int:
    """Upsert sector-aggregate rows. PK conflict on (sector, as_of_date)."""
    if not rows:
        return 0
    payload = [_sanitize_for_json(r.model_dump(mode="json")) for r in rows]
    written = 0
    for chunk in _chunks(payload, 500):
        resp = (
            client.table("ey_sector_daily")
            .upsert(chunk, on_conflict="sector,as_of_date")
            .execute()
        )
        written += len(resp.data or chunk)
    logger.info(f"upserted {written} rows into ey_sector_daily")
    return written


def upsert_index_quotes(client: Client, quotes: list[IndexQuote]) -> int:
    """Upsert latest index quotes. PK conflict on (code)."""
    if not quotes:
        return 0
    written = 0
    for q in quotes:
        payload = _sanitize_for_json(q.model_dump(mode="json"))
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


def upsert_short_sales(client: Client, rows: list[ShortSaleRow]) -> int:
    """Upsert FINRA daily Reg-SHO rows. PK conflict on (stock_id, trade_date)."""
    if not rows:
        return 0
    payload = [_sanitize_for_json(r.model_dump(mode="json")) for r in rows]
    written = 0
    for chunk in _chunks(payload, 500):
        resp = (
            client.table("ey_short_sale_1d")
            .upsert(chunk, on_conflict="stock_id,trade_date")
            .execute()
        )
        written += len(resp.data or chunk)
    logger.info(f"upserted {written} rows into ey_short_sale_1d")
    return written


def upsert_short_interest(client: Client, rows: list[ShortInterestRow]) -> int:
    """Upsert FINRA bi-weekly short-interest rows. PK conflict on (stock_id, settlement_date).

    `days_to_cover` and `change_pct` are stored as `numeric(10, 4)` which
    caps the absolute value at 999_999.9999. FINRA occasionally returns
    pathological values (e.g. an extreme `changePercent` after a stock
    split) that overflow this range — without sanitisation the entire
    500-row chunk fails with Postgres 22003. Clamp any offending field to
    NULL so the rest of the row (notably `short_interest`) still lands.
    """
    if not rows:
        return 0
    cleaned: list[dict] = []
    clamped_fields = 0
    for r in rows:
        d = r.model_dump(mode="json")
        for k in ("days_to_cover", "change_pct"):
            v = d.get(k)
            if isinstance(v, (int, float)) and not _is_finite_numeric(v):
                logger.warning(
                    f"ey_short_interest.{k}={v!r} is not finite; setting NULL"
                )
                d[k] = None
                clamped_fields += 1
            elif isinstance(v, (int, float)) and abs(v) > _NUMERIC_10_4_MAX_ABS:
                logger.warning(
                    f"ey_short_interest.{k}={v} overflows numeric(10,4); setting NULL"
                )
                d[k] = None
                clamped_fields += 1
        cleaned.append(d)
    if clamped_fields:
        logger.info(f"ey_short_interest: clamped {clamped_fields} out-of-range field(s) to NULL")
    payload = [_sanitize_for_json(d) for d in cleaned]
    written = 0
    for chunk in _chunks(payload, 500):
        resp = (
            client.table("ey_short_interest")
            .upsert(chunk, on_conflict="stock_id,settlement_date")
            .execute()
        )
        written += len(resp.data or chunk)
    logger.info(f"upserted {written} rows into ey_short_interest")
    return written


def fetch_last_settlement_date(client: Client, market: str) -> str | None:
    """Return the ISO date string of the most recent ``settlement_date``
    in ``ey_short_interest`` for ``market`` ('HK' or 'US'). ``None`` when
    the table has no rows for that market (first-ever run → full backfill).
    """
    resp = (
        client.table("ey_short_interest")
        .select("settlement_date")
        .eq("market", market)
        .order("settlement_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0]["settlement_date"] if rows else None


def fetch_latest_short_interest(
    client: Client, stock_id: str, *, limit: int = 2,
) -> list[dict[str, Any]]:
    """Desc-sorted latest N ``ey_short_interest`` rows for a stock.

    Returns raw dicts (not ``ShortInterestRow``) because the squeeze
    pipeline only needs three columns: ``short_interest``,
    ``prior_short_interest``, ``change_pct``. Empty list on failure.
    """
    try:
        resp = (
            client.table("ey_short_interest")
            .select("settlement_date, short_interest, prior_short_interest, change_pct")
            .eq("stock_id", stock_id)
            .order("settlement_date", desc=True)
            .limit(limit)
            .execute()
        )
        return list(resp.data or [])
    except Exception as exc:  # noqa: BLE001 — supabase raises broad exceptions
        logger.warning(f"fetch_latest_short_interest({stock_id}): {exc}")
        return []


def fetch_latest_short_sale(client: Client, stock_id: str) -> dict[str, Any] | None:
    """Return the most-recent ``ey_short_sale_1d`` row for a stock, or None.

    Only the columns the squeeze pipeline needs: ``am_short_volume`` (HK-
    only signal) and ``short_volume`` (the full-day denominator for the
    AM-ratio). None when no row exists or the query fails — both branches
    produce ``am_ratio = null`` downstream, which is the right default.
    """
    try:
        resp = (
            client.table("ey_short_sale_1d")
            .select("trade_date, short_volume, am_short_volume")
            .eq("stock_id", stock_id)
            .order("trade_date", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:  # noqa: BLE001 — supabase raises broad exceptions
        logger.warning(f"fetch_latest_short_sale({stock_id}): {exc}")
        return None
