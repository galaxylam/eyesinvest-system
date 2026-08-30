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
 * `volume` is the raw share count for the day — needed by the chart to
 * compute the green/red volume share pill (sum of up-day volume ÷ total
 * volume) without re-fetching.
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
  /** Raw daily share volume. Null when not available. */
  volume: number | null;
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
// Short Selling — US (FINRA Reg-SHO) + HK (HKEX daily + morning session).
// US stocks drive the pct-of-volume bar; HK stocks drive an absolute-volume
// histogram with a separate morning-session overlap bar.
// ============================================================================

/**
 * One bar on the daily short-selling chart.
 *   shortPctOfVolume = short_volume / total_volume × 100  (US only — null for HK)
 *
 * For HK rows, `shortVolume` and `amShortVolume` are absolute HKEX shares,
 * and `totalVolume` is always 0 (HKEX does not publish total daily volume).
 */
export interface ShortSellingPoint {
  date: string;
  /** shortVolume / totalVolume × 100. Null when totalVolume is 0. */
  shortPctOfVolume: number | null;
  /** FINRA-reported short volume (US) or HKEX-reported full-day short volume (HK). */
  shortVolume: number;
  /** FINRA-reported total volume (US only; HKEX doesn't publish this). */
  totalVolume: number;
  /** HKEX morning-session short volume. Null until ~12:30 HKT, null for US. */
  amShortVolume: number | null;
  /** HKEX morning-session HKD turnover. Null until ~12:30 HKT, null for US. */
  amShortValueHkd: number | null;
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
 * Combined US + HK short-selling payload for the subplot. The header pills
 * surface the daily KPIs (`todayShortPctOfVolume` for US, `todayShortVolume`
 * for HK) plus HK's morning-session pills when available
 * (`todayAmShortVolume`, `todayAmShortValueHkd`, `todayAmPctOfFullDay`).
 * Bi-weekly short-interest KPIs (`shortInterest`, `shortInterestChangePct`,
 * `daysToCover`) are shared across markets. The chart renders the bi-weekly
 * short-interest line for both; the daily series is rendered as a
 * pct-of-volume histogram for US and as an absolute-volume histogram with
 * an AM overlap for HK.
 */
export interface ShortSelling {
  symbol: string;
  market: Market;
  /** Latest daily short % of FINRA volume. Null when no daily data. */
  todayShortPctOfVolume: number | null;
  /** Latest daily short-volume amount in shares. Null when no daily data. */
  todayShortVolume: number | null;
  /** HK-only. Latest AM-session short volume (shares). Null until ~12:30 HKT. */
  todayAmShortVolume: number | null;
  /** HK-only. Latest AM-session HKD turnover. Null until ~12:30 HKT. */
  todayAmShortValueHkd: number | null;
  /** HK-only. AM share of today's full-day turnover (0..100). Null until full-day is published. */
  todayAmPctOfFullDay: number | null;
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
// Short Squeeze — composite analytical layer over the short-selling inputs.
// Combines days-to-cover, short-interest Δ, drawdown, volume spike, and
// (HK-only) AM-session share into a single 0..100 score. Populated by the
// `sync-squeeze` worker command; surfaced as `SqueezeCard` on the stock
// detail page and as a screener column + filter. See docs/SQUEEZE.md.
// ============================================================================

export type SqueezeRegime = 'high' | 'elevated' | 'normal' | 'low';

/**
 * Per-stock squeeze payload. `score` is null when every component is null
 * — the worker never writes a synthetic zero. `regime` is derived from
 * `score` in the worker (deterministic), so the UI doesn't re-bucket.
 */
export interface SqueezeScore {
  symbol: string;
  market: Market;
  /** 0..100 composite. Null when insufficient data. */
  score: number | null;
  /** ≥70 high, ≥50 elevated, ≥30 normal, <30 low. Null when score is null. */
  regime: SqueezeRegime | null;
  /** Latest short_interest ÷ 30D avg volume (trading days). */
  daysToCover: number | null;
  /** Short-interest change vs prior settlement (signed %). */
  siChangePct1w: number | null;
  /** Latest max_drawdown_30d snapshot (negative fraction, e.g. -0.18). */
  drawdown30d: number | null;
  /** mean(volume[-5:]) ÷ mean(volume[-30:]). */
  volumeSpike: number | null;
  /** HK-only. AM short volume ÷ full-day short volume × 100. Null for US. */
  amRatio: number | null;
  asOfDate: string | null;
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
  /** Trailing 30d max drawdown as (lastClose − 30dPeak) ÷ 30dPeak. Negative
   *  fraction, e.g. −0.18 = 18% below the 30d peak. Null until ≥30 days of
   *  history. Used by the "already pulled back" filter — see
   *  `ScreenerFilters.drawdown30dMax`. */
  drawdown30d: number | null;
  /** Signed delta of ma5 vs the prior trading day. Null on the first row of the series. */
  ma5Slope: number | null;
  /** Signed delta of ma20 vs the prior trading day. Null on the first row of the series. */
  ma20Slope: number | null;
  /** Trailing 21d mean(volume on up bars) ÷ mean(volume on down bars). Null until ≥21 days of history. >1 = up-bars traded more. */
  greenRedVolumeRatio1m: number | null;
  /** Trailing 21d SIGNED share in [-1, 1]. Positive when up-bars carried more total volume (magnitude = up-share); negative when down-bars carried more (magnitude = down-share). Null until ≥21 days of history or when the window has no up-or-down signal. Sibling of `greenRedVolumeRatio1m` — share weights high-volume days more heavily. Window matches the stocks page Range picker "1M" so the screener and the stocks-page pill agree. */
  greenRedVolumeShare1m: number | null;
  /** Trend of the latest bi-weekly short_interest. 'up' = latest > previous, 'down' = latest < previous, 'flat' = equal, null = insufficient history (<2 settlements). */
  shortInterestTrend: 'up' | 'down' | 'flat' | null;
  /** 0..100 composite short-squeeze score (see docs/SQUEEZE.md). Null when any
   *  component is missing — never a synthetic zero. */
  squeezeScore: number | null;
}

/** Signed share-threshold for the 1M green/red volume-share filter. The
 *  share is `sum(volume on up bars) ÷ (sum on up bars + sum on down bars)`
 *  over the trailing 21 trading days, encoded with a sign so the colour
 *  zone is explicit (positive = green dominant, negative = red dominant;
 *  magnitude is always the dominant side). The threshold carries the
 *  same convention — the comparison itself decides which zone survives:
 *    * positive threshold → keep rows with `share > threshold` (in green)
 *    * negative threshold → keep rows with `share < threshold` (in red)
 *  E.g. `0.5` ≈ `>+50%`, `-0.4` ≈ `<-40%`. */
export type GreenShareThreshold =
  | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6
  | -0.1 | -0.2 | -0.3 | -0.4 | -0.5 | -0.6;

/** Direction + number of consecutive periods for the short-interest trend
 *  filter. One period = one bi-weekly settlement. */
export interface ShortInterestTrendFilter {
  direction: 'up' | 'down';
  periods: 1 | 2 | 3;
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
  /** Upper bound on 1-month return (percent points, e.g. 5 = ≤+5%).
   *  Use for "stocks that haven't run up too much recently". */
  return1mMax?: number;
  /** Upper bound on 3-month return (percent points, e.g. 10 = ≤+10%). */
  return3mMax?: number;
  /** Upper bound on 6-month return (percent points, e.g. 20 = ≤+20%). */
  return6mMax?: number;
  /** Upper bound on 30-day drawdown (negative fraction, e.g. −0.10 = "at
   *  least 10% off the 30-day peak"). Matches the
   *  `ScreenerRow.drawdown30d` sign convention — nulls are excluded. */
  drawdown30dMax?: number;
  /** Lower bound on volume efficiency (ratio, e.g. 1 = ≥1×). */
  volumeEfficiencyMin?: number;
  /** Lower bound on crowded ratio (MA5÷MA30, e.g. 1.5 = ≥1.5×). */
  crowdedRatioMin?: number;
  /** Upper bound on crowded ratio (e.g. 1 = strictly < 1× — the subdued /
   *  quiet-activity regime). Mutually compatible with `crowdedRatioMin` in
   *  principle, but the UI treats them as separate dropdown options. */
  crowdedRatioMax?: number;
  /** 'up' = latest ma5 > previous ma5, 'down' = latest ma5 ≤ previous ma5. */
  ma5Trend?: 'up' | 'down';
  /** 'up' = latest ma20 > previous ma20, 'down' = latest ma20 ≤ previous ma20. */
  ma20Trend?: 'up' | 'down';
  /** 1M green/red share threshold — single signed number, see
   *  `GreenShareThreshold` for semantics. */
  greenShareThreshold?: GreenShareThreshold;
  /** Short-interest settlement trend over the last N consecutive periods. */
  shortInterestTrend?: ShortInterestTrendFilter;
  /** Lower bound on the 0..100 short-squeeze score (e.g. 60 = ≥Elevated).
   *  Rows with `squeezeScore == null` are excluded — there's no synthetic
   *  zero to filter against. */
  squeezeMin?: number;
  /** Breakout / breakdown filter. The support level is the close on the
   *  highest-volume trading day within the last 20 sessions.
   *    * 'breakout'  → keep stocks where T-1 close < support AND T close > support
   *    * 'breakdown' → keep stocks where T-1 close > support AND T close < support
   *  Rows with insufficient history (< 2 sessions) are excluded. */
  breakout?: 'breakout' | 'breakdown';
}

/**
 * Per-symbol context computed once per screener request and consumed by
 * the breakout / breakdown filter. Mirrors the `interestBySymbol` pattern
 * used for short-interest trends — kept off the `ScreenerRow` type so the
 * UI never sees it. All three values may be `null` when the symbol has
 * fewer than two daily bars; the filter should exclude those rows
 * rather than treat `null` as zero.
 */
export interface BreakoutContext {
  /** Most-recent close (T). */
  tClose: number | null;
  /** Previous close (T-1). */
  tMinus1Close: number | null;
  /** Close on the highest-volume day within the last 20 sessions. */
  supportClose: number | null;
}

export type ScreenerSortColumn =
  | 'symbol'
  | 'marketCap'
  | 'peRatio'
  | 'dividendYield'
  | 'return1m'
  | 'changePercent'
  | 'volume'
  | 'squeezeScore';

export type ScreenerSortDir = 'asc' | 'desc';

export interface ScreenerSort {
  column: ScreenerSortColumn;
  dir: ScreenerSortDir;
}
