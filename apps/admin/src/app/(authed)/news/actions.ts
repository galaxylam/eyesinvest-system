'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, isSupabaseWritable } from '@/lib/supabase/admin';
import { EY_ADMIN_DEFAULT_USER } from '@/lib/env';

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

// ===== Schemas ===========================================================

const SentimentEnum = z.enum(['bullish', 'bearish', 'neutral']);
const ImpactDirectionEnum = z.enum(['positive', 'negative', 'mixed', 'none']);
const ImpactSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Schema for approve / reject. Optional fields let the admin edit the
 * AI's analysis inline before approving — e.g. soften a "high" severity
 * down to "medium" if they disagree.
 */
const ReviewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  reviewerNotes: z.string().max(2000).optional().nullable(),
  // Optional edits applied at approval time:
  sentiment: SentimentEnum.optional(),
  impactDirection: ImpactDirectionEnum.optional(),
  impactSeverity: ImpactSeverityEnum.optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().max(4000).optional().nullable(),
});
export type NewsReviewInput = z.infer<typeof ReviewSchema>;

const IdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

const SkipSchema = z.object({
  id: z.string().uuid(),
});

// ===== Approve / reject / edit-and-approve ===============================

export async function reviewNewsMappingAction(
  input: NewsReviewInput,
): Promise<ActionResult> {
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  if (!isSupabaseWritable()) {
    console.warn('[reviewNewsMappingAction] Supabase not configured — no-op');
    revalidatePath('/news');
    return { ok: true };
  }

  try {
    const supabase = createAdminClient();
    const update: Record<string, unknown> = {
      status: data.status,
      approved_by: EY_ADMIN_DEFAULT_USER,
      approved_at: new Date().toISOString(),
    };
    if (data.reviewerNotes !== undefined) {
      update.reviewer_notes = data.reviewerNotes ?? null;
    }
    if (data.sentiment) update.sentiment = data.sentiment;
    if (data.impactDirection) update.impact_direction = data.impactDirection;
    if (data.impactSeverity) update.impact_severity = data.impactSeverity;
    if (data.confidence !== undefined) update.confidence = data.confidence;
    if (data.rationale !== undefined) update.rationale = data.rationale ?? null;

    const { error } = await supabase
      .from('ey_news_stock_mapping')
      .update(update)
      .eq('id', data.id);
    if (error) return { ok: false, error: error.message };

    revalidatePath('/news');
    revalidatePath(`/news/${data.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ===== Bulk approve ======================================================

export async function bulkReviewNewsMappingsAction(input: {
  ids: string[];
  status: 'approved' | 'rejected';
  reviewerNotes?: string | null;
}): Promise<ActionResult & { count?: number }> {
  const parsed = IdsSchema.safeParse({ ids: input.ids });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  if (!['approved', 'rejected'].includes(input.status)) {
    return { ok: false, error: 'status must be approved or rejected' };
  }

  if (!isSupabaseWritable()) {
    console.warn('[bulkReviewNewsMappingsAction] Supabase not configured — no-op');
    revalidatePath('/news');
    return { ok: true, count: input.ids.length };
  }

  try {
    const supabase = createAdminClient();
    const update: Record<string, unknown> = {
      status: input.status,
      approved_by: EY_ADMIN_DEFAULT_USER,
      approved_at: new Date().toISOString(),
    };
    if (input.reviewerNotes !== undefined) {
      update.reviewer_notes = input.reviewerNotes ?? null;
    }
    const { error, data } = await supabase
      .from('ey_news_stock_mapping')
      .update(update)
      .in('id', parsed.data.ids)
      .select('id');
    if (error) return { ok: false, error: error.message };
    revalidatePath('/news');
    return { ok: true, count: data?.length ?? parsed.data.ids.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ===== Skip (hard delete) ================================================

export async function skipNewsMappingAction(
  input: { id: string },
): Promise<ActionResult> {
  const parsed = SkipSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  if (!isSupabaseWritable()) {
    console.warn('[skipNewsMappingAction] Supabase not configured — no-op');
    revalidatePath('/news');
    return { ok: true };
  }
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('ey_news_stock_mapping')
      .delete()
      .eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/news');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}