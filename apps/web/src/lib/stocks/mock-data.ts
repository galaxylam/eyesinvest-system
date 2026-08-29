import type {
  IndexCode,
  IndexQuote,
  Market,
  NewsStockMappingDto,
  PriceBar,
  PriceSeries,
  Quote,
  SectorDailyRow,
  StockAnalytics,
  StockFundamentals,
  StockRelationshipDto,
} from '@eyesinvest/types';
import { MARKET_INDICES } from '@eyesinvest/types';
import type {
  CrowdedRatio,
  CrowdedRatioPoint,
  CrowdedRegime,
  EfficiencyPoint,
  RelativeStrength,
  ScreenerRow,
  SectorMember,
  ShortInterestPoint,
  ShortSelling,
  ShortSellingPoint,
  SqueezeScore,
  StockDetail,
  StockSearchResult,
  VolumeAggregates,
  VolumeEfficiency,
  VolumeSeries,
} from './types';

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
  const fundamentals = getMockFundamentals(symbol);
  const shares = fundamentals?.sharesOutstanding ?? null;
  const closes = series.bars.map((b) => b.close);
  const out: StockAnalytics[] = [];
  const n = closes.length;
  for (let i = Math.max(0, n - days); i < n; i++) {
    out.push(
      computeIndicatorsAt(series.bars, i, symbol, shares),
    );
  }
  return out;
}

function computeIndicatorsAt(
  bars: PriceBar[],
  idx: number,
  symbol: string,
  sharesOutstanding: number | null,
): StockAnalytics {
  const closes = bars.slice(0, idx + 1).map((b) => b.close);
  const last = closes[idx] ?? 0;
  const dateStr = bars[idx]?.time ?? new Date().toISOString().slice(0, 10);

  const ma = (window: number, endIdx: number = closes.length - 1): number | null => {
    if (endIdx + 1 < window) return null;
    const slice = closes.slice(endIdx + 1 - window, endIdx + 1);
    return +(slice.reduce((s, v) => s + v, 0) / window).toFixed(4);
  };

  const ma5 = ma(5);
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
  const return1w = ret(5);
  const return1m = ret(21);
  const return3m = ret(63);
  const return6m = ret(126);
  const return1y = ret(252);

  // Phase 3+ sector-strength columns — computed from the same synthetic bars
  // so values stay consistent with the existing chart and screener mocks.
  // `relativeStrength` stays null: the mock universe has no historical SPX/HSI
  // trailing-return series, and returning a synthetic delta would mislead
  // anyone reading the dashboard. Sector-level `rsVsMarket*` are populated
  // directly in `getMockSectorDaily`.
  const bar = bars[idx];
  const prev = idx > 0 ? bars[idx - 1] : null;
  const dailyChangePct =
    bar != null && prev != null && prev.close !== 0
      ? ((bar.close - prev.close) / prev.close) * 100
      : null;
  const turnoverPct =
    bar != null && sharesOutstanding != null && sharesOutstanding > 0
      ? (bar.volume / sharesOutstanding) * 100
      : null;
  const volumeEfficiency =
    dailyChangePct != null && turnoverPct != null && turnoverPct > 0
      ? Math.abs(dailyChangePct) / turnoverPct
      : null;

  let crowdedRatio: number | null = null;
  if (idx >= 29) {
    // Need 30 bars for MA30 (window 30 inclusive of `idx`).
    const slice5 = bars.slice(idx - 4, idx + 1);
    const slice30 = bars.slice(idx - 29, idx + 1);
    const ma5 = slice5.reduce((s, b) => s + b.volume, 0) / slice5.length;
    const ma30 = slice30.reduce((s, b) => s + b.volume, 0) / slice30.length;
    if (ma30 > 0) {
      crowdedRatio = +(ma5 / ma30).toFixed(4);
    }
  }

  // MA5 / MA20 slope — signed delta vs the prior trading day. The "prior"
  // MA here uses closes through idx-1 so we don't double-count today's bar.
  // Returns null when the prior window doesn't have enough history (i.e. on
  // the first row that has a ma5/ma20 value).
  const ma5Prior = ma(5, idx);      // closed-over slice of length 5 ending at idx
  const ma5Prev = ma(5, idx - 1);   // length 5 ending at idx-1
  const ma5Slope =
    ma5Prior != null && ma5Prev != null ? +(ma5Prior - ma5Prev).toFixed(4) : null;
  const ma20Prior = ma(20, idx);
  const ma20Prev = ma(20, idx - 1);
  const ma20Slope =
    ma20Prior != null && ma20Prev != null ? +(ma20Prior - ma20Prev).toFixed(4) : null;

  // 1M green/red volume ratio — mean(volume on close>open bars) ÷
  // mean(volume on close<open bars) over the trailing 21 trading days
  // (matches the live worker's `_green_red_volume_share_1m(window=21)`).
  // Null until 21 days of history; null when no green OR no red bars in
  // the window (preserves the "no signal" state).
  let greenRedVolumeRatio1m: number | null = null;
  let greenRedVolumeShare1m: number | null = null;
  if (idx >= 20) {
    const window = bars.slice(idx - 20, idx + 1);
    let greenSum = 0, greenCount = 0, redSum = 0, redCount = 0;
    for (const b of window) {
      if (b.close > b.open) { greenSum += b.volume; greenCount += 1; }
      else if (b.close < b.open) { redSum += b.volume; redCount += 1; }
    }
    if (greenCount > 0 && redCount > 0) {
      greenRedVolumeRatio1m = +((greenSum / greenCount) / (redSum / redCount)).toFixed(4);
    }
    const total = greenSum + redSum;
    if (total > 0) {
      // Signed encoding mirroring the worker: positive when green
      // dominant (magnitude = green share), negative when red dominant
      // (magnitude = red share = 1 - green share). Sign carries the
      // colour zone so the screener's filter never misclassifies a row.
      const greenShare = greenSum / total;
      greenRedVolumeShare1m =
        greenShare >= 0.5
          ? +greenShare.toFixed(4)
          : -(+(1 - greenShare).toFixed(4));
    }
  }

  return {
    stockId: `${symbol}-${symbol}`, // stable fake id when no Supabase
    asOfDate: dateStr,
    ma5,
    ma20,
    ma50,
    ma200,
    ma5Slope,
    ma20Slope,
    rsi14,
    macdLine,
    macdSignal,
    macdHist,
    volatility30d,
    maxDrawdown30d,
    return1w,
    return1m,
    return3m,
    return6m,
    return1y,
    volumeEfficiency: volumeEfficiency != null ? +volumeEfficiency.toFixed(4) : null,
    crowdedRatio,
    greenRedVolumeRatio1m,
    greenRedVolumeShare1m,
    relativeStrength: null,
  };
}

/**
 * Mock sector-strength rows — one row per sector keyed by the English
 * sector name in `ey_stocks.sector`. Same shape as the persisted `ey_sector_daily`
 * table; values are deterministic so the dashboard tile is stable across
 * renders when Supabase is offline.
 *
 * The mock universe spans 7 sectors — mirrors the seeded `ey_stocks` set
 * in `local/supabase/seed.sql`. Filtering by `sector` and `limit` matches
 * the production query shape.
 */
export function getMockSectorDaily(
  sector: string | null,
  limit: number,
): SectorDailyRow[] {
  const today = new Date().toISOString().slice(0, 10);
  const all: SectorDailyRow[] = [
    { sector: 'Financial Services',     asOfDate: today, memberCount: 6, breadthPct: 67, sectorReturn1w:  1.2, sectorReturn1m:  4.2, sectorReturn3m:  8.1, sectorReturn6m: 12.3, sectorReturn1y: 22.4, rsVsMarket1w:  0.4, rsVsMarket1m:  1.8, rsVsMarket3m:  3.2, rsVsMarket6m:  4.7, rsVsMarket1y:  8.9, volumeEfficiencyMean: 0.42, crowdedRatioMean: 0.95 },
    { sector: 'Communication Services', asOfDate: today, memberCount: 5, breadthPct: 80, sectorReturn1w:  1.8, sectorReturn1m:  6.1, sectorReturn3m: 11.5, sectorReturn6m: 18.2, sectorReturn1y: 31.7, rsVsMarket1w:  1.0, rsVsMarket1m:  3.7, rsVsMarket3m:  6.6, rsVsMarket6m: 10.6, rsVsMarket1y: 18.2, volumeEfficiencyMean: 0.58, crowdedRatioMean: 1.12 },
    { sector: 'Technology',             asOfDate: today, memberCount: 4, breadthPct: 75, sectorReturn1w:  2.4, sectorReturn1m:  8.4, sectorReturn3m: 14.7, sectorReturn6m: 22.1, sectorReturn1y: 38.2, rsVsMarket1w:  1.6, rsVsMarket1m:  6.0, rsVsMarket3m:  9.8, rsVsMarket6m: 14.5, rsVsMarket1y: 24.7, volumeEfficiencyMean: 0.71, crowdedRatioMean: 1.21 },
    { sector: 'Consumer Cyclical',      asOfDate: today, memberCount: 3, breadthPct: 67, sectorReturn1w:  0.9, sectorReturn1m:  2.8, sectorReturn3m:  5.3, sectorReturn6m:  9.7, sectorReturn1y: 17.5, rsVsMarket1w:  0.1, rsVsMarket1m:  0.4, rsVsMarket3m:  0.4, rsVsMarket6m:  2.1, rsVsMarket1y:  4.0, volumeEfficiencyMean: 0.39, crowdedRatioMean: 0.88 },
    { sector: 'Energy',                 asOfDate: today, memberCount: 3, breadthPct: 33, sectorReturn1w: -0.6, sectorReturn1m: -2.1, sectorReturn3m:  1.4, sectorReturn6m:  4.8, sectorReturn1y:  6.3, rsVsMarket1w: -1.4, rsVsMarket1m: -4.5, rsVsMarket3m: -3.5, rsVsMarket6m: -2.8, rsVsMarket1y: -7.2, volumeEfficiencyMean: 0.28, crowdedRatioMean: 0.74 },
    { sector: 'Consumer Defensive',     asOfDate: today, memberCount: 3, breadthPct: 67, sectorReturn1w:  0.3, sectorReturn1m:  1.2, sectorReturn3m:  2.8, sectorReturn6m:  5.1, sectorReturn1y:  9.8, rsVsMarket1w: -0.5, rsVsMarket1m: -1.2, rsVsMarket3m: -2.1, rsVsMarket6m: -2.5, rsVsMarket1y: -3.7, volumeEfficiencyMean: 0.18, crowdedRatioMean: 0.62 },
    { sector: 'Healthcare',             asOfDate: today, memberCount: 2, breadthPct: 50, sectorReturn1w:  1.5, sectorReturn1m: -0.4, sectorReturn3m:  1.7, sectorReturn6m:  3.6, sectorReturn1y:  8.1, rsVsMarket1w:  0.7, rsVsMarket1m: -2.8, rsVsMarket3m: -3.2, rsVsMarket6m: -4.0, rsVsMarket1y: -5.6, volumeEfficiencyMean: 0.22, crowdedRatioMean: 0.81 },
  ];
  const filtered = sector ? all.filter((r) => r.sector === sector) : all;
  return filtered.slice(0, limit);
}

/**
 * Mock sector-member list — every mock stock whose `sector` matches, joined
 * client-side with its mock quote (last + change) and mock analytics (1m
 * return). Mirrors the production join of `ey_stocks` + `ey_quote_snapshot`
 * + latest `ey_stock_analytics` row that the sector-detail page renders.
 *
 * Sorted by `return1m` desc so the leader is on top — matches the dashboard
 * leaderboard ordering pattern. Unknown sector returns `[]`.
 */
export function getMockStocksBySector(sector: string): SectorMember[] {
  const members = STOCKS.filter((s) => s.sector === sector);
  const rows: SectorMember[] = members.map((s) => {
    const quote = getMockQuote(s.symbol);
    const analytics = getMockAnalytics(s.symbol, 1);
    const latest = analytics[analytics.length - 1] ?? null;
    return {
      symbol: s.symbol,
      name: s.name,
      market: s.market,
      currency: s.currency,
      sector: s.sector,
      lastPrice: quote?.lastPrice ?? null,
      changePercent: quote?.changePercent ?? null,
      return1m: latest?.return1m ?? null,
    } satisfies SectorMember;
  });
  rows.sort((a, b) => (b.return1m ?? -Infinity) - (a.return1m ?? -Infinity));
  return rows;
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

// ============================================================================
// Phase 4 — mock volume series + relative-strength (fallback for the tabbed
// stock-detail panels). Both derive from existing mock primitives so values
// stay consistent with the chart + analytics panels above.
// ============================================================================

/**
 * Mock volume series — derives daily bars from `generateSyntheticPriceSeries`
 * so values are consistent with the chart and quote on the same page.
 */
export function getMockVolumeSeries(symbol: string, days = 252): VolumeSeries | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;
  const bars = generateSyntheticPriceSeries(detail.symbol, days);
  if (bars.length === 0) {
    return {
      symbol: detail.symbol,
      market: detail.market,
      daily: [],
      aggregates: {
        avg30d: null,
        avg90d: null,
        latestVs30dPct: null,
        maxInWindow: null,
        maxDate: null,
      } satisfies VolumeAggregates,
    };
  }
  const daily = bars.map((b, i) => {
    const start = Math.max(0, i - 19);
    const slice = bars.slice(start, i + 1);
    const sum = slice.reduce((s, x) => s + x.volume, 0);
    return {
      date: b.time,
      close: b.close,
      volume: b.volume,
      avgVolume20: slice.length > 0 ? sum / slice.length : null,
    };
  });
  const avg = (window: number): number | null => {
    if (daily.length < window) return null;
    const slice = daily.slice(-window);
    return slice.reduce((s, r) => s + r.volume, 0) / slice.length;
  };
  const avg30d = avg(30);
  const avg90d = avg(90);
  const last = daily[daily.length - 1];
  const latestVs30dPct =
    last != null && avg30d != null && avg30d > 0
      ? +(((last.volume - avg30d) / avg30d) * 100).toFixed(2)
      : null;
  let maxVol = -Infinity;
  let maxDate: string | null = null;
  for (const r of daily) {
    if (r.volume > maxVol) {
      maxVol = r.volume;
      maxDate = r.date;
    }
  }
  return {
    symbol: detail.symbol,
    market: detail.market,
    daily,
    aggregates: {
      avg30d,
      avg90d,
      latestVs30dPct,
      maxInWindow: Number.isFinite(maxVol) ? maxVol : null,
      maxDate,
    },
  } satisfies VolumeSeries;
}

/**
 * Mock relative-strength payload. Reads the latest analytics row to keep the
 * 1m/3m/6m/1y numbers aligned with the VolatilityPanel, and the current index
 * session change from `getMockIndexQuotes` for `rsSession`.
 */
export function getMockRelativeStrength(
  symbol: string,
  opts: { market: Market; quoteChangePercent: number | null },
): RelativeStrength {
  const indexCode: IndexCode = opts.market === 'HK' ? 'HSI' : 'SPX';
  const meta = MARKET_INDICES[indexCode];
  const indices = getMockIndexQuotes();
  const idx = indices.find((i) => i.code === indexCode);
  const indexChangePercent = idx ? idx.changePercent : null;

  const analytics = getMockAnalytics(symbol, 252);
  const latest = analytics[analytics.length - 1] ?? null;

  const diff = (a: number | null, b: number | null): number | null =>
    a == null || b == null ? null : +(a - b).toFixed(2);

  return {
    indexCode,
    indexName: {
      en: meta.nameEn,
      zhHk: meta.nameZhHk,
      zhCn: meta.nameZhCn,
    },
    indexChangePercent,
    stockReturn1m: latest?.return1m ?? null,
    stockReturn3m: latest?.return3m ?? null,
    stockReturn6m: latest?.return6m ?? null,
    stockReturn1y: latest?.return1y ?? null,
    rsSession: diff(opts.quoteChangePercent, indexChangePercent),
  } satisfies RelativeStrength;
}

// ============================================================================
// Volume Efficiency + Crowded Ratio — combination metrics. Derive from the
// existing mock primitives so the two analyses stay consistent with the chart
// + quote + fundamentals already pulled on the page.
// ============================================================================

/**
 * Roll up volume efficiency for the latest day in the synthetic series.
 * Pulls `sharesOutstanding` from `getMockFundamentals` and `changePercent`
 * from `getMockQuote` so the panel headline agrees with the rest of the page.
 */
export function getMockVolumeEfficiency(symbol: string): VolumeEfficiency | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;
  const fundamentals = getMockFundamentals(symbol);
  const quote = getMockQuote(symbol);
  const shares = fundamentals?.sharesOutstanding ?? null;
  const hasFloatData = shares != null && shares > 0;

  // 30 days of bars for the rolling-avg turnover calculation.
  const bars = generateSyntheticPriceSeries(symbol, 30);
  const last = bars[bars.length - 1] ?? null;

  const turnoverPctToday =
    last && hasFloatData && shares != null ? (last.volume / shares) * 100 : null;

  const efficiencyToday =
    quote != null && turnoverPctToday != null && turnoverPctToday > 0
      ? Math.abs(quote.changePercent) / turnoverPctToday
      : null;

  const avgTurnoverPct30d = (() => {
    if (!hasFloatData || shares == null) return null;
    if (bars.length === 0) return null;
    const sum = bars.reduce((s, b) => s + (b.volume / shares) * 100, 0);
    return sum / bars.length;
  })();

  // Per-day series for the VolumeEfficiencyChart subplot. Mirrors the
  // production query: each row carries its own dailyChangePct + turnoverPct
  // so the UI can recompute efficiency / draw tooltips without re-fetching.
  // `volume` is included so the chart can compute the green/red volume
  // share pill inline (matching the worker's `green_red_volume_share_1m`).
  const series: EfficiencyPoint[] = bars.map((b, i) => {
    const prev = i > 0 ? bars[i - 1] : null;
    const dailyChangePct =
      prev != null && prev.close !== 0
        ? ((b.close - prev.close) / prev.close) * 100
        : null;
    const turnoverPct =
      hasFloatData && shares != null ? (b.volume / shares) * 100 : null;
    const efficiency =
      dailyChangePct != null && turnoverPct != null && turnoverPct > 0
        ? Math.abs(dailyChangePct) / turnoverPct
        : null;
    return { date: b.time, efficiency, turnoverPct, dailyChangePct, volume: b.volume };
  });

  return {
    symbol: detail.symbol,
    market: detail.market,
    efficiencyToday,
    turnoverPctToday,
    avgTurnoverPct30d,
    sharesOutstanding: shares,
    hasFloatData,
    asOfDate: last?.time ?? null,
    series,
  } satisfies VolumeEfficiency;
}

/**
 * Mock crowded ratio (FOMO_Ratio = MA5(volume) ÷ MA30(volume)). Uses the same
 * seeded synthetic price series so the ratio moves with whatever "story"
 * the symbol is being told — no separate RNG state to keep in sync.
 */
export function getMockCrowdedRatio(symbol: string, days = 252): CrowdedRatio | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;

  const bars = generateSyntheticPriceSeries(symbol, days);
  if (bars.length === 0) {
    return {
      symbol: detail.symbol,
      market: detail.market,
      ratio: null,
      ma5: null,
      ma30: null,
      regime: null,
      series: [],
      asOfDate: null,
    } satisfies CrowdedRatio;
  }

  const series: CrowdedRatioPoint[] = bars.map((b, i) => {
    const start5 = Math.max(0, i - 4);
    const start30 = Math.max(0, i - 29);
    const slice5 = bars.slice(start5, i + 1);
    const slice30 = bars.slice(start30, i + 1);
    const ma5 = slice5.reduce((s, x) => s + x.volume, 0) / slice5.length;
    const ma30 = slice30.reduce((s, x) => s + x.volume, 0) / slice30.length;
    const ratio = slice30.length >= 30 ? ma5 / ma30 : null;
    return {
      date: b.time,
      ratio,
      ma5,
      ma30,
    };
  });

  const latest = series[series.length - 1];
  const ratio = latest?.ratio ?? null;
  const ma5 = latest?.ma5 ?? null;
  const ma30 = latest?.ma30 ?? null;

  const regime: CrowdedRegime | null =
    ratio == null
      ? null
      : ratio >= 1.5
        ? 'crowded'
        : ratio >= 1.2
          ? 'elevated'
          : ratio >= 0.8
            ? 'normal'
            : 'subdued';

  return {
    symbol: detail.symbol,
    market: detail.market,
    ratio,
    ma5,
    ma30,
    regime,
    series,
    asOfDate: latest?.date ?? null,
  } satisfies CrowdedRatio;
}

// ============================================================================
// Short Selling (FINRA, US-only). Mirrors the production query shape: daily
// short % of volume + bi-weekly short interest. HK stocks short-circuit to
// `null` so the chart can render its empty state — same behavior as
// `getShortSelling` in queries.ts.
// ============================================================================

/**
 * Mock short-selling payload. Uses the same seeded synthetic price series
 * so the daily short % moves with whatever the symbol is being told.
 * Works for both US (FINRA) and HK (HKEX + SFC); HK mocks intentionally
 * leave `totalVolume` as 0 so `shortPctOfVolume` is `null` — mirrors
 * the real HKEX daily page that doesn't publish total daily volume. HK
 * mocks add a deterministic `amShortVolume`/`amShortValueHkd` of 40–55%
 * of full-day so the AM overlap bar has something to render.
 */
export function getMockShortSelling(symbol: string): ShortSelling | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;
  const isHK = detail.market === 'HK';

  // 252 trading days so the chart always covers the longest picker window.
  const bars = generateSyntheticPriceSeries(symbol, 252);
  if (bars.length === 0) {
    return {
      symbol: detail.symbol,
      market: detail.market,
      todayShortPctOfVolume: null,
      todayShortVolume: null,
      todayAmShortVolume: null,
      todayAmShortValueHkd: null,
      todayAmPctOfFullDay: null,
      shortInterest: null,
      shortInterestChangePct: null,
      daysToCover: null,
      asOfDate: null,
      series: { sale: [], interest: [] },
    } satisfies ShortSelling;
  }

  // Per-day shortPctOfVolume derived from the symbol's seeded RNG so
  // values are deterministic. We anchor on 30-50% — a believable range
  // for active US equities — and let the seed drive the variance.
  const rng = makeRng(symbolSeed(`${symbol}-shorts`));
  const sale: ShortSellingPoint[] = bars.map((b) => {
    const total = b.volume;
    // HKEX daily page only publishes short volume + HKD turnover, not
    // total daily volume — mirror that in the mock so the UI's
    // derived shortPctOfVolume falls back to "—" for HK.
    const totalForChart = isHK ? 0 : total;
    const short = Math.floor(total * (30 + rng() * 20) / 100);
    // HK-only AM session: 40–55% of full-day short volume, with a
    // rough HKD turnover proxy derived from the bar's close price.
    const amShort = isHK ? Math.floor(short * (0.40 + rng() * 0.15)) : null;
    const amHkd =
      isHK && amShort != null ? Math.round(amShort * b.close) : null;
    return {
      date: b.time,
      shortVolume: short,
      totalVolume: totalForChart,
      shortPctOfVolume: totalForChart > 0 ? +(30 + rng() * 20).toFixed(2) : null,
      amShortVolume: amShort,
      amShortValueHkd: amHkd,
    };
  });

  // Bi-weekly settlements — pick every 10th bar as a settlement date so
  // the chart always has ~25 short-interest points over a 252-day window.
  const avgVol30 =
    bars.slice(-30).reduce((s, b) => s + b.volume, 0) /
    Math.max(1, Math.min(30, bars.length));
  const interest: ShortInterestPoint[] = [];
  let prevShortInterest: number | null = null;
  for (let i = 9; i < bars.length; i += 10) {
    const b = bars[i];
    if (!b) continue;
    // Synthetic short-interest ≈ 5% of cumulative volume over the
    // settlement window — again seeded for determinism.
    const seedRng = makeRng(symbolSeed(`${symbol}-si-${i}`));
    const shortInterest = Math.floor(avgVol30 * (4 + seedRng() * 3));
    const changePct =
      prevShortInterest != null && prevShortInterest > 0
        ? +(((shortInterest - prevShortInterest) / prevShortInterest) * 100).toFixed(2)
        : null;
    interest.push({
      date: b.time,
      shortInterest,
      changePct,
      daysToCover: avgVol30 > 0 ? +(shortInterest / avgVol30).toFixed(2) : null,
    });
    prevShortInterest = shortInterest;
  }

  const latestSale = sale[sale.length - 1];
  const latestInterest = interest[interest.length - 1];

  // HK AM share of today's full day.
  const todayFullVol = latestSale?.shortVolume ?? null;
  const todayAmVol = latestSale?.amShortVolume ?? null;
  const todayAmHkd = latestSale?.amShortValueHkd ?? null;
  const todayAmPct =
    todayAmVol != null && todayFullVol != null && todayFullVol > 0
      ? +((todayAmVol / todayFullVol) * 100).toFixed(1)
      : null;

  return {
    symbol: detail.symbol,
    market: detail.market,
    todayShortPctOfVolume: latestSale?.shortPctOfVolume ?? null,
    todayShortVolume: todayFullVol,
    todayAmShortVolume: todayAmVol,
    todayAmShortValueHkd: todayAmHkd,
    todayAmPctOfFullDay: todayAmPct,
    shortInterest: latestInterest?.shortInterest ?? null,
    shortInterestChangePct: latestInterest?.changePct ?? null,
    daysToCover: latestInterest?.daysToCover ?? null,
    asOfDate: latestSale?.date ?? latestInterest?.date ?? null,
    series: { sale, interest },
  } satisfies ShortSelling;
}

// ============================================================================
// Phase 5 — Short Squeeze score (per-stock 0..100 composite).
// Mirrors the worker-side `_squeeze_score` formula (docs/SQUEEZE.md) but
// uses mock-derived inputs — kept in lockstep with `workers/yfinance/src/
// eyesinvest_worker/providers/analytics.py::_squeeze_score` so the mock
// panels behave like the real ones.
// ============================================================================

function _clip01(x: number | null, lo: number, hi: number): number {
  if (x == null || hi === lo) return 0;
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
}

/**
 * Mock short-squeeze payload for a symbol. Derived deterministically from
 * the same synthetic price series + short-selling mock the screener uses,
 * so re-rendering the page produces the same score.
 *
 * Returns `null` only when the symbol is unknown — a real stock with
 * insufficient data still gets a payload with `score: null` so the panel
 * can render the "Squeeze score is not available" state.
 */
export function getMockSqueeze(symbol: string): SqueezeScore | null {
  const detail = getMockStockDetail(symbol);
  if (!detail) return null;

  const ss = getMockShortSelling(symbol);
  const bars = generateSyntheticPriceSeries(symbol, 252);

  // Need at least 30 trading days for DTC / drawdown / vol-spike.
  if (bars.length < 30) {
    return {
      symbol: detail.symbol,
      market: detail.market,
      score: null,
      regime: null,
      daysToCover: null,
      siChangePct1w: null,
      drawdown30d: null,
      volumeSpike: null,
      amRatio: null,
      asOfDate: null,
    } satisfies SqueezeScore;
  }

  const avgVol30 = bars.slice(-30).reduce((s, b) => s + b.volume, 0) / 30;
  const avgVol5 = bars.slice(-5).reduce((s, b) => s + b.volume, 0) / 5;
  const peak30 = Math.max(...bars.slice(-30).map((b) => b.close));
  const lastBar = bars[bars.length - 1];
  const lastClose = lastBar ? lastBar.close : peak30;

  const daysToCover =
    ss?.shortInterest != null && avgVol30 > 0 ? ss.shortInterest / avgVol30 : null;
  const siChangePct1w = ss?.shortInterestChangePct ?? null;
  const drawdown30d = peak30 > 0 ? (lastClose - peak30) / peak30 : null;
  const volumeSpike = avgVol30 > 0 ? avgVol5 / avgVol30 : null;
  const amRatio = detail.market === 'HK' ? ss?.todayAmPctOfFullDay ?? null : null;

  // Same component weights as the worker (see docs/SQUEEZE.md).
  const parts = [
    0.30 * _clip01(daysToCover, 0, 10),
    0.25 * _clip01(siChangePct1w, -30, 30),
    0.20 * _clip01(drawdown30d != null ? -drawdown30d : null, 0, 0.30),  // fraction
    0.15 * _clip01(volumeSpike, 1, 5),
    0.10 * _clip01(amRatio, 40, 80),
  ];
  const allZero = parts.every((p) => p === 0);
  const rawScore = allZero ? null : Math.round(parts.reduce((s, p) => s + p, 0) * 100 * 100) / 100;

  const regime = rawScore == null
    ? null
    : rawScore >= 70
      ? 'high'
      : rawScore >= 50
        ? 'elevated'
        : rawScore >= 30
          ? 'normal'
          : 'low';

  return {
    symbol: detail.symbol,
    market: detail.market,
    score: rawScore,
    regime,
    daysToCover,
    siChangePct1w,
    drawdown30d,
    volumeSpike,
    amRatio,
    asOfDate: ss?.asOfDate ?? null,
  } satisfies SqueezeScore;
}

// ============================================================================
// Screener — denormalised one-row-per-stock mock. Combines quote + fundamentals
// + latest analytics for every stock in the mock universe so the screener page
// has the same shape regardless of Supabase availability.
// ============================================================================

/**
 * Build a screener row for one symbol by joining the existing mock primitives.
 * Kept private — callers should use `getMockScreenerRows` to get the full set.
 */
function buildMockScreenerRow(symbol: string): ScreenerRow | null {
  const quote = getMockQuote(symbol);
  const detail = getMockStockDetail(symbol);
  const fundamentals = getMockFundamentals(symbol);
  const analytics = getMockAnalytics(symbol, 252);
  if (!detail) return null;
  const latest = analytics[analytics.length - 1] ?? null;
  const efficiency = getMockVolumeEfficiency(symbol);
  const crowded = getMockCrowdedRatio(symbol);
  const shortSelling = getMockShortSelling(symbol);
  const squeeze = getMockSqueeze(symbol);
  // Short-interest settlements are desc-ordered by date in the mock series.
  // The first ≤5 values drive the screener's "1/2/3-period trend" filter.
  const interest = shortSelling?.series?.interest ?? [];
  const interestTrend = (() => {
    if (interest.length < 2) return null;
    const latest = interest[0]?.shortInterest;
    const prev = interest[1]?.shortInterest;
    if (latest == null || prev == null) return null;
    if (latest > prev) return 'up';
    if (latest < prev) return 'down';
    return 'flat';
  })();
  return {
    symbol: detail.symbol,
    name: detail.name,
    market: detail.market,
    currency: detail.currency,
    sector: detail.sector,
    lastPrice: quote?.lastPrice ?? null,
    change: quote?.change ?? null,
    changePercent: quote?.changePercent ?? null,
    volume: quote?.volume ?? null,
    marketCap: fundamentals?.marketCap ?? null,
    peRatio: fundamentals?.peRatio ?? null,
    dividendYield: fundamentals?.dividendYield ?? null,
    return1m: latest?.return1m ?? null,
    return3m: latest?.return3m ?? null,
    return6m: latest?.return6m ?? null,
    return1y: latest?.return1y ?? null,
    volumeEfficiencyToday: efficiency?.efficiencyToday ?? null,
    crowdedRatio: crowded?.ratio ?? null,
    drawdown30d: latest?.maxDrawdown30d ?? null,
    ma5Slope: latest?.ma5Slope ?? null,
    ma20Slope: latest?.ma20Slope ?? null,
    greenRedVolumeRatio1m: latest?.greenRedVolumeRatio1m ?? null,
    greenRedVolumeShare1m: latest?.greenRedVolumeShare1m ?? null,
    shortInterestTrend: interestTrend,
    squeezeScore: squeeze?.score ?? null,
  } satisfies ScreenerRow;
}

export function getMockScreenerRows(): ScreenerRow[] {
  return listMockSymbols().map(buildMockScreenerRow).filter((r): r is ScreenerRow => r != null);
}

/** Per-symbol map of desc-ordered short-interest settlements, mirroring the
 *  Supabase path in `getScreenerRows`. Powers the mock fallback for the
 *  "1/2/3-period trend" short-interest filter. */
export function getMockShortInterestBySymbol(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const symbol of listMockSymbols()) {
    const ss = getMockShortSelling(symbol);
    if (!ss) continue;
    const settlements: number[] = [];
    for (const p of ss.series?.interest ?? []) {
      if (p.shortInterest != null) settlements.push(p.shortInterest);
      if (settlements.length >= 5) break;
    }
    if (settlements.length > 0) out.set(symbol, settlements);
  }
  return out;
}

/**
 * All mock symbols without going through `getAllMockStocks()` (which returns
 * the public StockSearchResult shape). Used internally by the screener so we
 * don't pay the SearchResult mapping on every row.
 */
function listMockSymbols(): string[] {
  return STOCKS.map((s) => s.symbol);
}

// ============================================================================
// Phase 7 + 8 — News mocks for /news page and stock detail News tab.
// Hand-curated so the public app is browseable without Supabase.
// Stock IDs match the seed in `seed.sql` (symbol-as-id pattern is NOT used
// here — admin's mock-data uses `${symbol}-${market}` keys; these use the
// same convention so a future migration to real UUIDs is a simple rename).
// ============================================================================

const _uuid = (s: string) => `00000000-0000-4000-8000-${s.padStart(12, '0')}`;

const REF_AAPL = { id: 'AAPL-US', symbol: 'AAPL', market: 'US' as const, name: 'Apple Inc.' };
const REF_MSFT = { id: 'MSFT-US', symbol: 'MSFT', market: 'US' as const, name: 'Microsoft Corporation' };
const REF_NVDA = { id: 'NVDA-US', symbol: 'NVDA', market: 'US' as const, name: 'NVIDIA Corporation' };
const REF_TSLA = { id: 'TSLA-US', symbol: 'TSLA', market: 'US' as const, name: 'Tesla Inc.' };
const REF_GOOGL = { id: 'GOOGL-US', symbol: 'GOOGL', market: 'US' as const, name: 'Alphabet Inc.' };
const REF_TENCENT = { id: '0700.HK-HK', symbol: '0700.HK', market: 'HK' as const, name: 'Tencent Holdings Ltd.' };

const _NOW = '2026-01-15T10:30:00.000Z';
const _APPROVED = '2026-01-15T11:00:00.000Z';

const MOCK_NEWS_MAPPINGS: NewsStockMappingDto[] = [
  {
    id: _uuid('000000000001'),
    articleId: _uuid('000000000001'),
    stockId: REF_NVDA.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'high',
    confidence: 0.87,
    rationale: 'New Blackwell GPU wins major hyperscaler order from Microsoft.',
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: 'public',
    article: {
      id: _uuid('000000000001'),
      sourceUrl: 'https://www.reuters.com/business/nvidia-blackwell-order',
      sourceName: 'Reuters Business',
      title: 'NVIDIA announces new Blackwell GPU, wins major hyperscaler order',
      summary: 'Microsoft, Meta and Oracle commit to multi-billion-dollar Blackwell purchase.',
      publishedAt: '2026-01-15T09:00:00.000Z',
      fetchedAt: _NOW,
      language: 'en',
    },
    stock: REF_NVDA,
  },
  {
    id: _uuid('000000000002'),
    articleId: _uuid('000000000002'),
    stockId: REF_AAPL.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'high',
    confidence: 0.91,
    rationale: 'Vision Pro 2 launch drives upgrade-cycle narrative.',
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: 'public',
    article: {
      id: _uuid('000000000002'),
      sourceUrl: 'https://finance.yahoo.com/news/apple-vision-pro-2-launch',
      sourceName: 'Yahoo Finance',
      title: 'Apple unveils Vision Pro 2 with $1,999 starting price',
      summary: 'Apple\'s next-gen spatial computer slims down and gains native Apple Intelligence.',
      publishedAt: '2026-01-14T15:30:00.000Z',
      fetchedAt: _NOW,
      language: 'en',
    },
    stock: REF_AAPL,
  },
  {
    id: _uuid('000000000003'),
    articleId: _uuid('000000000003'),
    stockId: REF_TSLA.id,
    sentiment: 'bearish',
    impactDirection: 'negative',
    impactSeverity: 'high',
    confidence: 0.84,
    rationale: 'Voluntary recall affects ~120k vehicles; near-term margin pressure.',
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: 'public',
    article: {
      id: _uuid('000000000003'),
      sourceUrl: 'https://www.marketwatch.com/tesla-recall-2026',
      sourceName: 'MarketWatch',
      title: 'Tesla recalls 120,000 vehicles over steering software defect',
      summary: 'NHTSA filing cites firmware issue in Model Y / Model 3 builds.',
      publishedAt: '2026-01-14T12:00:00.000Z',
      fetchedAt: _NOW,
      language: 'en',
    },
    stock: REF_TSLA,
  },
  {
    id: _uuid('000000000004'),
    articleId: _uuid('000000000004'),
    stockId: REF_TENCENT.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'medium',
    confidence: 0.78,
    rationale: 'Tencent Cloud wins several ASEAN public-sector contracts.',
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: 'public',
    article: {
      id: _uuid('000000000004'),
      sourceUrl: 'https://www.scmp.com/tech/tencent-cloud-asean',
      sourceName: 'SCMP Tech',
      title: 'Tencent Cloud expands aggressively into ASEAN, wins Singapore gov deal',
      summary: 'Counter-program to AWS / Azure; pricing undercuts US hyperscalers by 20-30%.',
      publishedAt: '2026-01-13T08:00:00.000Z',
      fetchedAt: _NOW,
      language: 'en',
    },
    stock: REF_TENCENT,
  },
  {
    id: _uuid('000000000005'),
    articleId: _uuid('000000000005'),
    stockId: REF_GOOGL.id,
    sentiment: 'neutral',
    impactDirection: 'mixed',
    impactSeverity: 'low',
    confidence: 0.55,
    rationale: 'EU antitrust ruling cited as risk; appeal outcome uncertain.',
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: 'public',
    article: {
      id: _uuid('000000000005'),
      sourceUrl: 'https://www.bloomberg.com/news/google-eu-ruling',
      sourceName: 'Bloomberg',
      title: 'EU court upholds antitrust ruling against Google Search bundling',
      summary: 'Alphabet faces remedies; appeals process expected to take 18+ months.',
      publishedAt: '2026-01-12T17:00:00.000Z',
      fetchedAt: _NOW,
      language: 'en',
    },
    stock: REF_GOOGL,
  },
];

const MOCK_RELATIONSHIPS: StockRelationshipDto[] = [
  {
    id: _uuid('000000000010'),
    sourceStockId: REF_NVDA.id,
    targetStockId: REF_MSFT.id,
    relationshipType: 'customer',
    confidence: 0.81,
    rationale: 'Microsoft is one of the largest Azure-cloud customers of NVIDIA GPUs.',
    evidenceNewsId: _uuid('000000000001'),
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: REF_NVDA,
    target: REF_MSFT,
  },
  {
    id: _uuid('000000000011'),
    sourceStockId: REF_AAPL.id,
    targetStockId: REF_GOOGL.id,
    relationshipType: 'competitor',
    confidence: 0.93,
    rationale: 'Both compete in spatial-computing / XR platform layer.',
    evidenceNewsId: _uuid('000000000002'),
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: REF_AAPL,
    target: REF_GOOGL,
  },
  {
    id: _uuid('000000000012'),
    sourceStockId: REF_MSFT.id,
    targetStockId: REF_NVDA.id,
    relationshipType: 'supplier',
    confidence: 0.78,
    rationale: 'NVIDIA supplies the GPUs Microsoft deploys in Azure.',
    evidenceNewsId: _uuid('000000000001'),
    status: 'approved',
    approvedBy: 'local-dev',
    approvedAt: _APPROVED,
    reviewerNotes: null,
    createdAt: _NOW,
    source: REF_MSFT,
    target: REF_NVDA,
  },
];

export function getAllMockNewsMappings(limit = 50): NewsStockMappingDto[] {
  return MOCK_NEWS_MAPPINGS.slice(0, limit);
}

export function getMockNewsMappingsForStock(
  symbol: string,
  limit = 30,
): NewsStockMappingDto[] {
  const upper = symbol.toUpperCase();
  return MOCK_NEWS_MAPPINGS
    .filter((m) => m.stock.symbol.toUpperCase() === upper)
    .slice(0, limit);
}

export function getAllMockRelationships(limit = 30): StockRelationshipDto[] {
  return MOCK_RELATIONSHIPS.slice(0, limit);
}
