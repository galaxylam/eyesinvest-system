/**
 * Reproduce the app's server-side screener query outside Next.js so the
 * failure mode can be seen (the Vercel function swallows it into the
 * "demo data" banner).
 *
 * Mirrors `apps/web/src/lib/stocks/queries.ts :: getScreenerRows`:
 *   ey_stocks → then 4 query groups × 7 chunks of 80 ids, in parallel.
 *
 *   node scripts/backtest/repro_screener_query.mjs [concurrency]
 */

import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const CHUNK_SIZE = 80;

async function one(label) {
  const t0 = Date.now();
  try {
    const { data: stocks, error: stocksErr } = await supabase
      .from('ey_stocks')
      .select('id, symbol, name, market, currency, sector, market_cap, pe_ratio, dividend_yield')
      .eq('is_active', true)
      .order('symbol', { ascending: true });
    if (stocksErr) throw stocksErr;
    const ids = (stocks ?? []).map((s) => s.id);
    const idChunks = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) idChunks.push(ids.slice(i, i + CHUNK_SIZE));

    // New: window the analytics query to the most recent N days.
    const ANALYTICS_WINDOW_DAYS = 14;
    const { data: latestRows } = await supabase
      .from('ey_stock_analytics')
      .select('as_of_date')
      .order('as_of_date', { ascending: false })
      .limit(1);
    const latestDate = latestRows?.[0]?.as_of_date ?? null;
    const windowStart = latestDate
      ? new Date(new Date(`${latestDate}T00:00:00Z`).getTime() - ANALYTICS_WINDOW_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;

    const [quotesArr, analyticsArr, interestArr, pricesArr] = await Promise.all([
      Promise.all(
        idChunks.map((c) =>
          supabase.from('ey_quote_snapshot').select('stock_id, last_price, change, change_percent, volume').in('stock_id', c),
        ),
      ),
      Promise.all(
        idChunks.map((c) => {
          let q = supabase
            .from('ey_stock_analytics')
            .select(
              'stock_id, as_of_date, return_1m, return_3m, return_6m, return_1y, ' +
                'volume_efficiency, crowded_ratio, max_drawdown_30d, max_drawdown_60d, ma5_slope, ma20_slope, ' +
                'green_red_volume_ratio_1m, green_red_volume_share_1m, green_red_impact_ease_1m, squeeze_score',
            )
            .in('stock_id', c);
          if (windowStart) q = q.gte('as_of_date', windowStart);
          return q.order('as_of_date', { ascending: false });
        }),
      ),
      Promise.all(
        idChunks.map((c) =>
          supabase
            .from('ey_short_interest')
            .select('stock_id, settlement_date, short_interest')
            .in('stock_id', c)
            .order('settlement_date', { ascending: false })
            .limit(c.length * 5),
        ),
      ),
      Promise.all(
        idChunks.map((c) =>
          supabase
            .from('ey_price_1d')
            .select('stock_id, trade_date, close, volume')
            .in('stock_id', c)
            .order('trade_date', { ascending: false })
            .limit(c.length * 20),
        ),
      ),
    ]);

    const errs = [
      ...quotesArr.map((r) => r.error),
      ...analyticsArr.map((r) => r.error),
      ...interestArr.map((r) => r.error),
      ...pricesArr.map((r) => r.error),
    ].filter(Boolean);
    if (errs.length) throw errs[0];

    const rows =
      quotesArr.reduce((a, r) => a + (r.data?.length ?? 0), 0) +
      analyticsArr.reduce((a, r) => a + (r.data?.length ?? 0), 0) +
      interestArr.reduce((a, r) => a + (r.data?.length ?? 0), 0) +
      pricesArr.reduce((a, r) => a + (r.data?.length ?? 0), 0);
    return `${label} OK ${((Date.now() - t0) / 1000).toFixed(1)}s rows=${rows}`;
  } catch (e) {
    const msg = e?.message ?? String(e);
    const code = e?.code ?? e?.status ?? '';
    const cause = e?.cause ? ` | cause: ${e.cause.code ?? ''} ${e.cause.message ?? ''}` : '';
    return `${label} FAIL ${((Date.now() - t0) / 1000).toFixed(1)}s ${code} ${msg}${cause}`;
  }
}

const conc = Number(process.argv[2] ?? 8);
console.log(`concurrency=${conc}`);
const res = await Promise.all(Array.from({ length: conc }, (_, i) => one(`#${i + 1}`)));
for (const r of res) console.log(r);
console.log(`failures: ${res.filter((r) => r.includes('FAIL')).length}/${res.length}`);
