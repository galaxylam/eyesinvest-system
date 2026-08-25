'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createAdminClient, isSupabaseWritable } from '@/lib/supabase/admin';
import { detectMarketCurrency } from '@/lib/stocks/symbol';

const StockSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required').max(20),
  name: z.string().min(1, 'Company name is required').max(200),
  // Market and currency are derived from the symbol server-side — clients
  // may still send them for backwards compat, but the values are overwritten
  // by `detectMarketCurrency` below.
  market: z.enum(['US', 'HK']),
  currency: z.string().min(2).max(6),
  exchange: z.string().max(40).optional().nullable(),
  sector: z.string().max(80).optional().nullable(),
  industry: z.string().max(120).optional().nullable(),
  isActive: z.boolean().default(true),
});

export type StockFormInput = z.infer<typeof StockSchema> & {
  /** Set by the edit form so the uniqueness check can exclude the row being
   *  updated. Omitted for new-stock creation. */
  id?: string;
};

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/**
 * Return a set of `${symbol}|${market}` keys for rows that already exist.
 * Used by both single and bulk writes to short-circuit duplicates before
 * hitting the database. `excludeId` lets the edit path ignore its own row.
 */
async function findExistingConflicts(
  client: SupabaseClient,
  pairs: Array<{ symbol: string; market: string }>,
  excludeId?: string,
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const symbols = Array.from(new Set(pairs.map((p) => p.symbol)));
  const { data, error } = await client
    .from('ey_stocks')
    .select('id, symbol, market')
    .in('symbol', symbols);
  if (error) throw error;
  const conflicts = new Set<string>();
  for (const row of data ?? []) {
    if (excludeId && row.id === excludeId) continue;
    conflicts.add(`${row.symbol}|${row.market}`);
  }
  return conflicts;
}

/**
 * Create or update a stock. Server action called by the admin form.
 * Returns { ok:false, error } for validation or uniqueness failures so the
 * form can re-render with errors; on success returns { ok:true, id }.
 *
 * Uniqueness rule: (symbol, market) is the natural key. New stocks must not
 * collide with an existing row; edits must not collide with a DIFFERENT row
 * (so re-saving the same record still works). The check is a friendly
 * pre-flight — the DB unique constraint catches any race.
 *
 * If Supabase isn't configured, the action is a no-op success so the
 * UI can be developed without a backend.
 */
export async function saveStockAction(input: StockFormInput): Promise<ActionResult> {
  const parsed = StockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  // Server-side auto-detect — client hints are ignored so a malformed UI
  // can't write the wrong market for a given symbol.
  const detected = detectMarketCurrency(data.symbol);
  if (!detected) {
    return { ok: false, error: `Cannot determine market for symbol "${data.symbol}".` };
  }
  const market = detected.market;
  const currency = detected.currency;

  if (!isSupabaseWritable()) {
    console.warn('[saveStockAction] Supabase not configured — skipping write (dev only)');
    revalidatePath('/stocks');
    return { ok: true, id: 'mock-id' };
  }

  try {
    const supabase = createAdminClient();
    const conflicts = await findExistingConflicts(
      supabase,
      [{ symbol: data.symbol, market }],
      input.id,
    );
    if (conflicts.has(`${data.symbol}|${market}`)) {
      return {
        ok: false,
        error: input.id
          ? `Another stock already uses ${data.symbol} (${market}).`
          : `Stock ${data.symbol} already exists in ${market}.`,
      };
    }

    const { data: row, error } = await supabase
      .from('ey_stocks')
      .upsert(
        {
          symbol: data.symbol,
          name: data.name,
          market,
          currency,
          exchange: data.exchange ?? null,
          sector: data.sector ?? null,
          industry: data.industry ?? null,
          is_active: data.isActive,
        },
        { onConflict: 'symbol,market' },
      )
      .select('id')
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath('/stocks');
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function deleteStockAction(id: string): Promise<ActionResult> {
  if (!isSupabaseWritable()) {
    console.warn('[deleteStockAction] Supabase not configured — skipping write (dev only)');
    revalidatePath('/stocks');
    return { ok: true };
  }
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('ey_stocks').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/stocks');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Per-row error returned by `bulkImportStocksAction`. Row numbers are 1-based
 *  and refer to the input array position (after dropping empty lines). */
export interface BulkImportError {
  row: number;
  symbol?: string;
  reason: string;
}

export interface BulkImportResult {
  ok: boolean;
  /** Number of rows successfully upserted (counted after dedupe). */
  upserted: number;
  /** Number of rows dropped due to validation errors or duplicates. */
  errors: BulkImportError[];
  /** Top-level error if the batch call itself failed. */
  error?: string;
}

const BATCH_LIMIT = 500;

/**
 * Upsert many stocks at once. Rows are validated individually so one bad row
 * doesn't sink the whole batch — the result reports both the upsert count and
 * per-row errors. Duplicates within the input (same symbol+market) keep the
 * LAST occurrence, matching typical spreadsheet-paste semantics.
 *
 * Uniqueness rule mirrors `saveStockAction`: any (symbol, market) that
 * already exists in the database is reported as an error and skipped — the
 * remaining rows are upserted.
 *
 * If Supabase isn't configured, this is a no-op success so the dev UI can
 * exercise the flow without a backend.
 */
export async function bulkImportStocksAction(
  rows: StockFormInput[],
): Promise<BulkImportResult> {
  if (rows.length > BATCH_LIMIT) {
    return {
      ok: false,
      upserted: 0,
      errors: [],
      error: `Too many rows (${rows.length}). Limit is ${BATCH_LIMIT} per import.`,
    };
  }

  // Phase 1: validate each row + auto-detect market/currency + dedupe within
  // the batch (last write wins).
  const errors: BulkImportError[] = [];
  const dedup = new Map<
    string,
    { row: StockFormInput; rowNumber: number; market: string; currency: string }
  >();
  rows.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const parsed = StockSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        symbol: typeof raw?.symbol === 'string' ? raw.symbol : undefined,
        reason: parsed.error.issues[0]?.message ?? 'Invalid input',
      });
      return;
    }
    const data = parsed.data;
    const detected = detectMarketCurrency(data.symbol);
    if (!detected) {
      errors.push({
        row: rowNumber,
        symbol: data.symbol,
        reason: `Cannot determine market for symbol "${data.symbol}".`,
      });
      return;
    }
    const key = `${data.symbol.toUpperCase()}|${detected.market}`;
    dedup.set(key, {
      row: data,
      rowNumber,
      market: detected.market,
      currency: detected.currency,
    });
  });

  const validEntries = Array.from(dedup.values());

  // Phase 2: short-circuit rows that already exist in the DB. If the lookup
  // fails (e.g. transient network error) we fall through to the upsert and
  // let the DB's unique constraint catch any actual duplicate.
  let rowsToUpsert = validEntries;
  if (isSupabaseWritable() && validEntries.length > 0) {
    try {
      const supabase = createAdminClient();
      const conflicts = await findExistingConflicts(
        supabase,
        validEntries.map((e) => ({ symbol: e.row.symbol, market: e.market })),
      );
      rowsToUpsert = [];
      for (const entry of validEntries) {
        const key = `${entry.row.symbol}|${entry.market}`;
        if (conflicts.has(key)) {
          errors.push({
            row: entry.rowNumber,
            symbol: entry.row.symbol,
            reason: `Duplicate of existing ${entry.row.symbol} (${entry.market})`,
          });
        } else {
          rowsToUpsert.push(entry);
        }
      }
    } catch (err) {
      console.warn('[bulkImportStocksAction] conflict check failed:', err);
    }
  }

  if (rowsToUpsert.length === 0) {
    return { ok: errors.length === 0, upserted: 0, errors };
  }

  if (!isSupabaseWritable()) {
    console.warn(
      `[bulkImportStocksAction] Supabase not configured — skipping write of ${rowsToUpsert.length} rows (dev only)`,
    );
    revalidatePath('/stocks');
    return { ok: errors.length === 0, upserted: rowsToUpsert.length, errors };
  }

  // Phase 3: batch upsert.
  try {
    const supabase = createAdminClient();
    const payload = rowsToUpsert.map((e) => ({
      symbol: e.row.symbol,
      name: e.row.name,
      market: e.market,
      currency: e.currency,
      exchange: e.row.exchange ?? null,
      sector: e.row.sector ?? null,
      industry: e.row.industry ?? null,
      is_active: e.row.isActive,
    }));
    const { error } = await supabase
      .from('ey_stocks')
      .upsert(payload, { onConflict: 'symbol,market' });
    if (error) {
      return { ok: false, upserted: 0, errors, error: error.message };
    }
    revalidatePath('/stocks');
    return { ok: errors.length === 0, upserted: rowsToUpsert.length, errors };
  } catch (err) {
    return {
      ok: false,
      upserted: 0,
      errors,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Form action variant used by the new/edit pages — redirects on success.
 * Market/currency are NOT read from formData; they're auto-detected from
 * the symbol by `saveStockAction`.
 */
export async function saveStockFormAction(formData: FormData) {
  const input: StockFormInput = {
    symbol: String(formData.get('symbol') ?? ''),
    name: String(formData.get('name') ?? ''),
    // Placeholders — overwritten by detectMarketCurrency in saveStockAction.
    market: 'US',
    currency: 'USD',
    exchange: formData.get('exchange') ? String(formData.get('exchange')) : null,
    sector: formData.get('sector') ? String(formData.get('sector')) : null,
    industry: formData.get('industry') ? String(formData.get('industry')) : null,
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  };
  const result = await saveStockAction(input);
  if (!result.ok) {
    // For form-action flows we redirect back with a query string error.
    redirect(`/stocks/new?error=${encodeURIComponent(result.error ?? 'Error')}`);
  }
  redirect('/stocks');
}
