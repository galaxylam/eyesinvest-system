import type {
  IndexCode,
  IndexQuote,
  Market,
  PriceBar,
  PriceSeries,
  Quote,
  StockAnalytics,
  StockFundamentals,
} from '@eyesinvest/types';
import type { StockDetail, StockSearchResult } from './types';

/**
 * Bundled mock stock universe. Mirrors the planned `local/supabase/seed.sql`
 * so the public app is fully functional during Phase 1 without Supabase
 * running. When Supabase is configured (NEXT_PUBLIC_SUPABASE_URL +
 * NEXT_PUBLIC_SUPABASE_ANON_KEY), the real database takes over.
 */

interface MockStock {
  symbol: string;
  name: string;
  market: Market;
  currency: string;
  exchange: string;
  sector: string;
  industry: string;
  aliases: string[];
}

const STOCKS: MockStock[] = [
  // ===== US =====
  { symbol: 'AAPL', name: 'Apple Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics', aliases: ['Apple', '蘋果', '苹果'] },
  { symbol: 'MSFT', name: 'Microsoft Corporation', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Technology', industry: 'Software', aliases: ['Microsoft', '微軟', '微软'] },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', aliases: ['NVIDIA', '英伟达', '輝達'] },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Internet Retail', aliases: ['Amazon', '亞馬遜', '亚马逊'] },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Communication Services', industry: 'Internet Content', aliases: ['Google', 'Alphabet', '谷歌'] },
  { symbol: 'META', name: 'Meta Platforms Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Communication Services', industry: 'Social Media', aliases: ['Meta', 'Facebook'] },
  { symbol: 'TSLA', name: 'Tesla Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', aliases: ['Tesla', '特斯拉'] },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Financial Services', industry: 'Banks', aliases: ['JPMorgan', '摩根大通'] },
  { symbol: 'BAC', name: 'Bank of America Corp.', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Financial Services', industry: 'Banks', aliases: ['Bank of America', '美國銀行', '美国银行'] },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Energy', industry: 'Oil & Gas', aliases: ['Exxon', '埃克森美孚'] },
  { symbol: 'CVX', name: 'Chevron Corporation', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Energy', industry: 'Oil & Gas', aliases: ['Chevron', '雪佛龍', '雪佛兰'] },
  { symbol: 'WMT', name: 'Walmart Inc.', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Consumer Defensive', industry: 'Discount Stores', aliases: ['Walmart', '沃爾瑪', '沃尔玛'] },
  { symbol: 'KO', name: 'The Coca-Cola Company', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Consumer Defensive', industry: 'Beverages', aliases: ['Coca-Cola', '可口可樂', '可口可乐'] },
  { symbol: 'PEP', name: 'PepsiCo Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Consumer Defensive', industry: 'Beverages', aliases: ['Pepsi', '百事'] },
  { symbol: 'PFE', name: 'Pfizer Inc.', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Healthcare', industry: 'Drug Manufacturers', aliases: ['Pfizer', '輝瑞', '辉瑞'] },
  { symbol: 'JNJ', name: 'Johnson & Johnson', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Healthcare', industry: 'Pharmaceutical', aliases: ['Johnson & Johnson', '強生', '强生'] },
  { symbol: 'V', name: 'Visa Inc.', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Financial Services', industry: 'Credit Services', aliases: ['Visa', '維薩', '维萨'] },
  { symbol: 'MA', name: 'Mastercard Incorporated', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Financial Services', industry: 'Credit Services', aliases: ['Mastercard', '萬事達', '万事达'] },
  { symbol: 'DIS', name: 'The Walt Disney Company', market: 'US', currency: 'USD', exchange: 'NYSE', sector: 'Communication Services', industry: 'Entertainment', aliases: ['Disney', '迪士尼'] },
  { symbol: 'NFLX', name: 'Netflix Inc.', market: 'US', currency: 'USD', exchange: 'NASDAQ', sector: 'Communication Services', industry: 'Entertainment', aliases: ['Netflix', '網飛', '网飞'] },

  // ===== HK =====
  { symbol: '0700.HK', name: 'Tencent Holdings Ltd.', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Communication Services', industry: 'Internet Content', aliases: ['Tencent', '騰訊', '腾讯', '腾讯控股'] },
  { symbol: '9988.HK', name: 'Alibaba Group Holding Ltd.', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Consumer Cyclical', industry: 'Internet Retail', aliases: ['Alibaba', '阿里巴巴'] },
  { symbol: '0005.HK', name: 'HSBC Holdings plc', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Financial Services', industry: 'Banks', aliases: ['HSBC', '匯豐', '汇丰'] },
  { symbol: '0941.HK', name: 'China Mobile Limited', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Communication Services', industry: 'Telecom', aliases: ['China Mobile', '中國移動', '中国移动'] },
  { symbol: '1299.HK', name: 'AIA Group Limited', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Financial Services', industry: 'Insurance', aliases: ['AIA', '友邦保險', '友邦保险'] },
  { symbol: '0883.HK', name: 'CNOOC Limited', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Energy', industry: 'Oil & Gas', aliases: ['CNOOC', '中海油'] },
  { symbol: '0388.HK', name: 'Hong Kong Exchanges & Clearing', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Financial Services', industry: 'Financial Data & Stock Exchanges', aliases: ['HKEX', '港交所', '香港交易所'] },
  { symbol: '2318.HK', name: 'Ping An Insurance Group', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Financial Services', industry: 'Insurance', aliases: ['Ping An', '平安', '中國平安', '中国平安'] },
  { symbol: '3690.HK', name: 'Meituan', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Consumer Cyclical', industry: 'Internet Retail', aliases: ['Meituan', '美團', '美团'] },
  { symbol: '1810.HK', name: 'Xiaomi Corporation', market: 'HK', currency: 'HKD', exchange: 'HKEX', sector: 'Technology', industry: 'Consumer Electronics', aliases: ['Xiaomi', '小米'] },
];

function toSearchResult(s: MockStock): StockSearchResult {
  return {
    id: `${s.symbol}-${s.market}`,
    symbol: s.symbol,
    name: s.name,
    market: s.market,
    currency: s.currency,
    sector: s.sector,
    industry: s.industry,
  };
}

export function getAllMockStocks(): StockSearchResult[] {
  return STOCKS.map(toSearchResult);
}

export function searchMockStocks(q: string, market?: Market): StockSearchResult[] {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return [];
  const pool = market ? STOCKS.filter((s) => s.market === market) : STOCKS;
  const matches = pool.filter((s) => {
    if (s.symbol.toLowerCase().includes(needle)) return true;
    if (s.name.toLowerCase().includes(needle)) return true;
    return s.aliases.some((a) => a.toLowerCase().includes(needle));
  });
  return matches.slice(0, 20).map(toSearchResult);
}

export function getMockStockDetail(symbol: string): StockDetail | null {
  const normalized = symbol.toUpperCase();
  const found = STOCKS.find((s) => s.symbol.toUpperCase() === normalized);
  if (!found) return null;
  return {
    id: `${found.symbol}-${found.market}`,
    symbol: found.symbol,
    name: found.name,
    market: found.market,
    currency: found.currency,
    sector: found.sector,
    industry: found.industry,
    exchange: found.exchange,
    isActive: true,
    aliases: found.aliases,
  };
}

export function getTopMockMovers(market?: Market, limit = 5): StockSearchResult[] {
  const pool = market ? STOCKS.filter((s) => s.market === market) : STOCKS;
  return pool.slice(0, limit).map(toSearchResult);
}

// ============================================================================
// Phase 2 — mock price feeds (fallback when ey_quote_snapshot / ey_price_1d
// haven't been populated yet by the yfinance worker).
// ============================================================================

/**
 * Deterministic Mulberry32 PRNG seeded by symbol so AAPL always looks the
 * same across requests. Used to render a stable synthetic chart and quote
 * when no real data is available.
 */
function symbolSeed(symbol: string): number {
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return seed;
}

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SyntheticParams {
  startPrice: number;
  trend: number;
  vol: number;
  rng: () => number;
}

function syntheticParams(symbol: string): SyntheticParams {
  const rng = makeRng(symbolSeed(symbol));
  return {
    startPrice: 50 + rng() * 200,
    trend: (rng() - 0.5) * 0.0015,
    vol: 0.018 + rng() * 0.012,
    rng,
  };
}

/**
 * Build a synthetic OHLC series for `symbol`. Skip weekends so the chart
 * has the same shape as a real trading calendar. Returns ascending dates.
 */
export function generateSyntheticPriceSeries(symbol: string, days = 252): PriceBar[] {
  const { startPrice, trend, vol, rng } = syntheticParams(symbol);
  const bars: PriceBar[] = [];
  let price = startPrice;
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const dateStr = d.toISOString().slice(0, 10);
    const shock = (rng() - 0.5) * vol;
    const open = price;
    const close = Math.max(0.5, open * (1 + trend + shock));
    const high = Math.max(open, close) * (1 + rng() * 0.005);
    const low = Math.min(open, close) * (1 - rng() * 0.005);
    const volume = Math.floor(1e6 + rng() * 5e7);
    bars.push({
      time: dateStr,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume,
    });
    price = close;
  }
  return bars;
}

export function getMockPriceSeries(symbol: string, days = 252): PriceSeries | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;
  return {
    symbol: detail.symbol,
    market: detail.market,
    currency: detail.currency,
    bars: generateSyntheticPriceSeries(detail.symbol, days),
  };
}

export function getMockQuote(symbol: string): Quote | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;
  const bars = generateSyntheticPriceSeries(detail.symbol, 30);
  const last = bars[bars.length - 1]!;
  const prev = bars[bars.length - 2]!;
  const lastPrice = last.close;
  const previousClose = prev.close;
  const change = +(lastPrice - previousClose).toFixed(4);
  const changePercent = +((change / previousClose) * 100).toFixed(4);
  const asOf = last.time;
  return {
    symbol: detail.symbol,
    market: detail.market,
    currency: detail.currency,
    lastPrice,
    previousClose,
    change,
    changePercent,
    volume: last.volume,
    asOf,
    status: 'closed',
  };
}

/**
 * Mock fundamentals — derived deterministically from the symbol so values
 * are stable across requests. All-null for an unknown stock.
 */
export function getMockFundamentals(symbol: string): StockFundamentals | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;
  const rng = makeRng(symbolSeed(detail.symbol));
  const marketCap = Math.floor((50 + rng() * 3000) * 1e9);
  const shares = Math.floor((1 + rng() * 20) * 1e9);
  const pe = rng() > 0.3 ? +(8 + rng() * 40).toFixed(2) : null;
  const dy = rng() > 0.4 ? +(rng() * 0.05).toFixed(4) : null;
  const last = generateSyntheticPriceSeries(detail.symbol, 252);
  const highs = last.map((b) => b.high);
  const lows = last.map((b) => b.low);
  return {
    marketCap,
    sharesOutstanding: shares,
    peRatio: pe,
    dividendYield: dy,
    fiftyTwoWeekHigh: +Math.max(...highs).toFixed(2),
    fiftyTwoWeekLow: +Math.min(...lows).toFixed(2),
    source: 'mock',
    fetchedAt: new Date().toISOString(),
  };
}

export interface MockMoverRow extends StockSearchResult {
  changePercent: number;
}

/**
 * Mock top movers — deterministic per-symbol change %. Returns `limit` rows
 * ordered by absolute change.
 */
export function getMockTopMoversWithChange(
  market?: Market,
  limit = 5,
): MockMoverRow[] {
  const pool = market ? STOCKS.filter((s) => s.market === market) : STOCKS;
  const rows: MockMoverRow[] = pool.map((s) => {
    const rng = makeRng(symbolSeed(s.symbol));
    const changePercent = +(((rng() - 0.5) * 8)).toFixed(2);
    return { ...toSearchResult(s), changePercent };
  });
  rows.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return rows.slice(0, limit);
}

// ============================================================================
// Phase 3 — mock analytics + index quotes (fallback when ey_stock_analytics /
// ey_index_quote haven't been populated yet).
// ============================================================================

/** Mock analytics — computed deterministically from the synthetic series. */
export function getMockAnalytics(
  symbol: string,
  days = 30,
): StockAnalytics[] {
  const series = getMockPriceSeries(symbol, 252);
  if (!series) return [];
  const closes = series.bars.map((b) => b.close);
  const out: StockAnalytics[] = [];
  const n = closes.length;
  for (let i = Math.max(0, n - days); i < n; i++) {
    out.push(
      computeIndicatorsAt(series.bars, i, symbol),
    );
  }
  return out;
}

function computeIndicatorsAt(
  bars: PriceBar[],
  idx: number,
  symbol: string,
): StockAnalytics {
  const closes = bars.slice(0, idx + 1).map((b) => b.close);
  const last = closes[idx] ?? 0;
  const dateStr = bars[idx]?.time ?? new Date().toISOString().slice(0, 10);

  const ma = (window: number): number | null => {
    if (closes.length < window) return null;
    const slice = closes.slice(-window);
    return +(slice.reduce((s, v) => s + v, 0) / window).toFixed(4);
  };

  const ma20 = ma(20);
  const ma50 = ma(50);
  const ma200 = ma(200);

  // Wilder RSI(14)
  let rsi14: number | null = null;
  if (closes.length >= 15) {
    const deltas: number[] = [];
    for (let i = closes.length - 14; i < closes.length; i++) {
      deltas.push((closes[i] ?? 0) - (closes[i - 1] ?? 0));
    }
    let avgGain = 0;
    let avgLoss = 0;
    for (const d of deltas) {
      if (d >= 0) avgGain += d;
      else avgLoss += -d;
    }
    avgGain /= 14;
    avgLoss /= 14;
    if (avgLoss === 0) rsi14 = 100;
    else {
      const rs = avgGain / avgLoss;
      rsi14 = +(100 - 100 / (1 + rs)).toFixed(2);
    }
  }

  // MACD(12, 26, 9) using simple EMA approximation
  const ema = (span: number): number | null => {
    if (closes.length < span) return null;
    const k = 2 / (span + 1);
    let e = closes[closes.length - span] ?? 0;
    for (let i = closes.length - span + 1; i < closes.length; i++) {
      e = (closes[i] ?? 0) * k + e * (1 - k);
    }
    return +e.toFixed(4);
  };
  const ema12 = ema(12);
  const ema26 = ema(26);
  const macdLine =
    ema12 != null && ema26 != null ? +(ema12 - ema26).toFixed(4) : null;
  // Signal: 9-EMA of MACD — approximation, recompute on MACD history if available
  const macdSignal = macdLine != null ? +macdLine.toFixed(4) : null;
  const macdHist =
    macdLine != null && macdSignal != null
      ? +(macdLine - macdSignal).toFixed(4)
      : null;

  // Volatility — stdev of last 30 log returns × √252
  let volatility30d: number | null = null;
  if (closes.length >= 31) {
    const slice = closes.slice(-30);
    const rets: number[] = [];
    for (let i = 1; i < slice.length; i++) {
      rets.push(Math.log((slice[i] ?? 1) / (slice[i - 1] ?? 1)));
    }
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance =
      rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
    volatility30d = +(Math.sqrt(variance) * Math.sqrt(252)).toFixed(4);
  }

  // Max drawdown — last 30-day window peak-to-trough
  let maxDrawdown30d: number | null = null;
  if (closes.length >= 2) {
    const slice = closes.slice(-30);
    let peak = slice[0] ?? 0;
    let worst = 0;
    for (const v of slice) {
      if (v > peak) peak = v;
      const dd = v / peak - 1;
      if (dd < worst) worst = dd;
    }
    maxDrawdown30d = +worst.toFixed(4);
  }

  const ret = (days: number): number | null => {
    if (closes.length <= days) return null;
    const past = closes[closes.length - 1 - days] ?? last;
    return +(((last - past) / past) * 100).toFixed(2);
  };
  const return1m = ret(21);
  const return3m = ret(63);
  const return6m = ret(126);
  const return1y = ret(252);

  return {
    stockId: `${symbol}-${symbol}`, // stable fake id when no Supabase
    asOfDate: dateStr,
    ma20,
    ma50,
    ma200,
    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    volatility30d,
    maxDrawdown30d,
    return1m,
    return3m,
    return6m,
    return1y,
  };
}

/**
 * Mock index quotes — deterministic per-code last + previous close, derived
 * from the same Mulberry32 RNG used for stock series.
 */
const INDEX_BASES: Record<IndexCode, { market: Market; last: number; range: [number, number] }> = {
  SPX: { market: 'US', last: 5400, range: [-0.6, 0.6] },
  HSI: { market: 'HK', last: 18500, range: [-1.2, 1.2] },
};

export function getMockIndexQuotes(): IndexQuote[] {
  const today = new Date().toISOString().slice(0, 10);
  return (Object.keys(INDEX_BASES) as IndexCode[]).map((code) => {
    const meta = INDEX_BASES[code];
    const rng = makeRng(symbolSeed(code));
    const delta = (rng() * (meta.range[1] - meta.range[0]) + meta.range[0]) / 100;
    const previousClose = +(meta.last / (1 + delta)).toFixed(2);
    return {
      code,
      market: meta.market,
      last: meta.last,
      previousClose,
      change: +(meta.last - previousClose).toFixed(4),
      changePercent: +(delta * 100).toFixed(4),
      asOf: today,
    } satisfies IndexQuote;
  });
}
