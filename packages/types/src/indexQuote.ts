import type { Market } from './market';

/**
 * Reference market indices tracked by the platform. Phase 3 ships SPX
 * (S&P 500, US) and HSI (Hang Seng, HK). The provider is the same yfinance
 * worker; ticker mapping is `^GSPC` → SPX and `^HSI` → HSI.
 */
export type IndexCode = 'SPX' | 'HSI';

export interface IndexMeta {
  code: IndexCode;
  market: Market;
  /** yfinance ticker symbol, e.g. '^GSPC' for SPX. */
  yfTicker: string;
  nameEn: string;
  nameZhHk: string;
  nameZhCn: string;
}

export const MARKET_INDICES: Record<IndexCode, IndexMeta> = {
  SPX: {
    code: 'SPX',
    market: 'US',
    yfTicker: '^GSPC',
    nameEn: 'S&P 500',
    nameZhHk: '標普500',
    nameZhCn: '标普500',
  },
  HSI: {
    code: 'HSI',
    market: 'HK',
    yfTicker: '^HSI',
    nameEn: 'Hang Seng Index',
    nameZhHk: '恆生指數',
    nameZhCn: '恒生指数',
  },
};

export interface IndexQuote {
  code: IndexCode;
  market: Market;
  last: number;
  previousClose: number;
  change: number;
  changePercent: number;
  /** ISO date (YYYY-MM-DD) of the trading session. */
  asOf: string;
}
