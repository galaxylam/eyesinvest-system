import type { Market } from './market';

/**
 * Raw RSS article stored in `ey_news_article`. One row per article ever
 * seen, deduped by `source_url`. Written by `sync-news` (Phase 7); never
 * mutated by admin. Public-read RLS.
 */
export interface NewsArticleRow {
  id: string;
  /** Unique URL — also the natural dedupe key. */
  sourceUrl: string;
  /** Display name of the upstream feed, e.g. 'Reuters', 'Yahoo Finance'. */
  sourceName: string;
  title: string;
  summary: string | null;
  /** ISO timestamp from the feed's <pubDate> / <published>. Null when the feed omits it. */
  publishedAt: string | null;
  /** ISO timestamp of when `sync-news` first fetched this row. */
  fetchedAt: string;
  /** v1 is English only; the migration CHECK constraint enforces it. */
  language: 'en';
  /** feedparser's parsed entry dict (minus raw bytes). For debugging / future extraction. */
  rawMetadata: Record<string, unknown> | null;
  createdAt: string;
  source: string;
}

/**
 * Application-layer DTO. Same as NewsArticleRow but camelCase + dropped
 * provenance fields that the UI doesn't need (rawMetadata, createdAt).
 */
export interface NewsArticleDto {
  id: string;
  sourceUrl: string;
  sourceName: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  language: 'en';
}

/**
 * Minimal stock metadata that's joined onto mapping / relationship DTOs
 * so the admin UI doesn't have to fan out to a second query.
 */
export interface NewsStockRef {
  id: string;
  symbol: string;
  market: Market;
  name: string;
}

/**
 * RSS source configured by the worker. Read from `NEWS_RSS_FEEDS` env var
 * (JSON list); passed into the provider as the "what to fetch" allowlist.
 */
export interface RssSource {
  name: string;
  url: string;
  /** 'US' | 'HK' | 'GLOBAL' — informational only; the worker treats the universe uniformly. */
  market: Market | 'GLOBAL';
}