"""News ingestion + AI analysis (Phase 7 + Phase 8).

Two passes inside one worker command (`sync-news`):

  Pass A — RSS ingestion (always runs when NEWS_RSS_FEEDS is configured):
    For each feed in NEWS_RSS_FEEDS, fetch the latest entries via httpx,
    parse with feedparser, filter to entries published within the
    lookback window, and upsert into `ey_news_article`. Dedup is on
    `source_url` (UNIQUE). Articles whose mappings are admin-resolved
    (status='approved' or 'rejected') are skipped before the LLM call;
    everything else (new articles, articles with no mappings yet, articles
    with only 'pending' mappings) gets re-analyzed so the LLM can refresh
    the AI columns on every run.

  Pass B — OpenRouter analysis (only when OPENROUTER_API_KEY is set):
    Bundle the freshly-seen articles into batches of
    `openrouter_max_articles_per_llm_call` (default 5) and call
    `chat.completions.create` with response_format='json_object' to
    extract per-article stock impact analysis and stock<->stock
    knowledge-graph edges. The model is grounded in the active stock
    universe so it can't invent tickers. Inserts land as status='pending'
    on `ey_news_stock_mapping` and `ey_stock_relationship` — admin
    approves via apps/admin.

The provider is pure: it takes a config + supabase client + an httpx
transport, and returns counts. All throttling + per-step logging lives
in the caller (cli.py), matching the `sector_strength` / `analytics`
conventions.

Failure model: per-feed RSS errors are logged and skipped. Per-batch
LLM errors are logged and skipped. A malformed JSON response drops the
batch (no rows written). The orchestrator returns partial counts so
the caller can log a useful summary.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import feedparser  # type: ignore[import-untyped]
import httpx
from openai import OpenAI

from eyesinvest_worker.config import WorkerConfig
from eyesinvest_worker.db.supabase import (
    fetch_active_stocks,
    fetch_existing_news_urls,
    fetch_news_article_id,
    upsert_news_articles,
    upsert_news_stock_mappings,
    upsert_stock_relationships,
)
from eyesinvest_worker.log import logger
from eyesinvest_worker.models import (
    NewsArticle,
    NewsStockMapping,
    RssSource,
    StockRecord,
    StockRelationship,
)
from eyesinvest_worker.providers.article_crawler import (
    CrawlSource,
    crawl_source,
    default_yahoo_finance_source,
    extract_article_body,
)


@dataclass
class _PendingMapping:
    """Intermediate mapping produced by the parser, before the orchestrator
    resolves `source_url` to the article's UUID.

    Carrying the URL through the pipeline (instead of backfilling via
    order-based heuristics) keeps the pairing correct even when some
    articles in a batch produce zero mappings — the common case for
    irrelevant news.
    """

    source_url: str
    stock_id: str
    sentiment: str | None = None
    impact_direction: str | None = None
    impact_severity: str | None = None
    confidence: float | None = None
    rationale: str | None = None


@dataclass
class _PendingRelationship:
    """Intermediate relationship — same source_url side-channel."""

    source_url: str
    source_stock_id: str
    target_stock_id: str
    relationship_type: str
    confidence: float | None = None
    rationale: str | None = None


@dataclass
class ComputeNewsResult:
    articles_written: int = 0
    mappings_written: int = 0
    relationships_written: int = 0
    skipped_seen: int = 0
    failed_feeds: int = 0
    failed_llm_batches: int = 0


# ===== RSS ingestion ======================================================


def parse_rss_feeds(env_value: str) -> list[RssSource]:
    """Parse NEWS_RSS_FEEDS (JSON string) into a list of RssSource.

    Returns [] on missing / malformed input — caller logs and proceeds
    with whatever the rest of the pipeline can do.
    """
    if not env_value or not env_value.strip():
        return []
    try:
        raw = json.loads(env_value)
    except json.JSONDecodeError as exc:
        logger.warning(f"NEWS_RSS_FEEDS is not valid JSON: {exc}")
        return []
    out: list[RssSource] = []
    for item in raw:
        try:
            out.append(
                RssSource(
                    name=str(item["name"]),
                    url=str(item["url"]),
                    market=item.get("market", "GLOBAL"),
                )
            )
        except (KeyError, TypeError) as exc:
            logger.warning(f"NEWS_RSS_FEEDS skipping malformed entry: {exc}")
    return out


def fetch_rss_articles(
    cfg: WorkerConfig,
    sources: list[RssSource],
    *,
    transport: httpx.Client | None = None,
) -> list[NewsArticle]:
    """Pull each source's entries, filter to the lookback window, return NewsArticle rows.

    Feed failures are logged-and-skipped; a broken feed doesn't abort the
    rest. The caller is expected to throttle between feeds.
    """
    if not sources:
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=cfg.news_lookback_hours)
    own_transport = transport is None
    if own_transport:
        transport = httpx.Client(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": "eyesinvest-worker/0.2 (+news-sync)"},
            follow_redirects=True,
        )
    out: list[NewsArticle] = []
    try:
        for src in sources:
            try:
                resp = transport.get(src.url)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning(f"news RSS [{src.name}]: fetch failed: {exc}")
                continue
            parsed = feedparser.parse(resp.content)
            if parsed.bozo and not parsed.entries:
                logger.warning(
                    f"news RSS [{src.name}]: malformed feed "
                    f"(bozo={parsed.bozo_exception!r})"
                )
                continue
            kept = 0
            for entry in parsed.entries:
                article = _entry_to_article(entry, src.name, cutoff)
                if article is None:
                    continue
                out.append(article)
                kept += 1
            logger.info(f"news RSS [{src.name}]: {kept} article(s) within lookback")
    finally:
        if own_transport:
            transport.close()
    return out


def _entry_to_article(
    entry: Any, source_name: str, cutoff: datetime
) -> NewsArticle | None:
    """Convert one feedparser entry to NewsArticle, or None to skip.

    Skips entries with no title, no link, or published_at older than the
    lookback window. Returns None (not raise) so the caller can keep
    accumulating good entries even if a few are junk.
    """
    title = (getattr(entry, "title", "") or "").strip()
    link = (getattr(entry, "link", "") or "").strip()
    if not title or not link:
        return None
    summary = (getattr(entry, "summary", None) or "").strip() or None
    published_at = _parse_published(entry)
    if published_at is None:
        # No published_at → trust the feed but include the article. This
        # avoids dropping everything from feeds that omit <pubDate>.
        pass
    elif published_at < cutoff:
        return None

    raw_metadata: dict[str, Any] = {}
    for key in ("id", "author", "tags", "updated", "updated_parsed"):
        v = getattr(entry, key, None)
        if v is not None:
            raw_metadata[key] = str(v) if not isinstance(v, (str, int, float, list, dict)) else v

    return NewsArticle(
        source_url=link,
        source_name=source_name,
        title=title,
        summary=summary,
        published_at=published_at,
        language="en",
        raw_metadata=raw_metadata or None,
    )


def _parse_published(entry: Any) -> datetime | None:
    """Read `published_parsed` (time tuple) → UTC datetime. None when absent."""
    pp = getattr(entry, "published_parsed", None)
    if pp is None:
        return None
    try:
        return datetime(*pp[:6], tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


# ===== LLM extraction =====================================================


_SYSTEM_PROMPT = """You are a financial analyst classifying English-language news \
articles. For each article, identify (a) which stocks from the provided universe \
are materially affected, with sentiment (bullish/bearish/neutral), direction \
(positive/negative/mixed/none), severity (low/medium/high/critical), a confidence \
in [0, 1], and a one-sentence rationale; and (b) any direct stock-to-stock \
relationships implied (supplier, competitor, customer, partner, \
parent_subsidiary) with confidence and a one-sentence rationale.

Only return stocks from the provided universe. Only return relationships between \
two stocks in the provided universe. Skip articles that don't affect any stock in \
the universe. Output JSON only, no prose."""


def extract_news_relationships(
    cfg: WorkerConfig,
    articles: list[NewsArticle],
    stocks: list[StockRecord],
    *,
    openai_client: OpenAI | None = None,
) -> tuple[list[_PendingMapping], list[_PendingRelationship]]:
    """Bundle articles into LLM calls and parse per-article impact + relationships.

    Returns (pending_mappings, pending_relationships) — intermediate types
    that carry `source_url` so the orchestrator can resolve to article_id
    in one batched query. Symbols the model returns that aren't in the
    stock universe are dropped with a warning.
    """
    if not cfg.openrouter_api_key:
        logger.warning(
            "OPENROUTER_API_KEY not set — skipping AI pass; "
            "ey_news_article rows will still be written"
        )
        return [], []
    if not articles:
        return [], []

    symbol_to_id: dict[str, str] = {s.symbol: s.id for s in stocks}
    universe_lines = "\n".join(
        f"- {s.symbol} ({s.market})" for s in sorted(stocks, key=lambda x: x.symbol)
    )

    own_client = openai_client is None
    if own_client:
        openai_client = OpenAI(
            base_url=cfg.openrouter_base_url,
            api_key=cfg.openrouter_api_key,
        )

    pending_mappings: list[_PendingMapping] = []
    pending_rels: list[_PendingRelationship] = []

    batch_size = max(1, cfg.openrouter_max_articles_per_llm_call)
    batches = [
        articles[i : i + batch_size] for i in range(0, len(articles), batch_size)
    ]
    for batch_idx, batch in enumerate(batches, start=1):
        prompt = _build_user_prompt(batch, universe_lines)
        try:
            resp = openai_client.chat.completions.create(
                model=cfg.openrouter_model,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
                # 8000 = Haiku's per-call output cap. With full bodies
                # (~1.5K tokens each) the model can produce 2-3K tokens of
                # JSON per article × 5 articles = ~10K tokens worst case.
                # Setting to 8000 lets the model finish its thought
                # without truncating to malformed JSON. If your model has
                # a smaller limit (e.g. z-ai/glm-flash), OpenRouter will
                # cap server-side and return less.
                max_tokens=8000,
            )
        except Exception as exc:  # noqa: BLE001 — openai raises broad exceptions
            logger.warning(
                f"news LLM [{batch_idx}/{len(batches)}]: call failed: {exc}"
            )
            time.sleep(cfg.openrouter_throttle_seconds)
            continue

        usage = getattr(resp, "usage", None)
        if usage is not None:
            logger.info(
                f"news LLM [{batch_idx}/{len(batches)}]: "
                f"in={getattr(usage, 'prompt_tokens', '?')} "
                f"out={getattr(usage, 'completion_tokens', '?')}"
            )

        content = (resp.choices[0].message.content or "").strip()
        batch_mappings, batch_rels = _parse_llm_response(
            content=content,
            batch=batch,
            symbol_to_id=symbol_to_id,
            batch_idx=batch_idx,
            total_batches=len(batches),
        )
        pending_mappings.extend(batch_mappings)
        pending_rels.extend(batch_rels)

        time.sleep(cfg.openrouter_throttle_seconds)

    return pending_mappings, pending_rels


def _build_user_prompt(batch: list[NewsArticle], universe_lines: str) -> str:
    numbered = "\n\n".join(
        f"[Article {i + 1}] source={a.source_name}\n"
        f"title: {a.title}\n"
        f"summary: {a.summary or '(none)'}\n"
        f"url: {a.source_url}"
        for i, a in enumerate(batch)
    )
    return (
        f"Stock universe (use ONLY these symbols):\n{universe_lines}\n\n"
        f"Articles to analyse:\n{numbered}\n\n"
        "Return JSON in this exact shape:\n"
        "{\n"
        '  "items": [\n'
        '    {\n'
        '      "article_index": 1,\n'
        '      "affected_stocks": [\n'
        '        {"symbol": "AAPL", "sentiment": "bullish", '
        '"impact_direction": "positive", "impact_severity": "high", '
        '"confidence": 0.87, "rationale": "..."}\n'
        "      ],\n"
        '      "relationships": [\n'
        '        {"source_symbol": "AAPL", "target_symbol": "TSM", '
        '"type": "supplier", "confidence": 0.72, "rationale": "..."}\n'
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def _parse_llm_response(
    *,
    content: str,
    batch: list[NewsArticle],
    symbol_to_id: dict[str, str],
    batch_idx: int,
    total_batches: int,
) -> tuple[list[_PendingMapping], list[_PendingRelationship]]:
    """Parse the LLM's JSON response into intermediate rows.

    Returns ([], []) on any parse error — we don't want a bad batch to
    abort the run. Unknown symbols are dropped with a warning so the LLM
    can't smuggle in fake tickers. Each row carries `source_url` so the
    orchestrator can resolve to article_id without order-based heuristics.
    """
    if not content:
        logger.warning(
            f"news LLM [{batch_idx}/{total_batches}]: empty response — skipping batch"
        )
        return [], []
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        logger.warning(
            f"news LLM [{batch_idx}/{total_batches}]: JSON parse failed: {exc}"
        )
        return [], []
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        logger.warning(
            f"news LLM [{batch_idx}/{total_batches}]: no `items` list — skipping batch"
        )
        return [], []

    pending_mappings: list[_PendingMapping] = []
    pending_rels: list[_PendingRelationship] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        idx = item.get("article_index")
        if not isinstance(idx, int) or idx < 1 or idx > len(batch):
            continue
        article = batch[idx - 1]

        for entry in item.get("affected_stocks") or []:
            if not isinstance(entry, dict):
                continue
            symbol = entry.get("symbol")
            if not isinstance(symbol, str):
                continue
            stock_id = symbol_to_id.get(symbol)
            if stock_id is None:
                logger.warning(
                    f"news LLM: dropping unknown symbol {symbol!r}"
                )
                continue
            pending_mappings.append(
                _PendingMapping(
                    source_url=article.source_url,
                    stock_id=stock_id,
                    sentiment=entry.get("sentiment"),
                    impact_direction=entry.get("impact_direction"),
                    impact_severity=entry.get("impact_severity"),
                    confidence=_coerce_confidence(entry.get("confidence")),
                    rationale=_coerce_str(entry.get("rationale")),
                )
            )

        for entry in item.get("relationships") or []:
            if not isinstance(entry, dict):
                continue
            src = entry.get("source_symbol")
            tgt = entry.get("target_symbol")
            rtype = entry.get("type")
            if not (isinstance(src, str) and isinstance(tgt, str) and isinstance(rtype, str)):
                continue
            src_id = symbol_to_id.get(src)
            tgt_id = symbol_to_id.get(tgt)
            if src_id is None or tgt_id is None:
                logger.warning(
                    f"news LLM: dropping relationship with unknown symbol "
                    f"({src!r} -> {tgt!r})"
                )
                continue
            if src_id == tgt_id:
                continue  # self-loop — DB CHECK would reject anyway
            valid_types = {
                "supplier", "competitor", "customer", "partner", "parent_subsidiary"
            }
            if rtype not in valid_types:
                logger.warning(
                    f"news LLM: dropping relationship with unknown type {rtype!r}"
                )
                continue
            pending_rels.append(
                _PendingRelationship(
                    source_url=article.source_url,
                    source_stock_id=src_id,
                    target_stock_id=tgt_id,
                    relationship_type=rtype,
                    confidence=_coerce_confidence(entry.get("confidence")),
                    rationale=_coerce_str(entry.get("rationale")),
                )
            )

    return pending_mappings, pending_rels


def _coerce_confidence(v: Any) -> float | None:
    if isinstance(v, (int, float)):
        return max(0.0, min(1.0, float(v)))
    return None


def _coerce_str(v: Any) -> str | None:
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def _parse_crawl_sources(cfg: WorkerConfig) -> list[CrawlSource]:
    """Resolve the crawl-source list from config.

    Legacy helper — kept for backward compat but unused now that the
    orchestrator uses RSS for URL discovery (Yahoo's listing pages are
    JS-rendered and don't work with HTML crawling). If `NEWS_CRAWL_SOURCES`
    is set, the worker still uses it as an *additional* source.
    """
    raw = cfg.news_crawl_sources_raw
    if not raw or not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning(f"NEWS_CRAWL_SOURCES is not valid JSON: {exc}")
        return []
    if not isinstance(data, list):
        logger.warning("NEWS_CRAWL_SOURCES must be a JSON array of objects")
        return []
    out: list[CrawlSource] = []
    for item in data:
        try:
            out.append(
                CrawlSource(
                    name=str(item["name"]),
                    listing_urls=[str(u) for u in item.get("listing_urls", [])],
                    site_filter=str(item.get("site_filter", "")),
                )
            )
        except (KeyError, TypeError) as exc:
            logger.warning(f"NEWS_CRAWL_SOURCES skipping malformed entry: {exc}")
    return out


def _enrich_with_full_body(
    rss_articles: list[NewsArticle],
    *,
    throttle_seconds: float,
) -> list[NewsArticle]:
    """Fetch each RSS-discovered article's full body and replace its summary.

    Returns the input list with `summary` upgraded from the RSS ~300-char
    snippet to the full article body (~2-10 KB). Articles whose body
    can't be extracted keep their RSS summary — the LLM still has the
    title + URL to work with, just less context.

    Per-article failures are logged + skipped. Throttling is applied
    between requests to be polite to source sites.
    """
    if not rss_articles:
        return rss_articles

    out: list[NewsArticle] = []
    enriched = 0
    failed = 0

    # Single transport reused across all article fetches — cheaper than
    # a fresh client per article.
    with httpx.Client(
        timeout=httpx.Timeout(15.0, connect=5.0),
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
            "Accept-Language": "en-US,en;q=0.9",
        },
        follow_redirects=True,
    ) as transport:
        for i, article in enumerate(rss_articles, start=1):
            try:
                resp = transport.get(article.source_url)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning(
                    f"body fetch [{i}/{len(rss_articles)}]: GET failed for "
                    f"{article.source_url}: {exc}"
                )
                failed += 1
                out.append(article)
                continue

            title, body, published_at = extract_article_body(
                resp.text, article.source_url
            )
            if body:
                enriched += 1
                out.append(
                    NewsArticle(
                        source_url=article.source_url,
                        source_name=article.source_name,
                        title=title or article.title,
                        summary=body[:8000],  # cap so LLM prompt stays bounded
                        published_at=published_at or article.published_at,
                        language=article.language,
                        raw_metadata={
                            **(article.raw_metadata or {}),
                            "full_body_length": len(body),
                            "body_source": "trafilatura",
                        },
                    )
                )
            else:
                # Body extraction failed — keep the RSS summary, the LLM
                # can still do partial work with title + URL.
                failed += 1
                out.append(article)

            if i % 10 == 0:
                logger.info(
                    f"body fetch [{i}/{len(rss_articles)}]: "
                    f"{enriched} enriched, {failed} kept RSS summary"
                )
            time.sleep(throttle_seconds)

    logger.info(
        f"sync-news: body enrichment done — "
        f"{enriched}/{len(rss_articles)} articles got full body"
    )
    return out


# ===== Orchestrator ======================================================


def compute_news(
    client: Any, cfg: WorkerConfig, *, skip_llm: bool = False
) -> ComputeNewsResult:
    """Top-level entry point: ingest via RSS + crawl full bodies, analyse.

    Always returns a ComputeNewsResult so the CLI can log a useful summary
    even on partial failures. `skip_llm=True` makes the function fetch +
    write articles only (handy for smoke-testing the fetch path without
    burning an OpenRouter budget).

    The path:
      1. RSS feed discovery — fetch each feed in NEWS_RSS_FEEDS, parse
         with feedparser. Get (URL, title, ~300-char summary) for each
         article.
      2. Body enrichment — for each article URL, GET the article page
         and run trafilatura to extract the full body. Replace the RSS
         summary with the body so the LLM sees real text.
      3. Cap to NEWS_MAX_ARTICLES_PER_RUN.
      4. UPSERT all rows to ey_news_article (dedupe by source_url).
      5. LLM pass on fresh articles (those without admin-resolved
         mappings).
      6. UPSERT mappings + relationships; admin-resolved rows preserved.

    Why RSS + crawl (not pure crawl)? Most news sites (Reuters,
    MarketWatch, CNBC, Yahoo RSS) publish server-rendered RSS feeds
    that work reliably from any IP. Their HTML listing pages, however,
    are JS-rendered SPAs that BeautifulSoup can't parse. Hybrid
    gets the reliability of RSS for URL discovery plus the full text
    of each article via the crawler.
    """
    result = ComputeNewsResult()

    # Pass 1: RSS discovery.
    sources = parse_rss_feeds(cfg.news_rss_feeds_raw)
    if not sources:
        logger.warning(
            "sync-news: NEWS_RSS_FEEDS is empty — nothing to ingest "
            "(set NEWS_RSS_FEEDS to a JSON list of feed entries)"
        )
        return result

    logger.info(f"sync-news: fetching {len(sources)} feed(s)")
    rss_articles = fetch_rss_articles(cfg, sources)
    if not rss_articles:
        logger.warning("sync-news: no articles fetched from RSS — exiting")
        return result
    logger.info(
        f"sync-news: {len(rss_articles)} article(s) discovered from feeds"
    )

    # Cap BEFORE the expensive body-enrichment pass.
    if len(rss_articles) > cfg.news_max_articles_per_run:
        logger.info(
            f"sync-news: capping {len(rss_articles)} -> "
            f"{cfg.news_max_articles_per_run} articles (NEWS_MAX_ARTICLES_PER_RUN)"
        )
        rss_articles = rss_articles[: cfg.news_max_articles_per_run]

    # Pass 2: body enrichment via crawler (unless explicitly disabled).
    if cfg.news_crawl_body_enabled:
        raw_articles = _enrich_with_full_body(
            rss_articles,
            throttle_seconds=cfg.news_throttle_seconds,
        )
    else:
        raw_articles = rss_articles
        logger.info(
            "sync-news: NEWS_CRAWL_BODY_ENABLED=false — using RSS summaries "
            "(lighter mode, lower quality)"
        )

    # Cap to the per-run budget.
    if len(raw_articles) > cfg.news_max_articles_per_run:
        logger.info(
            f"sync-news: capping {len(raw_articles)} -> "
            f"{cfg.news_max_articles_per_run} articles (NEWS_MAX_ARTICLES_PER_RUN)"
        )
        raw_articles = raw_articles[: cfg.news_max_articles_per_run]

    # Idempotency: skip URLs whose mappings are admin-resolved (approved
    # or rejected). Articles with no mapping rows OR only 'pending'
    # mappings are NOT in this set — they get re-analyzed, so the LLM
    # refreshes the AI columns on every run. See
    # `fetch_existing_news_urls` for the full contract.
    seen = fetch_existing_news_urls(client)
    fresh = [a for a in raw_articles if a.source_url not in seen]
    result.skipped_seen = len(raw_articles) - len(fresh)
    if result.skipped_seen:
        logger.info(
            f"sync-news: {result.skipped_seen} article(s) already seen — skipping LLM"
        )

    # Write articles (both fresh AND seen — we still want the row to exist
    # so the URL appears in the table). UPSERT is a no-op on duplicates.
    result.articles_written = upsert_news_articles(client, raw_articles)

    # Pass B: LLM analysis (only on the fresh subset).
    if skip_llm:
        logger.info("sync-news: --skip-llm set; skipping AI pass")
        return result
    if not fresh:
        logger.info("sync-news: no fresh articles to analyse")
        return result
    if not cfg.openrouter_api_key:
        logger.warning(
            "sync-news: OPENROUTER_API_KEY missing; AI pass skipped "
            "(set OPENROUTER_API_KEY in workers/yfinance/.env)"
        )
        return result

    stocks = fetch_active_stocks(client)
    if not stocks:
        logger.warning("sync-news: no active stocks in ey_stocks — AI pass skipped")
        return result

    pending_mappings, pending_rels = extract_news_relationships(cfg, fresh, stocks)

    # Resolve source_url -> article_id with one batched SELECT. The articles
    # were just upserted (Pass A), so every fresh URL is guaranteed to be
    # present. We use a single SELECT for the whole batch's URL set to keep
    # the orchestrator cheap.
    fresh_urls = [a.source_url for a in fresh]
    url_to_id: dict[str, str] = {}
    for url in fresh_urls:
        aid = fetch_news_article_id(client, url)
        if aid is not None:
            url_to_id[url] = aid

    if not url_to_id:
        logger.warning(
            "sync-news: no article IDs resolved — dropping AI mappings"
        )
        return result

    final_mappings: list[NewsStockMapping] = []
    for pm in pending_mappings:
        article_id = url_to_id.get(pm.source_url)
        if article_id is None:
            logger.warning(
                f"sync-news: dropping mapping with unresolved URL {pm.source_url!r}"
            )
            continue
        final_mappings.append(
            NewsStockMapping(
                article_id=article_id,
                stock_id=pm.stock_id,
                sentiment=pm.sentiment,
                impact_direction=pm.impact_direction,
                impact_severity=pm.impact_severity,
                confidence=pm.confidence,
                rationale=pm.rationale,
            )
        )

    final_relationships: list[StockRelationship] = []
    for pr in pending_rels:
        evidence = url_to_id.get(pr.source_url)
        final_relationships.append(
            StockRelationship(
                source_stock_id=pr.source_stock_id,
                target_stock_id=pr.target_stock_id,
                relationship_type=pr.relationship_type,  # type: ignore[arg-type]
                confidence=pr.confidence,
                rationale=pr.rationale,
                evidence_news_id=evidence,
            )
        )

    result.mappings_written = upsert_news_stock_mappings(client, final_mappings)
    result.relationships_written = upsert_stock_relationships(
        client, final_relationships
    )

    return result