"""Service-role Supabase helpers — read ey_stocks, upsert into the ey_* tables."""

from __future__ import annotations

import math
from typing import Any

import httpx
from postgrest.constants import DEFAULT_POSTGREST_CLIENT_TIMEOUT
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import (
    Fundamentals,
    IndexQuote,
    NewsArticle,
    NewsStockMapping,
    PriceBar,
    QuoteSnapshot,
    SectorDailyRow,
    ShortInterestRow,
    ShortSaleRow,
    StockAnalyticsRow,
    StockRecord,
    StockRecordWithSector,
    StockRelationship,
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
    # Force HTTP/1.1 on the PostgREST client. postgrest-py defaults its
    # internal httpx.Client to http2=True, which multiplexes requests
    # over a single TCP connection. Supabase's edge terminates idle
    # HTTP/2 streams (Cloudflare / load-balancer idle timeout), and
    # postgrest's `send_with_retry` only retries idempotent GET/HEAD
    # on 503/520 — so a single dropped connection raises
    # `httpx.RemoteProtocolError: <ConnectionTerminated>` out of every
    # upsert and crashes the whole pipeline.
    #
    # We pass our own httpx.Client with http2=False; postgrest uses it
    # as-is, and `Authorization` + per-request headers are still merged
    # in by the request builder, so auth still works.
    #
    # IMPORTANT: when postgrest builds its own httpx.Client it applies
    # `timeout=120` (DEFAULT_POSTGREST_CLIENT_TIMEOUT). When we supply
    # our own client, postgrest skips that step — so the httpx default
    # 5s timeout applies to every request. After ~20 minutes of
    # sustained traffic, Supabase occasionally takes >5s to respond and
    # the run dies with `httpx.ReadTimeout`. Set the same 120s timeout
    # here to match the default we'd otherwise get.
    http_client = httpx.Client(
        http2=False,
        follow_redirects=True,
        timeout=DEFAULT_POSTGREST_CLIENT_TIMEOUT,
    )
    return create_client(url, key, options=SyncClientOptions(httpx_client=http_client))


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


# ===== Phase 7 — News ingestion ============================================


def upsert_news_articles(client: Client, articles: list[NewsArticle]) -> int:
    """Upsert raw RSS articles. Dedupe is on `source_url` (UNIQUE constraint).

    Articles are the immutable provenance trail — admin never mutates these
    rows, only the mappings / relationships that point at them. Re-running
    the worker on the same URL is a no-op (UPSERT writes the same row back).

    Dedupes by `source_url` within the batch — same article syndicated
    across multiple feeds (e.g. Seeking Alpha → MarketWatch) appears as
    two entries in `articles`, but PostgREST upsert can't handle two
    rows with the same UNIQUE constraint value in one ON CONFLICT batch
    (Postgres 21000). Keep the first occurrence; title/summary are
    identical across feeds in practice.
    """
    if not articles:
        return 0
    seen: set[str] = set()
    deduped: list[NewsArticle] = []
    for a in articles:
        if a.source_url in seen:
            continue
        seen.add(a.source_url)
        deduped.append(a)
    if len(deduped) < len(articles):
        logger.info(
            f"ey_news_article: deduped {len(articles) - len(deduped)} "
            f"syndicated duplicate(s) by source_url"
        )
    payload = [_sanitize_for_json(a.model_dump(mode="json")) for a in deduped]
    written = 0
    for chunk in _chunks(payload, 500):
        resp = (
            client.table("ey_news_article")
            .upsert(chunk, on_conflict="source_url")
            .execute()
        )
        written += len(resp.data or chunk)
    logger.info(f"upserted {written} rows into ey_news_article")
    return written


def fetch_existing_news_urls(
    client: Client, since: datetime | None = None
) -> set[str]:
    """Return the set of `source_url` whose news mappings are admin-resolved.

    "Admin-resolved" = has at least one row in `ey_news_stock_mapping`
    with status='approved' or 'rejected'. Admin has spoken — don't re-feed
    the LLM, the AI columns are already canonical.

    Articles that are in `ey_news_article` but have NO mapping rows (or
    only 'pending' mappings) are NOT in this set and will be re-analyzed
    on the next run. This handles the case where a previous run wrote
    articles to the table but failed at the mappings upsert, leaving
    the LLM's first pass incomplete.

    Articles with only 'pending' mappings are also re-analyzed: the
    `upsert_news_stock_mappings` helper refreshes their AI columns in
    place, so the admin always sees the latest LLM signal.

    `since` filters mapping rows to the last 30 days so the result set
    stays bounded on a long-running database.
    """
    from datetime import datetime, timedelta, timezone

    if since is None:
        since = datetime.now(timezone.utc) - timedelta(days=30)
    try:
        # Two-step: resolve article_ids from approved/rejected mapping
        # rows, then look up source_urls on ey_news_article. PostgREST
        # could join in one call but the article table is small enough
        # that the indirection is fine.
        map_resp = (
            client.table("ey_news_stock_mapping")
            .select("article_id")
            .in_("status", ["approved", "rejected"])
            .gte("approved_at", since.isoformat())
            .execute()
        )
        article_ids = list({r["article_id"] for r in (map_resp.data or [])})
        if not article_ids:
            return set()
        art_resp = (
            client.table("ey_news_article")
            .select("source_url")
            .in_("id", article_ids)
            .execute()
        )
        return {r["source_url"] for r in (art_resp.data or [])}
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"fetch_existing_news_urls: {exc}")
        return set()


def upsert_news_stock_mappings(
    client: Client, rows: list[NewsStockMapping]
) -> int:
    """Insert or refresh AI-suggested article<->stock mappings.

    Worker contract:
      * New rows land as status='pending' (DB default).
      * Existing rows that are still 'pending' get their AI columns refreshed.
      * Existing rows that are 'approved' or 'rejected' are NOT touched —
        admin has spoken.

    We pre-fetch the existing (article_id, stock_id, status) tuples and
    split the input into (insert) and (update) sets. PostgREST `.upsert()`
    is a full-row replace, so we can't safely upsert without trampling the
    approval columns.
    """
    if not rows:
        return 0
    written = 0

    # Dedupe within the batch by natural key (article_id, stock_id). The
    # LLM sometimes emits the same (article, stock) pair twice in one
    # response — e.g. "MSFT bullish" then "MSFT positive, high severity"
    # as separate entries. PostgREST upsert can't handle two rows with
    # the same UNIQUE value in one ON CONFLICT batch (Postgres 21000).
    # First occurrence wins.
    seen_pairs: set[tuple[str, str]] = set()
    deduped_rows: list[NewsStockMapping] = []
    for r in rows:
        key = (r.article_id, r.stock_id)
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        deduped_rows.append(r)
    if len(deduped_rows) < len(rows):
        logger.info(
            f"upsert_news_stock_mappings: deduped {len(rows) - len(deduped_rows)} "
            f"intra-batch duplicate(s) by (article_id, stock_id)"
        )
    rows = deduped_rows

    # One SELECT covering all articles in the batch.
    article_ids = {r.article_id for r in rows}
    existing: dict[tuple[str, str], str] = {}  # (article_id, stock_id) -> status
    if article_ids:
        try:
            resp = (
                client.table("ey_news_stock_mapping")
                .select("article_id, stock_id, status")
                .in_("article_id", list(article_ids))
                .execute()
            )
            for r in resp.data or []:
                existing[(r["article_id"], r["stock_id"])] = r["status"]
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"upsert_news_stock_mappings: pre-check failed: {exc}")
            existing = {}

    to_insert: list[NewsStockMapping] = []
    to_update: list[NewsStockMapping] = []
    skipped = 0
    for r in rows:
        prev = existing.get((r.article_id, r.stock_id))
        if prev is None:
            to_insert.append(r)
        elif prev == "pending":
            to_update.append(r)
        else:
            # 'approved' or 'rejected' — admin has spoken, leave alone.
            skipped += 1
    if skipped:
        logger.info(
            f"upsert_news_stock_mappings: skipping {skipped} admin-resolved row(s)"
        )

    # Inserts: rely on the DB default for status='pending' — don't include it.
    if to_insert:
        payload = [
            _sanitize_for_json(
                {**r.model_dump(mode="json", exclude_none=True)}
            )
            for r in to_insert
        ]
        for chunk in _chunks(payload, 500):
            resp = (
                client.table("ey_news_stock_mapping")
                .upsert(chunk, on_conflict="article_id,stock_id")
                .execute()
            )
            written += len(resp.data or chunk)

    # Updates: refresh only the AI columns. status is still pending so no
    # admin fields exist yet — just send the AI fields.
    for r in to_update:
        d = r.model_dump(mode="json", exclude_none=True)
        # Don't touch approval / status / created_at / source on updates.
        for protected_col in (
            "id", "status", "approved_by", "approved_at",
            "reviewer_notes", "created_at", "source",
        ):
            d.pop(protected_col, None)
        d = _sanitize_for_json(d)
        try:
            (
                client.table("ey_news_stock_mapping")
                .update(d)
                .eq("article_id", r.article_id)
                .eq("stock_id", r.stock_id)
                .execute()
            )
            written += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"ey_news_stock_mapping update ({r.article_id}, {r.stock_id}): {exc}"
            )

    logger.info(f"upserted {written} rows into ey_news_stock_mapping")
    return written


def upsert_stock_relationships(
    client: Client, rows: list[StockRelationship]
) -> int:
    """Insert or refresh AI-suggested stock<->stock knowledge-graph edges.

    Same worker contract as upsert_news_stock_mappings: never trample
    admin-resolved (approved / rejected) edges. New edges land as
    status='pending' via the DB default.
    """
    if not rows:
        return 0
    written = 0

    # Dedupe within the batch by natural key (source, target, type). Same
    # 21000 protection as upsert_news_stock_mappings — the LLM can emit
    # the same edge twice in one response.
    seen_triples: set[tuple[str, str, str]] = set()
    deduped_rows: list[StockRelationship] = []
    for r in rows:
        key = (r.source_stock_id, r.target_stock_id, r.relationship_type)
        if key in seen_triples:
            continue
        seen_triples.add(key)
        deduped_rows.append(r)
    if len(deduped_rows) < len(rows):
        logger.info(
            f"upsert_stock_relationships: deduped {len(rows) - len(deduped_rows)} "
            f"intra-batch duplicate(s) by (source_stock_id, target_stock_id, relationship_type)"
        )
    rows = deduped_rows

    # Pre-fetch existing (source, target, type, status) for the batch.
    src_ids = {r.source_stock_id for r in rows}
    existing: dict[tuple[str, str, str], str] = {}
    if src_ids:
        try:
            resp = (
                client.table("ey_stock_relationship")
                .select("source_stock_id, target_stock_id, relationship_type, status")
                .in_("source_stock_id", list(src_ids))
                .execute()
            )
            for r in resp.data or []:
                key = (
                    r["source_stock_id"],
                    r["target_stock_id"],
                    r["relationship_type"],
                )
                existing[key] = r["status"]
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"upsert_stock_relationships: pre-check failed: {exc}")
            existing = {}

    to_insert: list[StockRelationship] = []
    to_update: list[StockRelationship] = []
    skipped = 0
    for r in rows:
        key = (r.source_stock_id, r.target_stock_id, r.relationship_type)
        prev = existing.get(key)
        if prev is None:
            to_insert.append(r)
        elif prev == "pending":
            to_update.append(r)
        else:
            skipped += 1
    if skipped:
        logger.info(
            f"upsert_stock_relationships: skipping {skipped} admin-resolved edge(s)"
        )

    if to_insert:
        payload = [
            _sanitize_for_json(r.model_dump(mode="json", exclude_none=True))
            for r in to_insert
        ]
        for chunk in _chunks(payload, 500):
            resp = (
                client.table("ey_stock_relationship")
                .upsert(
                    chunk,
                    on_conflict="source_stock_id,target_stock_id,relationship_type",
                )
                .execute()
            )
            written += len(resp.data or chunk)

    for r in to_update:
        d = r.model_dump(mode="json", exclude_none=True)
        for protected_col in (
            "id", "status", "approved_by", "approved_at",
            "reviewer_notes", "created_at", "source",
        ):
            d.pop(protected_col, None)
        d = _sanitize_for_json(d)
        try:
            (
                client.table("ey_stock_relationship")
                .update(d)
                .eq("source_stock_id", r.source_stock_id)
                .eq("target_stock_id", r.target_stock_id)
                .eq("relationship_type", r.relationship_type)
                .execute()
            )
            written += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"ey_stock_relationship update "
                f"({r.source_stock_id}->{r.target_stock_id} {r.relationship_type}): {exc}"
            )

    logger.info(f"upserted {written} rows into ey_stock_relationship")
    return written


def fetch_news_article_id(
    client: Client, source_url: str
) -> str | None:
    """Look up an article's UUID by its source_url. None if not present.

    Used by the AI extraction pass to attach the foreign key onto each
    NewsStockMapping / StockRelationship it produces.
    """
    try:
        resp = (
            client.table("ey_news_article")
            .select("id")
            .eq("source_url", source_url)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0]["id"] if rows else None
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"fetch_news_article_id({source_url!r}): {exc}")
        return None
