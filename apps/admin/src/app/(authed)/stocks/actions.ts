'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createAdminClient, isSupabaseWritable } from '@/lib/supabase/admin';

const StockSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required').max(20),
  name: z.string().min(1, 'Company name is required').max(200),
  market: z.enum(['US', 'HK']),
  currency: z.string().min(2).max(6),
  exchange: z.string().max(40).optional().nullable(),
  sector: z.string().max(80).optional().nullable(),
  industry: z.string().max(120).optional().nullable(),
  isActive: z.boolean().default(true),
});

export type StockFormInput = z.infer<typeof StockSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/**
 * Create or update a stock. Server action called by the admin form.
 * Returns { ok:false, error } for validation failures so the form can
 * re-render with errors; on success returns { ok:true, id }.
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

  if (!isSupabaseWritable()) {
    console.warn('[saveStockAction] Supabase not configured — skipping write (dev only)');
    revalidatePath('/stocks');
    return { ok: true, id: 'mock-id' };
  }

  try {
    const supabase = createAdminClient();
    const { data: row, error } = await supabase
      .from('ey_stocks')
      .upsert(
        {
          symbol: data.symbol,
          name: data.name,
          market: data.market,
          currency: data.currency,
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
  /** Number of rows dropped due to validation errors. */
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

  // Validate + dedupe by (symbol, market). Last write wins.
  const errors: BulkImportError[] = [];
  const dedup = new Map<string, StockFormInput>();
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
    const key = `${data.symbol.toUpperCase()}|${data.market}`;
    dedup.set(key, data);
  });

  const validRows = Array.from(dedup.values());
  if (validRows.length === 0) {
    return { ok: errors.length === 0, upserted: 0, errors };
  }

  if (!isSupabaseWritable()) {
    console.warn(
      `[bulkImportStocksAction] Supabase not configured — skipping write of ${validRows.length} rows (dev only)`,
    );
    revalidatePath('/stocks');
    return { ok: errors.length === 0, upserted: validRows.length, errors };
  }

  try {
    const supabase = createAdminClient();
    const payload = validRows.map((data) => ({
      symbol: data.symbol,
      name: data.name,
      market: data.market,
      currency: data.currency,
      exchange: data.exchange ?? null,
      sector: data.sector ?? null,
      industry: data.industry ?? null,
      is_active: data.isActive,
    }));
    const { error } = await supabase
      .from('ey_stocks')
      .upsert(payload, { onConflict: 'symbol,market' });
    if (error) {
      return { ok: false, upserted: 0, errors, error: error.message };
    }
    revalidatePath('/stocks');
    return { ok: errors.length === 0, upserted: validRows.length, errors };
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
 */
export async function saveStockFormAction(formData: FormData) {
  const input: StockFormInput = {
    symbol: String(formData.get('symbol') ?? ''),
    name: String(formData.get('name') ?? ''),
    market: formData.get('market') === 'HK' ? 'HK' : 'US',
    currency: String(formData.get('currency') ?? 'USD'),
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
