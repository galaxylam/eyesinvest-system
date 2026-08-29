import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ImpactDirection,
  ImpactSeverity,
  IndexCode,
  IndexQuote,
  MappingStatus,
  Market,
  NewsStockMappingDto,
  PriceSeries,
  Quote,
  RelationshipType,
  SectorDailyRow,
  Sentiment,
  StockAnalytics,
  StockFundamentals,
  StockRelationshipDto,
} from '@eyesinvest/types';
import { MARKET_INDICES, getMarketStatus } from '@eyesinvest/types';
import { createServerClient } from '@/lib/supabase/server';
import {
  getAllMockNewsMappings,
  getAllMockRelationships,
  getAllMockStocks,
  getMockAnalytics,
  getMockCrowdedRatio,
  getMockFundamentals,
  getMockIndexQuotes,
  getMockNewsMappingsForStock,
  getMockPriceSeries,
  getMockQuote,
  getMockRelativeStrength,
  getMockScreenerRows,
  getMockSectorDaily,
  getMockSearchStocks,
  getMockShortInterestBySymbol,
  getMockShortSelling,
  getMockSqueeze,
  getMockStockDetail,
  getMockStocksBySector,
  getMockTopMoversWithChange,
  getMockVolumeEfficiency,
  getMockVolumeSeries,
  getTopMockMovers,
  type MockMoverRow,
} from './mock-data';
import type {
  CrowdedRatio,
  CrowdedRatioPoint,
  CrowdedRegime,
  EfficiencyPoint,
  GreenShareThreshold,
  RelativeStrength,
  ScreenerFilters,
  ShortInterestTrendFilter,
  ScreenerRow,
  ScreenerSort,
  ScreenerSortColumn,
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

export type {
  CrowdedRatio,
  CrowdedRatioPoint,
  CrowdedRegime,
  EfficiencyPoint,
  RelativeStrength,
  ScreenerFilters,
  ScreenerRow,
  ScreenerSort,
  ScreenerSortColumn,
  ShortInterestPoint,
  ShortSelling,
  ShortSellingPoint,
  SqueezeScore,
  VolumeAggregates,
  VolumeEfficiency,
  VolumeSeries,
};

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

/**
 * Substring search over symbol + name. Used by `/search?q=...` — never
 * 404s, just returns an empty list when nothing matches. Symbol prefix
 * matches rank first; exact matches rank highest.
 */
export async function searchStocks(
  query: string,
  opts: { limit?: number } = {},
): Promise<QueryResult<StockSearchResult[]>> {
  const limit = opts.limit ?? 20;
  const q = query.trim();
  if (!q) {
    // Empty query — return the full universe as a browse-friendly default.
    return listAllStocks();
  }
  return withFallback(
    async (supabase) => {
      const pattern = `%${q}%`;
      const { data, error } = await supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector, industry')
        .eq('is_active', true)
        .or(`symbol.ilike.${pattern},name.ilike.${pattern}`)
        .order('symbol', { ascending: true })
        .limit(limit);
      if (error) throw error;
      // Promote exact-prefix matches to the top; fall back to DB order.
      const rows = (data ?? []) as unknown as StockSearchResult[];
      const upper = q.toUpperCase();
      return rows
        .map((r, i) => ({
          r,
          // Negative rank = higher priority. Exact-prefix symbol → -2;
          // substring match on symbol → -1; name-substring only → 0.
          rank:
            r.symbol.toUpperCase() === upper
              ? -2
              : r.symbol.toUpperCase().startsWith(upper)
                ? -1
                : 0,
          // Preserve original order as tiebreaker.
          originalIndex: i,
        }))
        .sort((a, b) =>
          a.rank !== b.rank
            ? a.rank - b.rank
            : a.originalIndex - b.originalIndex,
        )
        .map((x) => x.r);
    },
    () => getMockSearchStocks(q, limit),
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

      // ma5 is fetched separately below as a best-effort read so that the
      // analytics query keeps working on databases where migration 0010
      // (add_ma5.sql) hasn't been applied yet — PostgREST would otherwise
      // reject the whole SELECT with 42703 and `withFallback` would drop us
      // into mock data.
      const { data, error } = await supabase
        .from('ey_stock_analytics')
        .select(
          'as_of_date, ma20, ma50, ma200, rsi14, macd_line, macd_signal, macd_hist, ' +
            'volatility_30d, max_drawdown_30d, return_1m, return_3m, return_6m, return_1y, return_1w, ' +
            'volume_efficiency, crowded_ratio, green_red_volume_ratio_1m, green_red_volume_share_1m, relative_strength',
        )
        .eq('stock_id', stockRow.id)
        .order('as_of_date', { ascending: false })
        .limit(days);
      if (error) throw error;

      const ma5ByDate = new Map<string, number | null>();
      const ma5Result = await supabase
        .from('ey_stock_analytics')
        .select('as_of_date, ma5')
        .eq('stock_id', stockRow.id)
        .order('as_of_date', { ascending: false })
        .limit(days);
      if (ma5Result.error) {
        const msg = ma5Result.error.message ?? '';
        if (ma5Result.error.code === '42703' && /ma5/.test(msg)) {
          // Pre-migration-0010 state — leave ma5 null on every row.
        } else {
          throw ma5Result.error;
        }
      } else {
        for (const r of ((ma5Result.data ?? []) as Array<{
          as_of_date: string;
          ma5: number | null;
        }>)) {
          ma5ByDate.set(r.as_of_date, r.ma5);
        }
      }

      const num = (v: unknown): number | null =>
        v == null ? null : Number(v);

      const rows = ((data ?? []) as unknown as Array<{
        as_of_date: string;
        ma20: number | null;
        ma50: number | null;
        ma200: number | null;
        ma5_slope: number | null;
        ma20_slope: number | null;
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
        return_1w: number | null;
        volume_efficiency: number | null;
        crowded_ratio: number | null;
        green_red_volume_ratio_1m: number | null;
        green_red_volume_share_1m: number | null;
        relative_strength: number | null;
      }>).map(
        (r) =>
          ({
            stockId: stockRow.id,
            asOfDate: r.as_of_date,
            ma5: num(ma5ByDate.get(r.as_of_date) ?? null),
            ma20: num(r.ma20),
            ma50: num(r.ma50),
            ma200: num(r.ma200),
            ma5Slope: num(r.ma5_slope),
            ma20Slope: num(r.ma20_slope),
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
            return1w: num(r.return_1w),
            volumeEfficiency: num(r.volume_efficiency),
            crowdedRatio: num(r.crowded_ratio),
            greenRedVolumeRatio1m: num(r.green_red_volume_ratio_1m),
            greenRedVolumeShare1m: num(r.green_red_volume_share_1m),
            relativeStrength: num(r.relative_strength),
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

/** Merge a list of per-chunk query errors into a single error-shaped value
 *  matching the `{ error: PostgrestError | null }` shape the screener
 *  pipeline already consumes. Returns the first non-null error, or null
 *  if all chunks succeeded — chunks that errored partway through still
 *  let the caller inspect via the returned error. */
function mergeErrors<T>(errors: Array<T | null | undefined>): T | null {
  for (const e of errors) {
    if (e) return e;
  }
  return null;
}

// ============================================================================
// Volume Efficiency + Crowded Ratio — combination metrics for the Volume tab
// and the screener. Pulls the same `ey_price_1d` rows as `getVolumeSeries`
// but computes different aggregates on top.
// ============================================================================

/**
 * |change%| ÷ (volume ÷ sharesOutstanding × 100). Returns `null` when
 * `shares_outstanding` is missing or zero so the panel can render a
 * "no float data" state instead of a misleading number.
 */
export async function getVolumeEfficiency(
  symbol: string,
  opts: { days?: number } = {},
): Promise<QueryResult<VolumeEfficiency | null>> {
  const normalized = symbol.toUpperCase();
  const days = opts.days ?? 30;
  return withFallback(
    async (supabase) => {
      const { data: stockRow, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id, symbol, market, shares_outstanding')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockErr) throw stockErr;
      if (!stockRow) return null;

      const shares = stockRow.shares_outstanding == null
        ? null
        : Number(stockRow.shares_outstanding);
      const hasFloatData = shares != null && shares > 0;

      // Note: `ey_stock_analytics.volume_efficiency` is populated by
      // `sync-sector-strength` for the sector-strength aggregation pass and
      // for the screener's filter UI, but we deliberately do NOT short-
      // circuit here. The persisted column is a single-day scalar — the
      // chart needs a 30-day per-day series, which only the per-request
      // `ey_price_1d` compute below can produce. Reading the column here
      // would leave the chart with `series: []` and no bars to draw.

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
      // Ascending so the rolling mean is consistent with the chart.
      rows.reverse();

      const latest = rows[rows.length - 1] ?? null;
      const turnoverPctToday =
        latest && hasFloatData && shares != null
          ? (latest.volume / shares) * 100
          : null;

      // Use the latest daily close-over-close change vs the previous row so
      // we don't depend on `ey_quote_snapshot` here — that snapshot is the
      // intraday one and may diverge from the daily bar.
      const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
      const dailyChangePct =
        latest != null && prev != null && prev.close !== 0
          ? ((latest.close - prev.close) / prev.close) * 100
          : null;
      const efficiencyToday =
        dailyChangePct != null && turnoverPctToday != null && turnoverPctToday > 0
          ? Math.abs(dailyChangePct) / turnoverPctToday
          : null;

      const avgTurnoverPct30d = (() => {
        if (!hasFloatData || shares == null) return null;
        if (rows.length === 0) return null;
        const sum = rows.reduce((s, r) => s + (r.volume / shares) * 100, 0);
        return sum / rows.length;
      })();

      // Per-day series used by the VolumeEfficiencyChart subplot. Built from
      // the same `rows` array the headline fields come from — no extra
      // query. First day has no prior close, so its efficiency is null.
      const series: EfficiencyPoint[] = rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        const dailyChangePct =
          prev != null && prev.close !== 0
            ? ((r.close - prev.close) / prev.close) * 100
            : null;
        const turnoverPct =
          hasFloatData && shares != null ? (r.volume / shares) * 100 : null;
        const efficiency =
          dailyChangePct != null && turnoverPct != null && turnoverPct > 0
            ? Math.abs(dailyChangePct) / turnoverPct
            : null;
        return { date: r.date, efficiency, turnoverPct, dailyChangePct, volume: r.volume };
      });

      return {
        symbol: stockRow.symbol,
        market: stockRow.market as Market,
        efficiencyToday,
        turnoverPctToday,
        avgTurnoverPct30d,
        sharesOutstanding: shares,
        hasFloatData,
        asOfDate: latest?.date ?? null,
        series,
      } satisfies VolumeEfficiency;
    },
    () => getMockVolumeEfficiency(normalized),
  );
}

/**
 * FOMO_Ratio = MA5(volume) ÷ MA30(volume) per day. Returns the latest ratio
 * + the full daily series so the UI can draw a MA5 / MA30 subgraph.
 */
export async function getCrowdedRatio(
  symbol: string,
  opts: { days?: number } = {},
): Promise<QueryResult<CrowdedRatio | null>> {
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

      // Note: `ey_stock_analytics.crowded_ratio` is populated by
      // `sync-sector-strength` for the sector-strength aggregation pass
      // and for the screener's filter UI, but we deliberately do NOT
      // short-circuit here. The persisted column is a single-day
      // MA5÷MA30 scalar — the chart needs a per-day series, which only
      // the per-request `ey_price_1d` compute below can produce.
      // Reading the column here would leave the chart with `series: []`
      // and no MA5/MA30 subplot to draw.

      const { data, error } = await supabase
        .from('ey_price_1d')
        .select('trade_date, volume')
        .eq('stock_id', stockRow.id)
        .order('trade_date', { ascending: false })
        .limit(days);
      if (error) throw error;
      const rows = ((data ?? []) as Array<{
        trade_date: string;
        volume: number;
      }>).map((r) => ({
        date: r.trade_date,
        volume: Number(r.volume),
      }));
      rows.reverse();

      if (rows.length === 0) {
        return {
          symbol: stockRow.symbol,
          market: stockRow.market as Market,
          ratio: null,
          ma5: null,
          ma30: null,
          regime: null,
          series: [],
          asOfDate: null,
        } satisfies CrowdedRatio;
      }

      const series: CrowdedRatioPoint[] = rows.map((r, i) => {
        const start5 = Math.max(0, i - 4);
        const start30 = Math.max(0, i - 29);
        const slice5 = rows.slice(start5, i + 1);
        const slice30 = rows.slice(start30, i + 1);
        const ma5 = slice5.reduce((s, x) => s + x.volume, 0) / slice5.length;
        const ma30 = slice30.reduce((s, x) => s + x.volume, 0) / slice30.length;
        const ratio = slice30.length >= 30 ? ma5 / ma30 : null;
        return { date: r.date, ratio, ma5, ma30 };
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
        symbol: stockRow.symbol,
        market: stockRow.market as Market,
        ratio,
        ma5,
        ma30,
        regime,
        series,
        asOfDate: latest?.date ?? null,
      } satisfies CrowdedRatio;
    },
    () => getMockCrowdedRatio(normalized, days),
  );
}

// ============================================================================
// Screener — denormalised one-row-per-stock for /screener. Joins client-side
// (ey_stocks — which carries `market_cap` / `pe_ratio` / `dividend_yield`
// directly — + ey_quote_snapshot + latest ey_stock_analytics row) so we
// don't need a SQL view migration; the data volume per market is small and
// Supabase's foreign keys + indexes keep the three-table scan fast enough.
// ============================================================================

const SCREENER_LIMIT = 200;

/**
 * Unique non-null sector strings across the active stock universe. Drives the
 * sector dropdown options on the screener so they're never hard-coded.
 */
export async function getScreenerSectors(): Promise<QueryResult<string[]>> {
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_stocks')
        .select('sector')
        .eq('is_active', true)
        .not('sector', 'is', null);
      if (error) throw error;
      const set = new Set<string>();
      for (const r of (data ?? []) as Array<{ sector: string | null }>) {
        if (r.sector) set.add(r.sector);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    },
    () => {
      const set = new Set<string>();
      for (const r of getMockScreenerRows()) {
        if (r.sector) set.add(r.sector);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    },
  );
}

export async function getScreenerRows(
  opts: { filters?: ScreenerFilters; sort?: ScreenerSort } = {},
): Promise<QueryResult<ScreenerRow[]>> {
  const filters = opts.filters ?? {};
  const sort: ScreenerSort = opts.sort ?? { column: 'marketCap', dir: 'desc' };
  return withFallback(
    async (supabase) => {
      // Fundamentals live on `ey_stocks` (see migration 0003) — no separate
      // `ey_stock_fundamentals` table. Including them in the initial SELECT
      // saves a round-trip and avoids a silent fallback to mock data.
      const { data: stocks, error: stocksErr } = await supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector, market_cap, pe_ratio, dividend_yield')
        .eq('is_active', true)
        .order('symbol', { ascending: true });
      if (stocksErr) throw stocksErr;
      const stockRows = (stocks ?? []) as Array<{
        id: string;
        symbol: string;
        name: string;
        market: Market;
        currency: string;
        sector: string | null;
        market_cap: number | null;
        pe_ratio: number | null;
        dividend_yield: number | null;
      }>;
      if (stockRows.length === 0) return [];

      const ids = stockRows.map((s) => s.id);
      // Split the id list into chunks so each `.in('stock_id', chunk)`
      // serializes under PostgREST's 16KB request-URL limit. With 200+
      // active stocks the unchunked query exceeds that limit and undici
      // throws UND_ERR_HEADERS_OVERFLOW — the screener then silently falls
      // back to mock data, which is why the user was seeing real-data
      // fetches fail in production. CHUNK_SIZE 80 keeps each `.in()` to
      // ~3KB of UUID payload, well under the limit.
      const CHUNK_SIZE = 80;
      const idChunks: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        idChunks.push(ids.slice(i, i + CHUNK_SIZE));
      }

      const [quotesArr, analyticsArr, interestArr] = await Promise.all([
        Promise.all(
          idChunks.map((chunk) =>
            supabase.from('ey_quote_snapshot').select(
              'stock_id, last_price, change, change_percent, volume',
            ).in('stock_id', chunk),
          ),
        ),
        // One row per (stock, as_of_date); take the latest by as_of_date desc.
        // Phase 3+: `volume_efficiency` + `crowded_ratio` are persisted here by
        // `sync-sector-strength` — replaces the previous per-stock
        // `ey_price_1d` 30-day pull + `deriveEfficiencyAndCrowded` round trip.
        // Phase 3+ screener filters: ma5_slope / ma20_slope /
        // green_red_volume_ratio_1m drive the "MA upward / 1M green vs red"
        // dropdowns (see 0011_screener_filters.sql).
        Promise.all(
          idChunks.map((chunk) =>
            supabase.from('ey_stock_analytics').select(
              'stock_id, as_of_date, return_1m, return_3m, return_6m, return_1y, ' +
                'volume_efficiency, crowded_ratio, max_drawdown_30d, ma5_slope, ma20_slope, ' +
                'green_red_volume_ratio_1m, green_red_volume_share_1m, squeeze_score',
            ).in('stock_id', chunk).order('as_of_date', { ascending: false }),
          ),
        ),
        // Last 5 bi-weekly settlements per stock — enough for the
        // "increasing / decreasing for 1/2/3 periods" short-interest filter.
        // One row per (stock_id, settlement_date); 30 stocks × 5 ≈ 150 rows.
        // We ask each chunk for `chunk.length * 5` rows so the per-stock
        // cap is unchanged regardless of chunking.
        Promise.all(
          idChunks.map((chunk) =>
            supabase.from('ey_short_interest').select(
              'stock_id, settlement_date, short_interest',
            ).in('stock_id', chunk).order('settlement_date', { ascending: false })
              .limit(chunk.length * 5),
          ),
        ),
      ]);
      const quotesRes = { data: quotesArr.flatMap((r) => r.data ?? []), error: mergeErrors(quotesArr.map((r) => r.error)) };
      const analyticsRes = { data: analyticsArr.flatMap((r) => r.data ?? []), error: mergeErrors(analyticsArr.map((r) => r.error)) };
      const interestRes = { data: interestArr.flatMap((r) => r.data ?? []), error: mergeErrors(interestArr.map((r) => r.error)) };
      if (quotesRes.error) throw quotesRes.error;
      if (analyticsRes.error) throw analyticsRes.error;
      if (interestRes.error) throw interestRes.error;

      const quoteMap = new Map<string, { last_price: number | null; change: number | null; change_percent: number | null; volume: number | null }>();
      for (const q of (quotesRes.data ?? []) as Array<{ stock_id: string; last_price: number | null; change: number | null; change_percent: number | null; volume: number | null }>) {
        quoteMap.set(q.stock_id, q);
      }
      // Latest analytics row per stock_id.
      const analyticsMap = new Map<string, {
        return_1m: number | null; return_3m: number | null; return_6m: number | null; return_1y: number | null;
        volume_efficiency: number | null; crowded_ratio: number | null;
        max_drawdown_30d: number | null;
        ma5_slope: number | null; ma20_slope: number | null; green_red_volume_ratio_1m: number | null;
        green_red_volume_share_1m: number | null;
        squeeze_score: number | null;
      }>();
      for (const a of ((analyticsRes.data ?? []) as unknown as Array<{
        stock_id: string; as_of_date: string;
        return_1m: number | null; return_3m: number | null; return_6m: number | null; return_1y: number | null;
        volume_efficiency: number | null; crowded_ratio: number | null;
        max_drawdown_30d: number | null;
        ma5_slope: number | null; ma20_slope: number | null; green_red_volume_ratio_1m: number | null;
        green_red_volume_share_1m: number | null;
        squeeze_score: number | null;
      }>)) {
        if (analyticsMap.has(a.stock_id)) continue; // first wins; we ordered desc
        analyticsMap.set(a.stock_id, a);
      }

      // stock_id → symbol lookup so the short-interest map can be keyed
      // by symbol (which is what `applyScreenerFilters` uses for lookups
      // via `r.symbol`).
      const symbolByStockId = new Map<string, string>();
      for (const s of stockRows) symbolByStockId.set(s.id, s.symbol);

      // Latest short-interest settlements per symbol (already desc-ordered).
      // Keyed by symbol (not stock_id) so `applyScreenerFilters` can look
      // up by `r.symbol` — see the bug note in applyScreenerFilters.
      const interestBySymbol = new Map<string, number[]>();
      for (const r of (interestRes.data ?? []) as Array<{ stock_id: string; settlement_date: string; short_interest: number | null }>) {
        if (r.short_interest == null) continue;
        const sym = symbolByStockId.get(r.stock_id);
        if (sym == null) continue;
        const list = interestBySymbol.get(sym) ?? [];
        if (list.length < 5) list.push(Number(r.short_interest));
        interestBySymbol.set(sym, list);
      }

      const rows: ScreenerRow[] = stockRows.map((s) => {
        const q = quoteMap.get(s.id);
        const a = analyticsMap.get(s.id);
        const interest = interestBySymbol.get(s.symbol) ?? [];
        const num = (v: unknown): number | null => (v == null ? null : Number(v));
        return {
          symbol: s.symbol,
          name: s.name,
          market: s.market,
          currency: s.currency,
          sector: s.sector,
          lastPrice: q ? num(q.last_price) : null,
          change: q ? num(q.change) : null,
          changePercent: q ? num(q.change_percent) : null,
          volume: q ? num(q.volume) : null,
          // Fundamentals now come straight off the ey_stocks row we already
          // pulled in (no separate ey_stock_fundamentals table to join).
          marketCap: num(s.market_cap),
          peRatio: num(s.pe_ratio),
          dividendYield: num(s.dividend_yield),
          return1m: a ? num(a.return_1m) : null,
          return3m: a ? num(a.return_3m) : null,
          return6m: a ? num(a.return_6m) : null,
          return1y: a ? num(a.return_1y) : null,
          volumeEfficiencyToday: a ? num(a.volume_efficiency) : null,
          crowdedRatio: a ? num(a.crowded_ratio) : null,
          drawdown30d: a ? num(a.max_drawdown_30d) : null,
          ma5Slope: a ? num(a.ma5_slope) : null,
          ma20Slope: a ? num(a.ma20_slope) : null,
          greenRedVolumeRatio1m: a ? num(a.green_red_volume_ratio_1m) : null,
          greenRedVolumeShare1m: a ? num(a.green_red_volume_share_1m) : null,
          shortInterestTrend: computeShortInterestTrend(interest),
          squeezeScore: a ? num(a.squeeze_score) : null,
        } satisfies ScreenerRow;
      });

      return applyScreenerSort(
        applyScreenerFilters(rows, filters, interestBySymbol),
        sort,
      ).slice(0, SCREENER_LIMIT);
    },
    () =>
      applyScreenerSort(
        applyScreenerFilters(getMockScreenerRows(), filters, getMockShortInterestBySymbol()),
        sort,
      ).slice(0, SCREENER_LIMIT),
  );
}

// ============================================================================
// Phase 3+ — Sector Strength (`ey_sector_daily`). Two read paths:
//   - `getSectorStrengthLatest` — dashboard leaderboard tile (one row per
//     sector, latest as_of_date, sorted by rs_vs_market_1m desc).
//   - `getSectorDaily` — historical list (limit + optional sector filter)
//     for future by-sector chart views.
// ============================================================================

const SECTOR_DAILY_COLUMNS =
  'sector, as_of_date, member_count, breadth_pct, ' +
  'sector_return_1w, sector_return_1m, sector_return_3m, sector_return_6m, sector_return_1y, ' +
  'rs_vs_market_1w, rs_vs_market_1m, rs_vs_market_3m, rs_vs_market_6m, rs_vs_market_1y, ' +
  'volume_efficiency_mean, crowded_ratio_mean';

type SectorDailyRaw = {
  sector: string;
  as_of_date: string;
  member_count: number;
  breadth_pct: number | null;
  sector_return_1w: number | null;
  sector_return_1m: number | null;
  sector_return_3m: number | null;
  sector_return_6m: number | null;
  sector_return_1y: number | null;
  rs_vs_market_1w: number | null;
  rs_vs_market_1m: number | null;
  rs_vs_market_3m: number | null;
  rs_vs_market_6m: number | null;
  rs_vs_market_1y: number | null;
  volume_efficiency_mean: number | null;
  crowded_ratio_mean: number | null;
};

function toSectorDailyRow(r: SectorDailyRaw): SectorDailyRow {
  const num = (v: number | null): number | null => (v == null ? null : Number(v));
  return {
    sector: r.sector,
    asOfDate: r.as_of_date,
    memberCount: Number(r.member_count),
    breadthPct: num(r.breadth_pct),
    sectorReturn1w: num(r.sector_return_1w),
    sectorReturn1m: num(r.sector_return_1m),
    sectorReturn3m: num(r.sector_return_3m),
    sectorReturn6m: num(r.sector_return_6m),
    sectorReturn1y: num(r.sector_return_1y),
    rsVsMarket1w: num(r.rs_vs_market_1w),
    rsVsMarket1m: num(r.rs_vs_market_1m),
    rsVsMarket3m: num(r.rs_vs_market_3m),
    rsVsMarket6m: num(r.rs_vs_market_6m),
    rsVsMarket1y: num(r.rs_vs_market_1y),
    volumeEfficiencyMean: num(r.volume_efficiency_mean),
    crowdedRatioMean: num(r.crowded_ratio_mean),
  };
}

/**
 * Latest snapshot of every sector (one row per sector, deduped by sector
 * key from the most-recent `as_of_date`). Sorted by `rs_vs_market_1m`
 * descending so the strongest sectors appear first.
 *
 * Implementation note: we don't know the latest `as_of_date` without
 * reading it, so we pull 200 rows ordered by date desc and dedupe
 * client-side. With ~7 sectors × 1 row/day, the cap is well above any
 * realistic growth pattern (a year of daily rows ≈ 2,555 — still under
 * the cap). Bump the limit if sector count grows.
 */
export async function getSectorStrengthLatest(): Promise<QueryResult<SectorDailyRow[]>> {
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_sector_daily')
        .select(SECTOR_DAILY_COLUMNS)
        .order('as_of_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      const seen = new Set<string>();
      const out: SectorDailyRow[] = [];
      for (const r of (data ?? []) as unknown as SectorDailyRaw[]) {
        if (seen.has(r.sector)) continue;
        seen.add(r.sector);
        out.push(toSectorDailyRow(r));
      }
      return out.sort((a, b) => (b.rsVsMarket1m ?? -Infinity) - (a.rsVsMarket1m ?? -Infinity));
    },
    () => getMockSectorDaily(null, 50),
  );
}

/**
 * Historical `ey_sector_daily` rows, optionally filtered by sector.
 * Returns rows in descending `as_of_date` order. Used by future by-sector
 * chart views — the dashboard leaderboard tile prefers
 * `getSectorStrengthLatest` instead.
 */
export async function getSectorDaily(
  opts: { limit?: number; sector?: string } = {},
): Promise<QueryResult<SectorDailyRow[]>> {
  const limit = opts.limit ?? 50;
  return withFallback(
    async (supabase) => {
      let q = supabase
        .from('ey_sector_daily')
        .select(SECTOR_DAILY_COLUMNS)
        .order('as_of_date', { ascending: false })
        .limit(limit);
      if (opts.sector) q = q.eq('sector', opts.sector);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown as SectorDailyRaw[]).map(toSectorDailyRow);
    },
    () => getMockSectorDaily(opts.sector ?? null, limit),
  );
}

/**
 * Constituents of one sector for the `/sectors/[sector]` detail page.
 * Joins `ey_stocks` (filtered by sector) with the most-recent
 * `ey_quote_snapshot` row and the latest `ey_stock_analytics.return_1m`
 * for each stock. Sorted by `return_1m` desc so the leader is on top.
 *
 * Implementation: one query per table — `ey_stocks` filters drive the
 * sector scope, then a single `in()` call to `ey_quote_snapshot` and a
 * single `in()` call to the analytics table. Three round-trips total.
 * For our scale (~30 stocks) this is fine; if the universe grows,
 * consider a SQL view that joins on the server.
 */
export async function getStocksBySector(
  sector: string,
): Promise<QueryResult<SectorMember[]>> {
  return withFallback(
    async (supabase) => {
      const { data: stockRows, error: stockErr } = await supabase
        .from('ey_stocks')
        .select('id, symbol, name, market, currency, sector')
        .eq('is_active', true)
        .eq('sector', sector);
      if (stockErr) throw stockErr;
      const stocks = (stockRows ?? []) as Array<{
        id: string;
        symbol: string;
        name: string;
        market: Market;
        currency: string;
        sector: string | null;
      }>;
      if (stocks.length === 0) return [];

      const stockIds = stocks.map((s) => s.id);

      const { data: quoteRows, error: quoteErr } = await supabase
        .from('ey_quote_snapshot')
        .select('stock_id, last_price, change, change_percent, as_of')
        .in('stock_id', stockIds);
      if (quoteErr) throw quoteErr;
      const quoteMap = new Map<string, {
        lastPrice: number;
        change: number;
        changePercent: number;
      }>();
      for (const q of (quoteRows ?? []) as Array<{
        stock_id: string;
        last_price: number;
        change: number;
        change_percent: number;
        as_of: string;
      }>) {
        quoteMap.set(q.stock_id, {
          lastPrice: Number(q.last_price),
          change: Number(q.change),
          changePercent: Number(q.change_percent),
        });
      }

      const { data: analyticsRows, error: analyticsErr } = await supabase
        .from('ey_stock_analytics')
        .select('stock_id, as_of_date, return_1m')
        .in('stock_id', stockIds)
        .order('as_of_date', { ascending: false });
      if (analyticsErr) throw analyticsErr;
      const returnMap = new Map<string, number | null>();
      for (const r of (analyticsRows ?? []) as Array<{
        stock_id: string;
        as_of_date: string;
        return_1m: number | null;
      }>) {
        // First row per stock_id is the latest — don't overwrite.
        if (returnMap.has(r.stock_id)) continue;
        returnMap.set(r.stock_id, r.return_1m == null ? null : Number(r.return_1m));
      }

      const num = (v: number | null): number | null =>
        v == null ? null : Number(v);
      const out: SectorMember[] = stocks.map((s) => {
        const q = quoteMap.get(s.id) ?? null;
        return {
          symbol: s.symbol,
          name: s.name,
          market: s.market,
          currency: s.currency,
          sector: s.sector,
          lastPrice: q ? q.lastPrice : null,
          changePercent: q ? q.changePercent : null,
          return1m: num(returnMap.get(s.id) ?? null),
        } satisfies SectorMember;
      });
      return out.sort(
        (a, b) => (b.return1m ?? -Infinity) - (a.return1m ?? -Infinity),
      );
    },
    () => getMockStocksBySector(sector),
  );
}

/** Trend classification from a desc-ordered list of bi-weekly short-interest
 *  settlements (most-recent first). Returns 'up' / 'down' / 'flat' when at
 *  least two settlements exist, otherwise null.
 *
 *  For the screener filter, callers compare this single-label trend to the
 *  requested direction ('up' / 'down'); the N-period test is applied at
 *  filter time via `matchesShortInterestTrend`. */
function computeShortInterestTrend(settlements: number[]): ScreenerRow['shortInterestTrend'] {
  if (settlements.length < 2) return null;
  const [latest, prev] = settlements;
  if (latest == null || prev == null) return null;
  if (latest > prev) return 'up';
  if (latest < prev) return 'down';
  return 'flat';
}

/** True when the latest N consecutive period-over-period comparisons all
 *  move in `direction`. One period = one settlement gap (≈ 2 weeks). */
function matchesShortInterestTrend(
  settlements: number[],
  filter: ShortInterestTrendFilter,
): boolean {
  const { direction, periods } = filter;
  if (settlements.length < periods + 1) return false;
  for (let i = 0; i < periods; i++) {
    const a = settlements[i];
    const b = settlements[i + 1];
    if (a == null || b == null) return false;
    if (direction === 'up' && !(a > b)) return false;
    if (direction === 'down' && !(a < b)) return false;
  }
  return true;
}

/** Null-safe filtering — null values pass when no constraint is specified.
 *  `interestBySymbol` carries the per-stock settlement history used by the
 *  short-interest trend filter (kept off the ScreenerRow type so the UI never
 *  sees it). */
function applyScreenerFilters(
  rows: ScreenerRow[],
  f: ScreenerFilters,
  interestBySymbol: Map<string, number[]> = new Map(),
): ScreenerRow[] {
  return rows.filter((r) => {
    if (f.market && r.market !== f.market) return false;
    if (f.sector && r.sector !== f.sector) return false;
    if (f.marketCapMin != null && (r.marketCap == null || r.marketCap < f.marketCapMin)) return false;
    if (f.peMax != null && (r.peRatio == null || r.peRatio > f.peMax)) return false;
    if (f.yieldMin != null && (r.dividendYield == null || r.dividendYield < f.yieldMin)) return false;
    if (f.return1mMin != null && (r.return1m == null || r.return1m < f.return1mMin)) return false;
    // Return upper bounds — nulls excluded (no synthetic zero to compare).
    if (f.return1mMax != null && (r.return1m == null || r.return1m > f.return1mMax)) return false;
    if (f.return3mMax != null && (r.return3m == null || r.return3m > f.return3mMax)) return false;
    if (f.return6mMax != null && (r.return6m == null || r.return6m > f.return6mMax)) return false;
    // 30d-drawdown upper bound: `drawdown30d` is a negative fraction, so the
    // threshold is also negative (`−0.10` = "at least 10% off 30d peak").
    // Nulls are excluded (no synthetic zero to compare).
    if (
      f.drawdown30dMax != null &&
      (r.drawdown30d == null || r.drawdown30d > f.drawdown30dMax)
    ) {
      return false;
    }
    if (
      f.volumeEfficiencyMin != null &&
      (r.volumeEfficiencyToday == null || r.volumeEfficiencyToday < f.volumeEfficiencyMin)
    ) {
      return false;
    }
    if (
      f.crowdedRatioMin != null &&
      (r.crowdedRatio == null || r.crowdedRatio < f.crowdedRatioMin)
    ) {
      return false;
    }
    if (
      f.crowdedRatioMax != null &&
      (r.crowdedRatio == null || r.crowdedRatio >= f.crowdedRatioMax)
    ) {
      return false;
    }
    // MA trend filters — slope > 0 means "up", ≤ 0 means "down".
    // Slope is null on the first row of the analytics series, so a row
    // with `r.ma5Slope == null` cannot match either 'up' or 'down' and
    // the row falls out when the filter is set.
    if (f.ma5Trend === 'up' && (r.ma5Slope == null || r.ma5Slope <= 0)) return false;
    if (f.ma5Trend === 'down' && (r.ma5Slope == null || r.ma5Slope >= 0)) return false;
    if (f.ma20Trend === 'up' && (r.ma20Slope == null || r.ma20Slope <= 0)) return false;
    if (f.ma20Trend === 'down' && (r.ma20Slope == null || r.ma20Slope >= 0)) return false;
    if (f.greenShareThreshold != null) {
      // Single signed threshold: positive → `share > threshold` (in green),
      // negative → `share < threshold` (in red). The persisted share is
      // also signed (positive = green dominant, negative = red dominant),
      // so the comparison can't misclassify a row across the 0 boundary.
      const share = r.greenRedVolumeShare1m;
      if (share == null) return false;
      if (f.greenShareThreshold > 0 && share <= f.greenShareThreshold) return false;
      if (f.greenShareThreshold < 0 && share >= f.greenShareThreshold) return false;
    }
    if (f.shortInterestTrend && !matchesShortInterestTrend(
      interestBySymbol.get(r.symbol) ?? [],
      f.shortInterestTrend,
    )) {
      return false;
    }
    // Squeeze-score lower bound — nulls are excluded (no synthetic zero
    // to filter against, same convention as `crowdedRatioMin`).
    if (
      f.squeezeMin != null &&
      (r.squeezeScore == null || r.squeezeScore < f.squeezeMin)
    ) {
      return false;
    }
    return true;
  });
}

/** Null-safe sort — nulls always sink to the bottom regardless of dir. */
function applyScreenerSort(rows: ScreenerRow[], s: ScreenerSort): ScreenerRow[] {
  const dir = s.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[s.column];
    const bv = b[s.column];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}

// ============================================================================
// Phase 5 — Short Selling (FINRA for US, HKEX daily + AM session for HK).
// The same payload shape serves both markets; HK stocks add the AM session
// KPIs + per-bar AM fields. The chart branches on `market` to render the
// appropriate layout.
// ============================================================================

/**
 * Short-selling payload: daily turnover + bi-weekly short interest.
 * Joins `ey_short_sale_1d` and `ey_short_interest` against the stock id, then
 * computes `daysToCover` locally from the last 30 days of `ey_price_1d`
 * volume (we don't trust FINRA's own days-to-cover column).
 *
 * Works for both US (FINRA `regShoDaily` + `consolidatedShortInterest`)
 * and HK (HKEX daily + HKEX morning-session + SFC weekly). `total_volume` is
 * 0 for HK daily rows so `shortPctOfVolume` is `null` on HK — the pill row
 * degrades to "—" gracefully and the chart renders absolute volume bars
 * instead. The HK AM fields (`am_short_volume`, `am_short_value_hkd`) are
 * populated by `sync_hkex_short_sales_combined` around 12:30 HKT.
 */
export async function getShortSelling(
  symbol: string,
  opts: { days?: number } = {},
): Promise<QueryResult<ShortSelling | null>> {
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

      const stockId = stockRow.id;

      // Three parallel reads: daily sale (full-day + AM) + bi-weekly interest
      // + 30d volume for days-to-cover.
      const [saleRes, interestRes, volumeRes] = await Promise.all([
        supabase
          .from('ey_short_sale_1d')
          .select(
            'trade_date, short_volume, total_volume, ' +
              'am_short_volume, am_short_value_hkd',
          )
          .eq('stock_id', stockId)
          .order('trade_date', { ascending: false })
          .limit(days),
        supabase
          .from('ey_short_interest')
          .select('settlement_date, short_interest, prior_short_interest, change_pct')
          .eq('stock_id', stockId)
          .order('settlement_date', { ascending: false })
          .limit(8),
        supabase
          .from('ey_price_1d')
          .select('trade_date, volume')
          .eq('stock_id', stockId)
          .order('trade_date', { ascending: false })
          .limit(30),
      ]);
      if (saleRes.error) throw saleRes.error;
      if (interestRes.error) throw interestRes.error;
      if (volumeRes.error) throw volumeRes.error;

      const num = (v: unknown): number | null =>
        v == null ? null : Number(v);

      const saleRaw = ((saleRes.data ?? []) as unknown) as Array<{
        trade_date: string;
        short_volume: number;
        total_volume: number;
        am_short_volume: number | null;
        am_short_value_hkd: number | null;
      }>;
      const interestRaw = (interestRes.data ?? []) as Array<{
        settlement_date: string;
        short_interest: number;
        prior_short_interest: number | null;
        change_pct: number | null;
      }>;
      const volumeRaw = (volumeRes.data ?? []) as Array<{
        trade_date: string;
        volume: number;
      }>;

      // Avg daily volume over last 30 trading days — used to compute
      // days-to-cover locally. Guard against a degenerate 0-volume mean.
      const avgDailyVolume30d = (() => {
        if (volumeRaw.length === 0) return null;
        const sum = volumeRaw.reduce((s, r) => s + Number(r.volume), 0);
        return sum / volumeRaw.length;
      })();

      // Daily series (ascending for chart).
      const sale: ShortSellingPoint[] = saleRaw
        .map((r) => {
          const total = Number(r.total_volume);
          const short = Number(r.short_volume);
          return {
            date: r.trade_date,
            shortVolume: short,
            totalVolume: total,
            shortPctOfVolume: total > 0 ? +((short / total) * 100).toFixed(2) : null,
            amShortVolume: num(r.am_short_volume),
            amShortValueHkd: num(r.am_short_value_hkd),
          };
        })
        .reverse();

      // Bi-weekly series (ascending). `changePct` is stored directly by the
      // worker; `daysToCover` is computed here so we don't trust the FINRA
      // file's column.
      const interest: ShortInterestPoint[] = interestRaw
        .map((r) => {
          const si = Number(r.short_interest);
          return {
            date: r.settlement_date,
            shortInterest: si,
            changePct: num(r.change_pct),
            daysToCover:
              avgDailyVolume30d != null && avgDailyVolume30d > 0
                ? +(si / avgDailyVolume30d).toFixed(2)
                : null,
          };
        })
        .reverse();

      const latestSale = sale[sale.length - 1];
      const latestInterest = interest[interest.length - 1];
      const asOfDate =
        latestSale?.date ?? latestInterest?.date ?? null;

      // HK-only AM headlines. Only meaningful when latest day has full-day
      // data; before full-day is published, full volume is 0 (placeholder)
      // and the ratio would be undefined.
      const todayFullVol = latestSale?.shortVolume ?? null;
      const todayAmVol = latestSale?.amShortVolume ?? null;
      const todayAmHkd = latestSale?.amShortValueHkd ?? null;
      const todayAmPct =
        todayAmVol != null && todayFullVol != null && todayFullVol > 0
          ? +((todayAmVol / todayFullVol) * 100).toFixed(1)
          : null;

      return {
        symbol: stockRow.symbol,
        market: stockRow.market as Market,
        todayShortPctOfVolume: latestSale?.shortPctOfVolume ?? null,
        todayShortVolume: todayFullVol,
        todayAmShortVolume: todayAmVol,
        todayAmShortValueHkd: todayAmHkd,
        todayAmPctOfFullDay: todayAmPct,
        shortInterest: latestInterest?.shortInterest ?? null,
        shortInterestChangePct: latestInterest?.changePct ?? null,
        daysToCover: latestInterest?.daysToCover ?? null,
        asOfDate,
        series: { sale, interest },
      } satisfies ShortSelling;
    },
    () => getMockShortSelling(normalized),
  );
}

// ============================================================================
// Phase 5 — Short Squeeze (per-stock 0..100 composite score).
// Reads the latest `ey_stock_analytics` row's 6 squeeze columns populated by
// `sync-squeeze` (see docs/SQUEEZE.md). `score == null` means every
// component was null at compute time — the UI renders an "unavailable"
// state instead of a misleading 0. `regime` is derived from `score` here
// (deterministic), so the worker doesn't have to store it.
// ============================================================================

export async function getSqueeze(
  symbol: string,
): Promise<QueryResult<SqueezeScore | null>> {
  const normalized = symbol.toUpperCase();
  return withFallback<SqueezeScore | null>(
    async (supabase) => {
      const stockRes = await supabase
        .from('ey_stocks')
        .select('id, market')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockRes.error) throw stockRes.error;
      if (!stockRes.data) return null;
      const stockRow = stockRes.data;

      const { data: analyticsRow, error: analyticsErr } = await supabase
        .from('ey_stock_analytics')
        .select(
          'as_of_date, squeeze_score, squeeze_dtc, squeeze_si_chg_1w, ' +
            'squeeze_drawdown_30d, squeeze_volume_spike, squeeze_am_ratio',
        )
        .eq('stock_id', stockRow.id)
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (analyticsErr) throw analyticsErr;
      if (!analyticsRow) return null;
      const r = analyticsRow as unknown as {
        as_of_date: string | null;
        squeeze_score: number | string | null;
        squeeze_dtc: number | string | null;
        squeeze_si_chg_1w: number | string | null;
        squeeze_drawdown_30d: number | string | null;
        squeeze_volume_spike: number | string | null;
        squeeze_am_ratio: number | string | null;
      };
      const num = (v: unknown): number | null => (v == null ? null : Number(v));

      const score = num(r.squeeze_score);
      const regime = score == null
        ? null
        : score >= 70
          ? 'high'
          : score >= 50
            ? 'elevated'
            : score >= 30
              ? 'normal'
              : 'low';

      return {
        symbol: normalized,
        market: stockRow.market as Market,
        score,
        regime,
        daysToCover: num(r.squeeze_dtc),
        siChangePct1w: num(r.squeeze_si_chg_1w),
        drawdown30d: num(r.squeeze_drawdown_30d),
        volumeSpike: num(r.squeeze_volume_spike),
        amRatio: num(r.squeeze_am_ratio),
        asOfDate: r.as_of_date ?? null,
      } satisfies SqueezeScore;
    },
    () => getMockSqueeze(normalized),
  );
}

// ============================================================================
// Phase 7 + 8 — News (public read of admin-approved rows).
//
// RLS already filters `ey_news_stock_mapping` and `ey_stock_relationship`
// to `status='approved'` for anon / authenticated, so we just select
// whatever the cookie-authenticated anon key can see. Mock fallback returns
// a hand-curated set so the page is browseable without Supabase.
// ============================================================================

// Select clause for approved mappings — joins article + stock so the page
// can render "title — symbol" without a second round-trip.
const NEWS_MAPPING_SELECT_PUBLIC =
  'id, article_id, stock_id, sentiment, impact_direction, impact_severity, ' +
  'confidence, rationale, status, approved_at, created_at, ' +
  'ey_news_article!ey_news_stock_mapping_article_id_fkey(' +
  '  id, source_url, source_name, title, summary, published_at, fetched_at' +
  '), ' +
  'ey_stocks!ey_news_stock_mapping_stock_id_fkey(id, symbol, market, name)';

const NEWS_RELATIONSHIP_SELECT_PUBLIC =
  'id, source_stock_id, target_stock_id, relationship_type, confidence, ' +
  'rationale, status, approved_at, created_at, ' +
  'src:ey_stocks!ey_stock_relationship_source_stock_id_fkey(id, symbol, market, name), ' +
  'tgt:ey_stocks!ey_stock_relationship_target_stock_id_fkey(id, symbol, market, name)';

function mapPublicMappingRow(r: any): NewsStockMappingDto {
  return {
    id: r.id,
    articleId: r.article_id,
    stockId: r.stock_id,
    sentiment: r.sentiment as Sentiment | null,
    impactDirection: r.impact_direction as ImpactDirection | null,
    impactSeverity: r.impact_severity as ImpactSeverity | null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    rationale: r.rationale,
    status: r.status as MappingStatus,
    approvedBy: null, // public client doesn't need this
    approvedAt: r.approved_at,
    reviewerNotes: null,
    createdAt: r.created_at,
    source: 'public',
    article: {
      id: r.ey_news_article.id,
      sourceUrl: r.ey_news_article.source_url,
      sourceName: r.ey_news_article.source_name,
      title: r.ey_news_article.title,
      summary: r.ey_news_article.summary,
      publishedAt: r.ey_news_article.published_at,
      fetchedAt: r.ey_news_article.fetched_at,
      language: 'en',
    },
    stock: {
      id: r.ey_stocks.id,
      symbol: r.ey_stocks.symbol,
      market: r.ey_stocks.market,
      name: r.ey_stocks.name,
    },
  };
}

function mapPublicRelationshipRow(r: any): StockRelationshipDto {
  return {
    id: r.id,
    sourceStockId: r.source_stock_id,
    targetStockId: r.target_stock_id,
    relationshipType: r.relationship_type as RelationshipType,
    confidence: r.confidence == null ? null : Number(r.confidence),
    rationale: r.rationale,
    evidenceNewsId: null,
    status: r.status as MappingStatus,
    approvedBy: null,
    approvedAt: r.approved_at,
    reviewerNotes: null,
    createdAt: r.created_at,
    // Omit row `source` (provenance) — DTO uses `source` for joined ref.
    source: {
      id: r.src.id,
      symbol: r.src.symbol,
      market: r.src.market,
      name: r.src.name,
    },
    target: {
      id: r.tgt.id,
      symbol: r.tgt.symbol,
      market: r.tgt.market,
      name: r.tgt.name,
    },
  };
}

/**
 * Recent approved article↔stock mappings for the global /news page.
 * RLS hides pending/rejected — anon can only see `status='approved'`.
 * Sorted newest-approved first so the page mirrors admin activity.
 */
export async function getRecentNewsMappings(
  opts: { limit?: number } = {},
): Promise<QueryResult<NewsStockMappingDto[]>> {
  const limit = opts.limit ?? 50;
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_news_stock_mapping')
        .select(NEWS_MAPPING_SELECT_PUBLIC)
        .order('approved_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapPublicMappingRow);
    },
    () => getAllMockNewsMappings(limit),
  );
}

/**
 * Approved mappings for one stock — used by the News tab on the stock
 * detail page. RLS-filters automatically to `status='approved'`.
 */
export async function getNewsMappingsForStock(
  symbol: string,
  opts: { limit?: number } = {},
): Promise<QueryResult<NewsStockMappingDto[]>> {
  const normalized = symbol.toUpperCase();
  const limit = opts.limit ?? 30;
  return withFallback(
    async (supabase) => {
      const stockRes = await supabase
        .from('ey_stocks')
        .select('id')
        .eq('symbol', normalized)
        .maybeSingle();
      if (stockRes.error) throw stockRes.error;
      if (!stockRes.data) return [];
      const { data, error } = await supabase
        .from('ey_news_stock_mapping')
        .select(NEWS_MAPPING_SELECT_PUBLIC)
        .eq('stock_id', stockRes.data.id)
        .order('approved_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapPublicMappingRow);
    },
    () => getMockNewsMappingsForStock(normalized, limit),
  );
}

/**
 * Recent approved stock↔stock edges for the global /news page's
 * "Knowledge graph" section.
 */
export async function getRecentKnowledgeGraph(
  opts: { limit?: number } = {},
): Promise<QueryResult<StockRelationshipDto[]>> {
  const limit = opts.limit ?? 30;
  return withFallback(
    async (supabase) => {
      const { data, error } = await supabase
        .from('ey_stock_relationship')
        .select(NEWS_RELATIONSHIP_SELECT_PUBLIC)
        .order('approved_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapPublicRelationshipRow);
    },
    () => getAllMockRelationships(limit),
  );
}
