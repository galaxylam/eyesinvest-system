import type { Market } from '@eyesinvest/types';

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
