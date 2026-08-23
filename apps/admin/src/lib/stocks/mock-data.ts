/**
 * Local mock stock data — kept in sync with the public app's mock set so
 * the admin app's CRUD UI is testable without Supabase. Returns a
 * curated subset of US + HK names.
 */
export interface MockStock {
  id: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  isActive: boolean;
}

const MOCK: MockStock[] = [
  { id: 'AAPL-US', symbol: 'AAPL', name: 'Apple Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics', isActive: true },
  { id: 'MSFT-US', symbol: 'MSFT', name: 'Microsoft Corporation', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Technology', industry: 'Software', isActive: true },
  { id: 'NVDA-US', symbol: 'NVDA', name: 'NVIDIA Corporation', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', isActive: true },
  { id: '0700.HK-HK', symbol: '0700.HK', name: 'Tencent Holdings Ltd.', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Communication Services', industry: 'Internet Content', isActive: true },
  { id: '9988.HK-HK', symbol: '9988.HK', name: 'Alibaba Group Holding Ltd.', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Consumer Cyclical', industry: 'Internet Retail', isActive: true },
];

export function getAllMockStocks(): MockStock[] {
  return MOCK;
}

export function getMockStockDetail(symbol: string): MockStock | null {
  const normalized = symbol.toUpperCase();
  return MOCK.find((s) => s.symbol.toUpperCase() === normalized) ?? null;
}
