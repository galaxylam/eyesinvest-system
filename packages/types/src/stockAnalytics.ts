/**
 * Computed analytics for one stock on one trading day. Stored in
 * `ey_stock_analytics` and computed by the worker's `sync-analytics` pass.
 * Every field is nullable — providers may not expose enough history for
 * long-window indicators (e.g. MA200 needs ~200 trading days).
 */
export interface StockAnalytics {
  stockId: string;
  /** ISO date (YYYY-MM-DD) of the trading session. */
  asOfDate: string;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  /** 0..100. >70 conventionally overbought, <30 oversold. */
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  /** Annualized 30-day volatility (stdev of log returns × √252). */
  volatility30d: number | null;
  /** Max drawdown over the last 30 trading days (negative fraction). */
  maxDrawdown30d: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
  return1w: number | null;
  /** |change%| / (volume / sharesOutstanding × 100) for the latest day. Null when shares float is unknown. */
  volumeEfficiency: number | null;
  /** MA5(volume) / MA30(volume) for the latest day. Null until both windows have enough history. */
  crowdedRatio: number | null;
  /** Trailing 1m return minus the stock's market benchmark (SPX for US, HSI for HK). Percent points. Populated only on the most-recent row. */
  relativeStrength: number | null;
}

/**
 * Sector-level rollup written by `sync-sector-strength`. One row per
 * `(sector, as_of_date)` — produced by the worker, surfaced on the
 * dashboard leaderboard tile and (eventually) the screener "by-sector" view.
 */
export interface SectorDailyRow {
  sector: string;
  asOfDate: string;
  memberCount: number;
  /** % of constituents with positive return_1m. 0..100. */
  breadthPct: number | null;
  /** Equal-weight mean of constituents' trailing returns, in percent. */
  sectorReturn1w: number | null;
  sectorReturn1m: number | null;
  sectorReturn3m: number | null;
  sectorReturn6m: number | null;
  sectorReturn1y: number | null;
  /** `sector_return_N − global_market_return_N` where global = mean(SPX, HSI). Percent points. */
  rsVsMarket1w: number | null;
  rsVsMarket1m: number | null;
  rsVsMarket3m: number | null;
  rsVsMarket6m: number | null;
  rsVsMarket1y: number | null;
  /** Mean of constituents' latest volume_efficiency. Null when shares float is unknown. */
  volumeEfficiencyMean: number | null;
  /** Mean of constituents' latest crowded_ratio (MA5÷MA30). */
  crowdedRatioMean: number | null;
}
