'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Label } from '@eyesinvest/ui';
import type { RelationshipType, StockRelationshipDto } from '@eyesinvest/types';
import {
  reviewRelationshipAction,
  skipRelationshipAction,
} from '@/app/(authed)/relationships/actions';

const TYPES: RelationshipType[] = [
  'supplier',
  'competitor',
  'customer',
  'partner',
  'parent_subsidiary',
];

interface RelationshipReviewFormProps {
  initial: StockRelationshipDto;
}

export function RelationshipReviewForm({ initial }: RelationshipReviewFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [relationshipType, setRelationshipType] = useState<RelationshipType>(
    initial.relationshipType,
  );
  const [confidencePct, setConfidencePct] = useState<string>(
    initial.confidence != null ? String(Math.round(initial.confidence * 100)) : '',
  );
  const [rationale, setRationale] = useState<string>(initial.rationale ?? '');
  const [reviewerNotes, setReviewerNotes] = useState<string>(initial.reviewerNotes ?? '');

  function submit(status: 'approved' | 'rejected') {
    setError(null);
    const confidenceNum = confidencePct === '' ? undefined : Number(confidencePct) / 100;
    startTransition(async () => {
      const result = await reviewRelationshipAction({
        id: initial.id,
        status,
        reviewerNotes: reviewerNotes || null,
        relationshipType,
        confidence:
          confidenceNum != null && !Number.isNaN(confidenceNum) ? confidenceNum : undefined,
        rationale: rationale || null,
      });
      if (!result.ok) {
        setError(result.error ?? 'Save failed');
        return;
      }
      router.push('/relationships');
      router.refresh();
    });
  }

  function skip() {
    if (!confirm('Skip (delete) this edge? The AI suggestion will be discarded.')) return;
    setError(null);
    startTransition(async () => {
      const result = await skipRelationshipAction({ id: initial.id });
      if (!result.ok) {
        setError(result.error ?? 'Skip failed');
        return;
      }
      router.push('/relationships');
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="space-y-5"
    >
      {error && (
        <p className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="relationshipType">Relationship type</Label>
          <select
            id="relationshipType"
            name="relationshipType"
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confidence">Confidence (%)</Label>
          <input
            id="confidence"
            name="confidence"
            type="number"
            min={0}
            max={100}
            step={1}
            value={confidencePct}
            onChange={(e) => setConfidencePct(e.target.value)}
            placeholder="0..100"
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rationale">Rationale (AI / editor)</Label>
        <textarea
          id="rationale"
          name="rationale"
          rows={3}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg shadow-inner focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reviewerNotes">Reviewer notes</Label>
        <textarea
          id="reviewerNotes"
          name="reviewerNotes"
          rows={2}
          value={reviewerNotes}
          onChange={(e) => setReviewerNotes(e.target.value)}
          placeholder="Optional comment for the audit log."
          className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg shadow-inner focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => submit('approved')}>
          {pending ? 'Saving…' : 'Approve'}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit('rejected')}>
          Reject
        </Button>
        <Button type="button" variant="danger" disabled={pending} onClick={skip}>
          Skip (delete)
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/relationships')}>
          Back to queue
        </Button>
      </div>

      {initial.status !== 'pending' && (
        <p className="rounded-md border border-border bg-bg-muted px-3 py-2 text-xs text-fg-muted">
          Previously set to{' '}
          <Badge variant={initial.status === 'approved' ? 'positive' : 'negative'}>
            {initial.status}
          </Badge>{' '}
          on {initial.approvedAt ?? 'unknown'}.
        </p>
      )}
    </form>
  );
}