import type { Market } from './market';

/**
 * Real-time quote for a stock. Computed by the analytics worker from the
 * latest two rows of `ey_price_1d` (or supplied directly by an intraday feed
 * in a later phase) and stored in `ey_quote_snapshot`.
 */
export type MarketStatus = 'pre' | 'open' | 'closed' | 'post';

export interface Quote {
  symbol: string;
  market: Market;
  currency: string;
  lastPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  /** ISO date (YYYY-MM-DD) of the trading session the quote refers to. */
  asOf: string;
  status: MarketStatus;
}
