import { NextResponse } from 'next/server';
import { getQuote, getStockDetail } from '@/lib/stocks/queries';

/**
 * Batch quote + detail fetch for the watchlist UI. Accepts a comma-separated
 * symbol list via `?symbols=A,B,C` (max 50) and returns a map keyed by
 * uppercase symbol:
 *
 *   { AAPL: { quote: Quote|null, detail: StockDetail|null } }
 *
 * Returning `null` for unknown symbols keeps the watchlist page idempotent —
 * a symbol dropped from `ey_stocks` since save-time simply renders as `—`
 * instead of failing the whole request.
 */

const MAX_SYMBOLS = 50;

export interface WatchlistRowResponse {
  quote: Awaited<ReturnType<typeof getQuote>>['data'];
  detail: Awaited<ReturnType<typeof getStockDetail>>['data'];
}

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('symbols') ?? '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);

  if (symbols.length === 0) {
    return NextResponse.json({});
  }
  if (symbols.length > MAX_SYMBOLS) {
    return NextResponse.json(
      { error: `Too many symbols (max ${MAX_SYMBOLS})` },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    symbols.map(async (sym): Promise<readonly [string, WatchlistRowResponse]> => {
      const [quoteRes, detailRes] = await Promise.all([getQuote(sym), getStockDetail(sym)]);
      return [sym, { quote: quoteRes.data, detail: detailRes.data }] as const;
    }),
  );

  return NextResponse.json(Object.fromEntries(results));
}