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

// ============================================================================
// Volume Efficiency + Crowded Ratio — combination metrics for the Volume tab
// and the screener.
// ============================================================================

/**
 * "1% price move per 1% of float" — the textbook measure of how much
 * information a session's volume carried. Computed as
 *   turnoverPct = volume / sharesOutstanding * 100
 *   efficiency  = |changePercent| / turnoverPct
 * Returns `null` when `sharesOutstanding` is missing or zero, so the panel
 * can show a "no float data" state instead of a misleading number.
 */
export interface VolumeEfficiency {
  symbol: string;
  market: Market;
  /** |change%| ÷ (volume ÷ sharesOutstanding × 100) for the latest trading day. */
  efficiencyToday: number | null;
  /** volume ÷ sharesOutstanding × 100 for the latest trading day. */
  turnoverPctToday: number | null;
  /** 30-day rolling mean of turnoverPct. Null when shares float is unknown. */
  avgTurnoverPct30d: number | null;
  /** Shares outstanding at fetch time, surfaced for context in the panel. */
  sharesOutstanding: number | null;
  /**
   * Cheap gate so the panel can render "Shares outstanding unavailable"
   * instead of dashes — same flag the screener filter cares about.
   */
  hasFloatData: boolean;
  asOfDate: string | null;
  /**
   * Per-day series used by the VolumeEfficiencyChart subplot under the
   * main PriceChart. Length matches the volume window pulled by
   * `getVolumeEfficiency`. `efficiency` is null on the first day (no
   * close-over-close prior) or whenever turnoverPct is unknown.
   */
  series: EfficiencyPoint[];
}

/**
 * Per-day record for the Volume Efficiency subplot. `efficiency` =
 * `|dailyChangePct| / turnoverPct`; the inputs are kept on the shape so
 * the UI can show a tooltip / breakdown later without a second query.
 */
export interface EfficiencyPoint {
  /** ISO date string YYYY-MM-DD. */
  date: string;
  /** |changePct| / turnoverPct for this day. Null when prior day or shares are missing. */
  efficiency: number | null;
  /** volume / sharesOutstanding × 100 for this day. Null when shares are missing. */
  turnoverPct: number | null;
  /** (close - prevClose) / prevClose × 100. Null on the first day. */
  dailyChangePct: number | null;
}

/** Per-day MA5 / MA30 of volume + their ratio, used to plot the subgraph. */
export interface CrowdedRatioPoint {
  date: string;
  ratio: number | null;
  ma5: number | null;
  ma30: number | null;
}

/**
 * FOMO_Ratio = MA5(volume) ÷ MA30(volume). Latest value plus the full daily
 * series so the UI can plot a MA5/MA30 subgraph.
 *
 * Regime bucketing (qualitative, derived from the latest ratio):
 *   ratio ≥ 1.5  → crowded    (recent activity well above baseline)
 *   ratio ≥ 1.2  → elevated
 *   ratio ≥ 0.8  → normal
 *   ratio < 0.8  → subdued
 *   ratio == null → null       (insufficient history)
 */
export type CrowdedRegime = 'crowded' | 'elevated' | 'normal' | 'subdued';

export interface CrowdedRatio {
  symbol: string;
  market: Market;
  /** Latest MA5 ÷ MA30 (null until both windows have enough history). */
  ratio: number | null;
  /** Latest MA5 of volume. */
  ma5: number | null;
  /** Latest MA30 of volume. */
  ma30: number | null;
  regime: CrowdedRegime | null;
  /** Same length as the volume series pulled for this query. */
  series: CrowdedRatioPoint[];
  asOfDate: string | null;
}

// ============================================================================
// Short Selling (FINRA) — US-only. HK stocks short-circuit upstream to null.
// ============================================================================

/**
 * One bar on the daily Reg-SHO chart.
 *   shortPctOfVolume = short_volume / total_volume × 100
 */
export interface ShortSellingPoint {
  date: string;
  /** shortVolume / totalVolume × 100. Null when totalVolume is 0. */
  shortPctOfVolume: number | null;
  /** FINRA-reported short volume (shares). */
  shortVolume: number;
  /** FINRA-reported total volume (shares). */
  totalVolume: number;
}

/** One bi-weekly settlement point from FINRA short-interest. */
export interface ShortInterestPoint {
  date: string;
  /** Shares sold short outstanding at settlement date. */
  shortInterest: number;
  /** Change vs prior settlement (signed %). */
  changePct: number | null;
  /** shortInterest ÷ avg_daily_volume_30d. Null when avg volume is 0. */
  daysToCover: number | null;
}

/**
 * Combined US short-selling payload for the subplot. The header pills surface
 * `todayShortPctOfVolume` + `todayShortVolume` (daily KPIs) plus
 * `shortInterest` + change + daysToCover (bi-weekly KPIs). The chart renders
 * the bi-weekly short-interest line only; the daily series drives the
 * pills and is kept so the caller can chart it elsewhere later.
 */
export interface ShortSelling {
  symbol: string;
  market: Market;
  /** Latest daily short % of FINRA volume. Null when no daily data. */
  todayShortPctOfVolume: number | null;
  /** Latest daily short-volume amount in shares. Null when no daily data. */
  todayShortVolume: number | null;
  /** Latest short interest (shares outstanding). Null when no bi-weekly data. */
  shortInterest: number | null;
  /** Change vs prior settlement, signed percent. Null when no prior. */
  shortInterestChangePct: number | null;
  /** Latest short interest ÷ 30-day avg daily volume (trading days). Null when avg is 0. */
  daysToCover: number | null;
  asOfDate: string | null;
  series: {
    sale: ShortSellingPoint[];
    interest: ShortInterestPoint[];
  };
}

// ============================================================================
// Sector detail page — slim per-stock row for `/[locale]/sectors/[sector]`.
// Joins ey_stocks + ey_quote_snapshot + latest ey_stock_analytics row client-side
// (no SQL view). Kept narrower than ScreenerRow to avoid pulling efficiency /
// crowded / fundamentals into a list page that doesn't use them.
// ============================================================================

export interface SectorMember {
  symbol: string;
  name: string;
  market: Market;
  currency: string;
  sector: string | null;
  lastPrice: number | null;
  changePercent: number | null;
  return1m: number | null;
}

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
  /** |change%| / (volume / sharesOutstanding * 100) for the latest day. Null when shares float is unknown. */
  volumeEfficiencyToday: number | null;
  /** MA5(volume) / MA30(volume) for the latest day. Null until ≥30 days of history. */
  crowdedRatio: number | null;
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
  /** Lower bound on volume efficiency (ratio, e.g. 1 = ≥1×). */
  volumeEfficiencyMin?: number;
  /** Lower bound on crowded ratio (MA5÷MA30, e.g. 1.5 = ≥1.5×). */
  crowdedRatioMin?: number;
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
