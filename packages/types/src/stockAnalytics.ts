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
}
