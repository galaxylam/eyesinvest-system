/**
 * Symbol → market/currency auto-detection.
 *
 * Rules:
 *   - `<TICKER>.HK`  → HK / HKD
 *   - everything else → US / USD
 *
 * The ey_stocks enum only allows US and HK today, so anything outside this
 * pair is rejected upstream (returns `null`). Adding more markets here is a
 * future extension — keep the detector tight to the supported set so the UI
 * can show a clear error rather than silently mis-classifying.
 */
export type SupportedMarket = 'US' | 'HK';
export type SupportedCurrency = 'USD' | 'HKD';

export interface DetectedMarketCurrency {
  market: SupportedMarket;
  currency: SupportedCurrency;
}

export function detectMarketCurrency(symbol: string): DetectedMarketCurrency | null {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return null;
  if (upper.endsWith('.HK')) return { market: 'HK', currency: 'HKD' };
  return { market: 'US', currency: 'USD' };
}
