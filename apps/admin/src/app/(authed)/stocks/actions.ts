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
