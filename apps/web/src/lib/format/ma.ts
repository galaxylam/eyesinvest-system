/**
 * Helpers to re-shape the `ey_stock_analytics` time series (or its mock
 * equivalent) into the per-window point series the chart needs for moving-
 * average overlays. Null values are dropped so the line has no holes — the
 * worker leaves MA20/50/200 null until enough lookback is available.
 */

import type { StockAnalytics } from '@eyesinvest/types';

export interface MaPoint {
  /** ISO date YYYY-MM-DD — same format as PriceBar.time. */
  time: string;
  value: number;
}

export interface MaSeries {
  ma20: MaPoint[];
  ma50: MaPoint[];
  ma200: MaPoint[];
}

export function extractMaSeries(analytics: StockAnalytics[]): MaSeries {
  const of = (key: 'ma20' | 'ma50' | 'ma200'): MaPoint[] =>
    analytics
      .filter((a) => a[key] != null)
      .map((a) => ({ time: a.asOfDate, value: a[key] as number }));
  return {
    ma20: of('ma20'),
    ma50: of('ma50'),
    ma200: of('ma200'),
  };
}