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
