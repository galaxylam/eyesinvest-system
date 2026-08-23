import 'server-only';
import { createAdminClient, isSupabaseWritable } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { getAllMockStocks, getMockStockDetail } from './mock-data';

export interface AdminStockRow {
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

/**
 * Admin-side stock list. Uses service-role when Supabase is configured;
 * falls back to the bundled mock list otherwise (so the admin app
 * works during local development without Supabase running).
 */
export async function listAdminStocks(): Promise<{
  rows: AdminStockRow[];
  source: 'supabase' | 'mock';
}> {
  if (!isSupabaseWritable()) {
    return { rows: mapMockRows(), source: 'mock' };
  }
  try {
    const supabase = await createServerSupabase();
    if (!supabase) return { rows: mapMockRows(), source: 'mock' };
    const { data, error } = await supabase
      .from('ey_stocks')
      .select('id, symbol, name, market, currency, exchange, sector, industry, is_active')
      .order('market', { ascending: true })
      .order('symbol', { ascending: true });
    if (error) throw error;
    return {
      rows: (data ?? []).map((r) => ({
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        market: r.market,
        currency: r.currency,
        exchange: r.exchange,
        sector: r.sector,
        industry: r.industry,
        isActive: r.is_active,
      })),
      source: 'supabase',
    };
  } catch (err) {
    console.error('[admin-queries] listAdminStocks fallback:', err);
    return { rows: mapMockRows(), source: 'mock' };
  }
}

export async function getAdminStock(id: string): Promise<AdminStockRow | null> {
  if (!isSupabaseWritable()) {
    return getMockStockDetail(parseSymbolFromId(id));
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('ey_stocks')
      .select('id, symbol, name, market, currency, exchange, sector, industry, is_active')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      symbol: data.symbol,
      name: data.name,
      market: data.market,
      currency: data.currency,
      exchange: data.exchange,
      sector: data.sector,
      industry: data.industry,
      isActive: data.is_active,
    };
  } catch (err) {
    console.error('[admin-queries] getAdminStock fallback:', err);
    return null;
  }
}

function mapMockRows(): AdminStockRow[] {
  return getAllMockStocks().map((s) => ({
    id: s.id,
    symbol: s.symbol,
    name: s.name,
    market: s.market,
    currency: s.currency,
    exchange: null,
    sector: s.sector,
    industry: s.industry,
    isActive: true,
  }));
}

function parseSymbolFromId(id: string): string {
  // Mock IDs are constructed as `${symbol}-${market}` — derive the symbol
  // back by stripping the trailing `-US` / `-HK`.
  const match = id.match(/^(.+)-(US|HK)$/);
  return match?.[1] ?? id;
}
