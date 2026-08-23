import type { IndexCode, Market } from '@eyesinvest/types';

export interface StockSearchResult {
  id: string;
  symbol: string;
  name: string;
  market: Market;
  currency: string;
  sector: string | null;
  industry: string | null;
}

export interface StockDetail extends StockSearchResult {
  exchange: string | null;
  isActive: boolean;
  aliases: string[];
}

// ============================================================================
// Phase 4 — shared types for tabbed stock-detail panels.
// Defined here so `queries.ts` and `mock-data.ts` can both import them
// without creating a circular dependency.
// ============================================================================

export interface VolumeAggregates {
  avg30d: number | null;
  avg90d: number | null;
  /** Latest day volume vs 30-day average, as signed percent (e.g. +25.0). */
  latestVs30dPct: number | null;
  maxInWindow: number | null;
  maxDate: string | null;
}

export interface VolumeSeries {
  symbol: string;
  market: Market;
  daily: { date: string; close: number; volume: number; avgVolume20: number | null }[];
  aggregates: VolumeAggregates;
}

export interface RelativeStrength {
  indexCode: IndexCode;
  indexName: { en: string; zhHk: string; zhCn: string };
  indexChangePercent: number | null;
  stockReturn1m: number | null;
  stockReturn3m: number | null;
  stockReturn6m: number | null;
  stockReturn1y: number | null;
  /**
   * Session-only relative strength: stock `changePercent` minus benchmark
   * `changePercent` for today. Per-window RS is intentionally absent —
   * `ey_index_quote` has no per-window history, so subtracting today's index
   * change from a 1m/3m/6m/1y stock return would not be a meaningful metric.
   */
  rsSession: number | null;
}

// ============================================================================
// Screener — denormalised one-row-per-stock shape used by /screener. Combines
// the columns of ey_stocks + ey_quote_snapshot + ey_stock_fundamentals + the
// latest ey_stock_analytics row, joined client-side by stock id.
// ============================================================================

export interface ScreenerRow {
  symbol: string;
  name: string;
  market: Market;
  currency: string;
  sector: string | null;
  lastPrice: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
}

export interface ScreenerFilters {
  /** 'US' | 'HK' | undefined (both). */
  market?: Market;
  /** Exact sector string, or undefined for all. */
  sector?: string;
  /** Lower bound on market cap (USD-equivalent). */
  marketCapMin?: number;
  /** Upper bound on PE ratio (rows with peRatio > peMax are excluded). */
  peMax?: number;
  /** Lower bound on dividend yield (decimal, e.g. 0.01 = 1%). */
  yieldMin?: number;
  /** Lower bound on 1-month return (percent points, e.g. 0 = ≥0%). */
  return1mMin?: number;
}

export type ScreenerSortColumn =
  | 'symbol'
  | 'marketCap'
  | 'peRatio'
  | 'dividendYield'
  | 'return1m'
  | 'changePercent'
  | 'volume';

export type ScreenerSortDir = 'asc' | 'desc';

export interface ScreenerSort {
  column: ScreenerSortColumn;
  dir: ScreenerSortDir;
}
