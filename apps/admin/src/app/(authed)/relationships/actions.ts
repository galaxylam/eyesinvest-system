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

const RelationshipTypeEnum = z.enum([
  'supplier',
  'competitor',
  'customer',
  'partner',
  'parent_subsidiary',
]);

const ReviewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  reviewerNotes: z.string().max(2000).optional().nullable(),
  relationshipType: RelationshipTypeEnum.optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().max(4000).optional().nullable(),
});
export type RelationshipReviewInput = z.infer<typeof ReviewSchema>;

const IdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

const SkipSchema = z.object({
  id: z.string().uuid(),
});

export async function reviewRelationshipAction(
  input: RelationshipReviewInput,
): Promise<ActionResult> {
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;
  if (!isSupabaseWritable()) {
    console.warn('[reviewRelationshipAction] Supabase not configured — no-op');
    revalidatePath('/relationships');
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
    if (data.relationshipType) update.relationship_type = data.relationshipType;
    if (data.confidence !== undefined) update.confidence = data.confidence;
    if (data.rationale !== undefined) update.rationale = data.rationale ?? null;

    const { error } = await supabase
      .from('ey_stock_relationship')
      .update(update)
      .eq('id', data.id);
    if (error) return { ok: false, error: error.message };

    revalidatePath('/relationships');
    revalidatePath(`/relationships/${data.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkReviewRelationshipsAction(input: {
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
    console.warn('[bulkReviewRelationshipsAction] Supabase not configured — no-op');
    revalidatePath('/relationships');
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
      .from('ey_stock_relationship')
      .update(update)
      .in('id', parsed.data.ids)
      .select('id');
    if (error) return { ok: false, error: error.message };
    revalidatePath('/relationships');
    return { ok: true, count: data?.length ?? parsed.data.ids.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function skipRelationshipAction(
  input: { id: string },
): Promise<ActionResult> {
  const parsed = SkipSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  if (!isSupabaseWritable()) {
    console.warn('[skipRelationshipAction] Supabase not configured — no-op');
    revalidatePath('/relationships');
    return { ok: true };
  }
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('ey_stock_relationship')
      .delete()
      .eq('id', parsed.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/relationships');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}