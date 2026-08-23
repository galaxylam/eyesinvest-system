import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IndexCode,
  IndexQuote,
  Market,
  PriceSeries,
  Quote,
  StockAnalytics,
  StockFundamentals,
} from '@eyesinvest/types';
import { MARKET_INDICES, getMarketStatus } from '@eyesinvest/types';
import { createServerClient } from '@/lib/supabase/server';
import {
  getAllMockStocks,
  getMockAnalytics,
  getMockFundamentals,
  getMockIndexQuotes,
  getMockPriceSeries,
  getMockQuote,
  getMockRelativeStrength,
  getMockStockDetail,
  getMockTopMoversWithChange,
  getMockVolumeSeries,
  getTopMockMovers,
  searchMockStocks,
  type MockMoverRow,
} from './mock-data';
import type {
  RelativeStrength,
  StockDetail,
  StockSearchResult,
  VolumeAggregates,
  VolumeSeries,
} from './types';

export type { RelativeStrength, VolumeAggregates, VolumeSeries };

interface QueryResult<T> {
  data: T;
  source: 'supabase' | 'mock';
}

/**
 * Helper that runs a real Supabase query if available, else falls back to
 * the bundled mock data set. Keeps the rest of the app unaware of the
 * data source.
 */
async function withFallback<T>(
  fn: (client: SupabaseClient) => Promise<T>,
  fallback: () => T,
): Promise<QueryResult<T>> {
  const client = await createServerClient();
  if (!client) {
    return { data: fallback(), source: 'mock' };
  }
  try {
    const data = await fn(client);
    return { data, source: 'supabase' };
  } catch (err) {
    console.error('[queries] Supabase failed, using mock fallback:', err);
    return { data: fallback(), source: 'mock' };
  }
}

export async function searchStocks(
  q: string,
  opts: { market?: Market; limit?: number } = {},
): Promise<QueryResult<StockSearchResult[]>> {
  return withFallback(
    async (supabase) => {
      const { limit = 20 } = opts;
      let query = supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector, industry')
        .eq('is_active', true)
        .order('symbol', { ascending: true })
        .limit(limit);
      if (opts.market) query = query.eq('market', opts.market);
      if (q.trim().length > 0) {
        const safe = q.replace(/[%_]/g, '\\$&');
        query = query.or(`symbol.ilike.%${safe}%,name.ilike.%${safe}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as StockSearchResult[];
    },
    () => searchMockStocks(q, opts.market).slice(0, opts.limit ?? 20),
  );
}

export async function getStockDetail(symbol: string): Promise<QueryResult<StockDetail | null>> {
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector, industry, exchange, is_active')
        .eq('symbol', symbol.toUpperCase())
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: aliases } = await supabase
        .from('ey_stock_aliases')
        .select('alias')
        .eq('stock_id', data.id);
      return {
        id: data.id,
        symbol: data.symbol,
        name: data.name,
        market: data.market as Market,
        currency: data.currency,
        sector: data.sector,
        industry: data.industry,
        exchange: data.exchange,
        isActive: data.is_active,
        aliases: (aliases ?? []).map((a: { alias: string }) => a.alias),
      } satisfies StockDetail;
    },
    () => getMockStockDetail(symbol),
  );
}

export async function getTopMovers(
  opts: { market?: Market; limit?: number } = {},
): Promise<QueryResult<StockSearchResult[]>> {
  return withFallback(
    async (supabase) => {
      let query = supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector, industry')
        .eq('is_active', true)
        .order('symbol', { ascending: true })
        .limit(opts.limit ?? 5);
      if (opts.market) query = query.eq('market', opts.market);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as StockSearchResult[];
    },
    () => getTopMockMovers(opts.market, opts.limit ?? 5),
  );
}

export async function listAllStocks(): Promise<QueryResult<StockSearchResult[]>> {
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector, industry')
        .eq('is_active', true)
        .order('market', { ascending: true })
        .order('symbol', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as StockSearchResult[];
    },
    () => getAllMockStocks(),
  );
}

// ============================================================================
// Phase 2 — quote, price series, top movers with change, fundamentals
// ============================================================================

export async function getQuote(symbol: string): Promise<QueryResult<Quote | null>> {
  const normalized = symbol.toUpperCase();
  return withFallback(
    async (supabase) => {
      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id, symbol, market, currency')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) return null;

      const { data, error } = await supabase
        .from('ey_quote_snapshot')
        .select('last_price, previous_close, change, change_percent, volume, as_of')
        .eq('stock_id', stockRow.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const market = stockRow.market as Market;
      return {
        symbol: stockRow.symbol,
        market,
        currency: stockRow.currency,
        lastPrice: Number(data.last_price),
        previousClose: Number(data.previous_close),
        change: Number(data.change),
        changePercent: Number(data.change_percent),
        volume: Number(data.volume),
        asOf: data.as_of,
        status: getMarketStatus(market),
      } satisfies Quote;
    },
    () => getMockQuote(normalized),
  );
}

export async function getPriceSeries(
  symbol: string,
  opts: { days?: number } = {},
): Promise<QueryResult<PriceSeries | null>> {
  const normalized = symbol.toUpperCase();
  const days = opts.days ?? 252;
  return withFallback(
    async (supabase) => {
      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id, symbol, market, currency')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) return null;

      const { data, error } = await supabase
        .from('ey_price_1d')
        .select('trade_date, open, high, low, close, volume')
        .eq('stock_id', stockRow.id)
        .order('trade_date', { ascending: false })
        .limit(days);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        trade_date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
      if (rows.length === 0) return null;

      // Reverse so ascending order, drop duplicates.
      const seen = new Set<string>();
      const bars = rows
        .map((r) => ({
          time: r.trade_date,
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume),
        }))
        .filter((b) => {
          if (seen.has(b.time)) return false;
          seen.add(b.time);
          return true;
        })
        .reverse();

      return {
        symbol: stockRow.symbol,
        market: stockRow.market as Market,
        currency: stockRow.currency,
        bars,
      } satisfies PriceSeries;
    },
    () => getMockPriceSeries(normalized, days),
  );
}

export interface TopMoverRow extends StockSearchResult {
  changePercent: number | null;
}

export async function getTopMoversWithChange(
  opts: { market?: Market; limit?: number } = {},
): Promise<QueryResult<TopMoverRow[]>> {
  const limit = opts.limit ?? 5;
  return withFallback(
    async (supabase) => {
      let query = supabase
        .from('ey_v_top_movers')
        .select('id, symbol, name, market, currency, change_percent, as_of')
        .order('change_percent', { ascending: false })
        .limit(limit);
      if (opts.market) query = query.eq('market', opts.market);
      const { data, error } = await query;
      if (error) throw error;
      // ey_v_top_movers orders by abs(change_percent) but exposes the signed
      // value; sort client-side for consistent direction (most negative first
      // when we flip the sign — keep simple: order desc by signed value).
      const rows = ((data ?? []) as Array<{
        id: string;
        symbol: string;
        name: string;
        market: string;
        currency: string;
        change_percent: number | null;
        as_of: string;
      }>).map((r) => ({
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        market: r.market as Market,
        currency: r.currency,
        sector: null,
        industry: null,
        changePercent: r.change_percent == null ? null : Number(r.change_percent),
      })) satisfies TopMoverRow[];
      return rows;
    },
    () => {
      const rows: TopMoverRow[] = getMockTopMoversWithChange(opts.market, limit).map(
        (m: MockMoverRow) => ({
          id: m.id,
          symbol: m.symbol,
          name: m.name,
          market: m.market,
          currency: m.currency,
          sector: m.sector,
          industry: m.industry,
          changePercent: m.changePercent,
        }),
      );
      return rows;
    },
  );
}

export async function getStockFundamentals(
  symbol: string,
): Promise<QueryResult<StockFundamentals | null>> {
  const normalized = symbol.toUpperCase();
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_stocks')
        .select(
          'market_cap, shares_outstanding, pe_ratio, dividend_yield, fifty_two_week_high, fifty_two_week_low, fundamentals_source, fundamentals_fetched_at',
        )
        .eq('symbol', normalized)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        marketCap: data.market_cap == null ? null : Number(data.market_cap),
        sharesOutstanding:
          data.shares_outstanding == null ? null : Number(data.shares_outstanding),
        peRatio: data.pe_ratio == null ? null : Number(data.pe_ratio),
        dividendYield:
          data.dividend_yield == null ? null : Number(data.dividend_yield),
        fiftyTwoWeekHigh:
          data.fifty_two_week_high == null ? null : Number(data.fifty_two_week_high),
        fiftyTwoWeekLow:
          data.fifty_two_week_low == null ? null : Number(data.fifty_two_week_low),
        source: data.fundamentals_source,
        fetchedAt: data.fundamentals_fetched_at,
      } satisfies StockFundamentals;
    },
    () => getMockFundamentals(normalized),
  );
}

/** 52-week high/low derived from ey_price_1d (window over the last 252 rows). */
export async function getPriceRange52W(
  symbol: string,
): Promise<QueryResult<{ high: number | null; low: number | null }>> {
  const normalized = symbol.toUpperCase();
  return withFallback(
    async (supabase) => {
      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) return { high: null, low: null };

      const { data, error } = await supabase
        .from('ey_price_1d')
        .select('high, low')
        .eq('stock_id', stockRow.id)
        .order('trade_date', { ascending: false })
        .limit(252);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ high: number; low: number }>;
      if (rows.length === 0) return { high: null, low: null };
      const high = Math.max(...rows.map((r) => Number(r.high)));
      const low = Math.min(...rows.map((r) => Number(r.low)));
      return { high, low };
    },
    () => {
      const series = getMockPriceSeries(normalized, 252);
      if (!series || series.bars.length === 0) return { high: null, low: null };
      return {
        high: Math.max(...series.bars.map((b) => b.high)),
        low: Math.min(...series.bars.map((b) => b.low)),
      };
    },
  );
}

// ============================================================================
// Phase 3 — analytics + index quotes
// ============================================================================

/**
 * Latest computed analytics for a stock. Returns one row per as-of date —
 * the caller usually wants the last element. `days` caps the window returned.
 */
export async function getStockAnalytics(
  symbol: string,
  opts: { days?: number } = {},
): Promise<QueryResult<StockAnalytics[]>> {
  const normalized = symbol.toUpperCase();
  const days = opts.days ?? 30;
  return withFallback(
    async (supabase) => {
      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) return [];

      const { data, error } = await supabase
        .from('ey_stock_analytics')
        .select(
          'as_of_date, ma20, ma50, ma200, rsi14, macd_line, macd_signal, macd_hist, volatility_30d, max_drawdown_30d, return_1m, return_3m, return_6m, return_1y',
        )
        .eq('stock_id', stockRow.id)
        .order('as_of_date', { ascending: false })
        .limit(days);
      if (error) throw error;

      const num = (v: unknown): number | null =>
        v == null ? null : Number(v);

      const rows = ((data ?? []) as Array<{
        as_of_date: string;
        ma20: number | null;
        ma50: number | null;
        ma200: number | null;
        rsi14: number | null;
        macd_line: number | null;
        macd_signal: number | null;
        macd_hist: number | null;
        volatility_30d: number | null;
        max_drawdown_30d: number | null;
        return_1m: number | null;
        return_3m: number | null;
        return_6m: number | null;
        return_1y: number | null;
      }>).map(
        (r) =>
          ({
            stockId: stockRow.id,
            asOfDate: r.as_of_date,
            ma20: num(r.ma20),
            ma50: num(r.ma50),
            ma200: num(r.ma200),
            rsi14: num(r.rsi14),
            macdLine: num(r.macd_line),
            macdSignal: num(r.macd_signal),
            macdHist: num(r.macd_hist),
            volatility30d: num(r.volatility_30d),
            maxDrawdown30d: num(r.max_drawdown_30d),
            return1m: num(r.return_1m),
            return3m: num(r.return_3m),
            return6m: num(r.return_6m),
            return1y: num(r.return_1y),
          }) satisfies StockAnalytics,
      );

      // Reverse so caller sees ascending dates.
      return rows.reverse();
    },
    () => getMockAnalytics(normalized, days),
  );
}

/** Latest quote for each tracked market index (SPX, HSI). */
export async function getIndexQuotes(): Promise<QueryResult<IndexQuote[]>> {
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_index_quote')
        .select('code, market, last, previous_close, change, change_percent, as_of')
        .order('code', { ascending: true });
      if (error) throw error;
      const rows = ((data ?? []) as Array<{
        code: string;
        market: string;
        last: number;
        previous_close: number;
        change: number;
        change_percent: number;
        as_of: string;
      }>).map(
        (r) =>
          ({
            code: r.code as IndexQuote['code'],
            market: r.market as Market,
            last: Number(r.last),
            previousClose: Number(r.previous_close),
            change: Number(r.change),
            changePercent: Number(r.change_percent),
            asOf: r.as_of,
          }) satisfies IndexQuote,
      );
      return rows;
    },
    () => getMockIndexQuotes(),
  );
}

// ============================================================================
// Phase 4 — volume + relative-strength queries for tabbed stock detail
// ============================================================================

/**
 * Daily volume series + aggregates for the Volume tab. Reads from
 * `ey_price_1d` (same table as the candlestick chart) — no new schema work.
 */
export async function getVolumeSeries(
  symbol: string,
  opts: { days?: number } = {},
): Promise<QueryResult<VolumeSeries | null>> {
  const normalized = symbol.toUpperCase();
  const days = opts.days ?? 252;
  return withFallback(
    async (supabase) => {
      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id, symbol, market')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) return null;

      const { data, error } = await supabase
        .from('ey_price_1d')
        .select('trade_date, close, volume')
        .eq('stock_id', stockRow.id)
        .order('trade_date', { ascending: false })
        .limit(days);
      if (error) throw error;

      const rows = ((data ?? []) as Array<{
        trade_date: string;
        close: number;
        volume: number;
      }>).map((r) => ({
        date: r.trade_date,
        close: Number(r.close),
        volume: Number(r.volume),
      }));
      if (rows.length === 0) return null;

      // Supabase returns descending; flip so the rolling mean and aggregates
      // match the chart's left→right order.
      rows.reverse();

      const avg = (window: number): number | null => {
        if (rows.length < window) return null;
        const slice = rows.slice(-window);
        return slice.reduce((s, r) => s + r.volume, 0) / slice.length;
      };
      const avg30d = avg(30);
      const avg90d = avg(90);

      const daily = rows.map((r, i) => {
        const start = Math.max(0, i - 19);
        const slice = rows.slice(start, i + 1);
        const sum = slice.reduce((s, x) => s + x.volume, 0);
        return {
          date: r.date,
          close: r.close,
          volume: r.volume,
          avgVolume20: slice.length > 0 ? sum / slice.length : null,
        };
      });

      const latest = rows[rows.length - 1];
      const latestVs30dPct =
        latest != null && avg30d != null && avg30d > 0
          ? +(((latest.volume - avg30d) / avg30d) * 100).toFixed(2)
          : null;

      let maxVol = -Infinity;
      let maxDate: string | null = null;
      for (const r of rows) {
        if (r.volume > maxVol) {
          maxVol = r.volume;
          maxDate = r.date;
        }
      }

      return {
        symbol: stockRow.symbol,
        market: stockRow.market as Market,
        daily,
        aggregates: {
          avg30d,
          avg90d,
          latestVs30dPct,
          maxInWindow: Number.isFinite(maxVol) ? maxVol : null,
          maxDate,
        },
      } satisfies VolumeSeries;
    },
    () => getMockVolumeSeries(normalized, days),
  );
}

/**
 * Stock-vs-benchmark relative strength.
 *
 * `ey_index_quote` is a single-row-per-index snapshot table — there is no
 * per-window benchmark history to subtract from a 1m/3m/6m/1y stock return.
 * So this query only computes `rsSession` (stock `changePercent` minus
 * benchmark `changePercent` for today). The 1m/3m/6m/1y stock returns are
 * still pulled so the panel can show them without comparison.
 */
export async function getRelativeStrength(
  symbol: string,
  opts: { market: Market; quoteChangePercent?: number | null },
): Promise<QueryResult<RelativeStrength | null>> {
  const normalized = symbol.toUpperCase();
  const indexCode: IndexCode = opts.market === 'HK' ? 'HSI' : 'SPX';
  const indexMeta = MARKET_INDICES[indexCode];

  return withFallback(
    async (supabase) => {
      const { data: indexRow, error: indexErr } = await supabase
        .from('ey_index_quote')
        .select('change_percent')
        .eq('code', indexCode)
        .maybeSingle();
      if (indexErr) throw indexErr;
      const indexChangePercent =
        indexRow == null || indexRow.change_percent == null
          ? null
          : Number(indexRow.change_percent);

      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) {
        return {
          indexCode,
          indexName: {
            en: indexMeta.nameEn,
            zhHk: indexMeta.nameZhHk,
            zhCn: indexMeta.nameZhCn,
          },
          indexChangePercent,
          stockReturn1m: null,
          stockReturn3m: null,
          stockReturn6m: null,
          stockReturn1y: null,
          rsSession: diffPct(opts.quoteChangePercent ?? null, indexChangePercent),
        } satisfies RelativeStrength;
      }

      const { data: analyticsRow, error: analyticsErr } = await supabase
        .from('ey_stock_analytics')
        .select('return_1m, return_3m, return_6m, return_1y')
        .eq('stock_id', stockRow.id)
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (analyticsErr) throw analyticsErr;
      const num = (v: unknown): number | null =>
        v == null ? null : Number(v);
      const r1m = analyticsRow ? num(analyticsRow.return_1m) : null;
      const r3m = analyticsRow ? num(analyticsRow.return_3m) : null;
      const r6m = analyticsRow ? num(analyticsRow.return_6m) : null;
      const r1y = analyticsRow ? num(analyticsRow.return_1y) : null;

      return {
        indexCode,
        indexName: {
          en: indexMeta.nameEn,
          zhHk: indexMeta.nameZhHk,
          zhCn: indexMeta.nameZhCn,
        },
        indexChangePercent,
        stockReturn1m: r1m,
        stockReturn3m: r3m,
        stockReturn6m: r6m,
        stockReturn1y: r1y,
        rsSession: diffPct(opts.quoteChangePercent ?? null, indexChangePercent),
      } satisfies RelativeStrength;
    },
    () =>
      getMockRelativeStrength(normalized, {
        market: opts.market,
        quoteChangePercent: opts.quoteChangePercent ?? null,
      }),
  );
}

/** Signed percent-point difference with null-safe semantics + 2-decimal rounding. */
function diffPct(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return +(a - b).toFixed(2);
}
