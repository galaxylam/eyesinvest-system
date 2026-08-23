import type { Market } from './market';
import type { Quote } from './quote';
import type { PriceSeries } from './ohlc';

/**
 * Domain DTOs for stocks. These are the application-layer shape — database
 * rows are mapped into these types by the data layer so the rest of the
 * app doesn't depend on Supabase column names.
 */
export interface Stock {
  id: string;
  symbol: string;
  name: string;
  market: Market;
  currency: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  isActive: boolean;
  aliases: string[];
  /** Hydrated at fetch time, never persisted on the stock row. */
  quote?: Quote;
  latestSeries?: PriceSeries;
}

/**
 * Fundamentals pulled from the worker's `sync-fundamentals` pass and stored
 * on `ey_stocks` (Phase 2 migration `0003_prices_and_fundamentals.sql`).
 * All fields are nullable — providers don't expose every metric for every
 * stock.
 */
export interface StockFundamentals {
  marketCap: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  source: string | null;
  fetchedAt: string | null;
}

export interface StockAlias {
  id: string;
  stockId: string;
  alias: string;
  locale: string | null;
  source: string | null;
}
