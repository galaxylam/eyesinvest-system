import type { Market } from './market';

/**
 * OHLC bar. `time` is the bar's open time. For daily bars it's `YYYY-MM-DD`
 * (the trading date in the market's local timezone).
 */
export interface PriceBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceSeries {
  symbol: string;
  market: Market;
  currency: string;
  bars: PriceBar[];
}
