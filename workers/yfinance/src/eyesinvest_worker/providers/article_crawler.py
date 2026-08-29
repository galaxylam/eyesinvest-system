"""Web article crawler — Phase 7 enrichment layer.

Replaces the RSS-only ingest path. The worker discovers article URLs from
configured listing pages (Yahoo Finance by default), fetches the full
article body for each, and returns `NewsArticle` rows that carry enough
context for the LLM to do meaningful extraction.

Why not just RSS? RSS feeds typically truncate summaries to ~300 chars
and rarely include the article body. For per-article AI impact analysis
(Phase 8) the LLM needs the full text — without it, the model is
guessing from titles and produces low-confidence or hallucinated
mappings.

Caveat (intentional): this is **brittle per-site code**. Yahoo Finance's
HTML structure changes occasionally. When a layout changes, the regex /
CSS-selector parsers below need updating. To add a new source, write a
new `_parse_<site>` function that returns `(title, url)` pairs and wire
it into `crawl_source`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
import trafilatura
from bs4 import BeautifulSoup

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import NewsArticle


@dataclass
class CrawlSource:
    """One crawl-able news source.

    `name` is the display name (stored on each NewsArticle.source_name).
    `listing_urls` is the list of HTML pages to scrape for article URLs;
    each is fetched in order. `site_filter` restricts discovered URLs to
    a single host (prevents cross-site noise — Yahoo's listing page
    sometimes links to external sources).
    """

    name: str
    listing_urls: list[str]
    site_filter: str  # e.g. 'finance.yahoo.com'


@dataclass
class ComputeCrawlResult:
    articles: list[NewsArticle] = field(default_factory=list)
    failed_listings: int = 0
    failed_articles: int = 0
    total_listing_urls: int = 0


# ===== URL discovery =====================================================


def discover_articles_from_listing(
    html: str,
    source: CrawlSource,
) -> list[tuple[str, str]]:
    """Parse a single listing page's HTML for article links.

    Returns [(title, absolute_url), ...]. Strategy: scan `<a>` tags inside
    the listing's content area (skipping <nav>, <header>, <footer>) whose
    href matches `/news/...` on the source's host. Generic enough to work
    across Yahoo Finance's various layouts (topic pages, main news,
    stock-specific news).
    """
    soup = BeautifulSoup(html, "lxml")
    found: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    site = source.site_filter.lower()
    # Only walk `<main>` and `<article>` if present — falls back to full
    # document. Skips <nav>/<header>/<footer> by construction.
    content_roots = soup.find_all(["main", "article"]) or [soup]
    for root in content_roots:
        for a in root.find_all("a", href=True):
            href = a["href"].strip()
            if not href:
                continue
            # Absolute URL or relative path?
            if href.startswith("/"):
                # Yahoo uses path-relative links; rebuild with the source
                # host. `finance.yahoo.com` is the canonical host.
                url = f"https://{site}{href}"
            elif href.startswith("http"):
                url = href
            else:
                continue
            # Filter: must be on the source host and look like an article link.
            if site not in url.lower():
                continue
            if "/news/" not in url.lower():
                continue
            # Drop obvious non-article paths (photo galleries, video, etc.).
            if any(seg in url.lower() for seg in ("/video/", "/photos/", "/live/")):
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            title = a.get_text(strip=True)
            if not title or len(title) < 8 or len(title) > 300:
                # Skip nav / footer / "Read more" stubs.
                continue
            found.append((title, url))
    return found


# ===== Article body extraction ==========================================


def extract_article_body(html: str, url: str) -> tuple[str | None, str | None, datetime | None]:
    """Extract (title, body, published_at) from a single article page.

    Uses `trafilatura` (purpose-built for article extraction — handles
    boilerplate stripping, JSON-LD metadata, etc.). Returns None for any
    field that couldn't be extracted; the caller skips the article in
    that case rather than writing a half-populated row.
    """
    try:
        extracted = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=False,
            favor_precision=True,  # bias toward clean text over recall
            with_metadata=True,
            output_format="json",
            url=url,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"trafilatura.extract failed for {url}: {exc}")
        return None, None, None
    if not extracted:
        return None, None, None

    import json
    try:
        meta = json.loads(extracted)
    except (TypeError, ValueError):
        # Trafilatura returned plain text (no JSON wrapping) — treat as body.
        body = extracted.strip() if isinstance(extracted, str) else None
        return None, body, None

    title = meta.get("title") or None
    body = meta.get("text") or meta.get("raw_text") or None
    published_at = _parse_trafilatura_date(meta.get("date"))
    return title, body, published_at


def _parse_trafilatura_date(s: Any) -> datetime | None:
    if not s:
        return None
    try:
        # Trafilatura returns ISO-ish strings; dateparser handles the
        # "Thu, 28 Aug 2026 09:00:00 GMT" cases Yahoo uses.
        from dateparser import parse as _parse
        dt = _parse(str(s), settings={"TIMEZONE": "UTC", "RETURN_AS_TIMEZONE_AWARE": True})
        if dt is None:
            return None
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        return None


# ===== Top-level orchestrator ============================================


def crawl_source(
    source: CrawlSource,
    *,
    lookback_hours: int,
    throttle_seconds: float = 1.0,
    transport: httpx.Client | None = None,
    skip_body_fetch: bool = False,
) -> ComputeCrawlResult:
    """Discover article URLs from listing pages, fetch each body, return
    ready-to-LLM NewsArticle rows.

    Steps:
      1. For each listing URL: GET HTML, parse out (title, url) pairs.
      2. Dedupe across listing pages.
      3. For each unique URL: GET article HTML, extract body via trafilatura.
      4. Build a NewsArticle with the full body as `summary` (so the LLM
         prompt carries the rich text — title and URL come from the listing).

    `skip_body_fetch=True` does step 1+2 only — useful for smoke tests.
    Per-feed failures are logged + skipped, never raised.
    """
    result = ComputeCrawlResult(total_listing_urls=len(source.listing_urls))

    own_transport = transport is None
    if own_transport:
        transport = httpx.Client(
            timeout=httpx.Timeout(20.0, connect=10.0),
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
        )

    try:
        # Phase 1: discover URLs across all listing pages.
        discovered: dict[str, str] = {}  # url -> title
        for listing_url in source.listing_urls:
            try:
                resp = transport.get(listing_url)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning(f"crawl [{source.name}]: listing failed: {exc}")
                result.failed_listings += 1
                continue
            pairs = discover_articles_from_listing(resp.text, source)
            for title, url in pairs:
                discovered.setdefault(url, title)  # first-write wins
            logger.info(
                f"crawl [{source.name}]: listing {listing_url} → {len(pairs)} candidate(s)"
            )
            time.sleep(throttle_seconds)

        if not discovered:
            logger.warning(f"crawl [{source.name}]: no articles discovered across all listings")
            return result

        logger.info(
            f"crawl [{source.name}]: {len(discovered)} unique article URL(s) to fetch"
        )

        if skip_body_fetch:
            # Smoke-test path: emit NewsArticles with the URL title only.
            for url, title in discovered.items():
                result.articles.append(
                    NewsArticle(
                        source_url=url,
                        source_name=source.name,
                        title=title,
                        summary=None,
                    )
                )
            return result

        # Phase 2: fetch each article's body. Throttle aggressively — Yahoo
        # rate-limits datacenter IPs.
        cutoff = datetime.now(timezone.utc) - timedelta_safe(lookback_hours)
        for i, (url, listing_title) in enumerate(discovered.items(), start=1):
            try:
                resp = transport.get(url)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning(f"crawl [{source.name}] [{i}]: GET failed for {url}: {exc}")
                result.failed_articles += 1
                continue

            title, body, published_at = extract_article_body(resp.text, url)
            if not body:
                # Trafilatura couldn't pull text — log + skip rather than
                # write a half-populated row.
                logger.warning(f"crawl [{source.name}] [{i}]: no body extracted from {url}")
                result.failed_articles += 1
                continue

            # Lookback filter: skip articles that are clearly too old.
            # If we can't determine publish time, include the article and
            # let the LLM judge relevance.
            if published_at is not None and published_at < cutoff:
                continue

            result.articles.append(
                NewsArticle(
                    source_url=url,
                    source_name=source.name,
                    title=title or listing_title,
                    summary=body[:8000],  # cap so the LLM prompt stays bounded
                    published_at=published_at,
                    language="en",
                    raw_metadata={"full_body_length": len(body)},
                )
            )
            if i % 10 == 0:
                logger.info(
                    f"crawl [{source.name}] [{i}/{len(discovered)}]: "
                    f"{len(result.articles)} article(s) with body extracted"
                )
            time.sleep(throttle_seconds)

    finally:
        if own_transport:
            transport.close()

    return result


def timedelta_safe(hours: int):
    """Local helper so the import stays at module top-level."""
    from datetime import timedelta
    return timedelta(hours=hours)


# ===== Built-in sources =================================================


def default_yahoo_finance_source() -> CrawlSource:
    """Yahoo Finance listing pages — broad coverage, English, no auth.

    Includes the main news feed + a few high-signal topics. Add more
    `listing_urls` here if you want additional categories; the crawler
    deduplicates across them.
    """
    return CrawlSource(
        name="Yahoo Finance",
        listing_urls=[
            "https://finance.yahoo.com/news/",
            "https://finance.yahoo.com/topic/stock-market-news/",
            "https://finance.yahoo.com/topic/earnings/",
            "https://finance.yahoo.com/topic/latest/",
        ],
        site_filter="finance.yahoo.com",
    )