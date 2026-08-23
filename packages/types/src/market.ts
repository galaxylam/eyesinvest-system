/**
 * Supported equity markets. US and Hong Kong only in Phase 1; expanding
 * the union lets us add more markets without breaking existing code.
 */
export const MARKETS = ['US', 'HK'] as const;
export type Market = (typeof MARKETS)[number];

export const MARKET_TIMEZONES: Record<Market, string> = {
  US: 'America/New_York',
  HK: 'Asia/Hong_Kong',
};

export const MARKET_CURRENCIES: Record<Market, string> = {
  US: 'USD',
  HK: 'HKD',
};
