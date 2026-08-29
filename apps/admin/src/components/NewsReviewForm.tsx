'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Input, Label } from '@eyesinvest/ui';
import type {
  ImpactDirection,
  ImpactSeverity,
  NewsStockMappingDto,
  Sentiment,
} from '@eyesinvest/types';
import {
  reviewNewsMappingAction,
  skipNewsMappingAction,
  type NewsReviewInput,
} from '@/app/(authed)/news/actions';

const SENTIMENTS: Sentiment[] = ['bullish', 'bearish', 'neutral'];
const DIRECTIONS: ImpactDirection[] = ['positive', 'negative', 'mixed', 'none'];
const SEVERITIES: ImpactSeverity[] = ['low', 'medium', 'high', 'critical'];

interface NewsReviewFormProps {
  initial: NewsStockMappingDto;
}

export function NewsReviewForm({ initial }: NewsReviewFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [sentiment, setSentiment] = useState<Sentiment | ''>(
    (initial.sentiment ?? '') as Sentiment | '',
  );
  const [impactDirection, setImpactDirection] = useState<ImpactDirection | ''>(
    (initial.impactDirection ?? '') as ImpactDirection | '',
  );
  const [impactSeverity, setImpactSeverity] = useState<ImpactSeverity | ''>(
    (initial.impactSeverity ?? '') as ImpactSeverity | '',
  );
  const [confidencePct, setConfidencePct] = useState<string>(
    initial.confidence != null ? String(Math.round(initial.confidence * 100)) : '',
  );
  const [rationale, setRationale] = useState<string>(initial.rationale ?? '');
  const [reviewerNotes, setReviewerNotes] = useState<string>(initial.reviewerNotes ?? '');

  function buildInput(status: 'approved' | 'rejected'): NewsReviewInput {
    const confidenceNum = confidencePct === '' ? undefined : Number(confidencePct) / 100;
    return {
      id: initial.id,
      status,
      reviewerNotes: reviewerNotes || null,
      sentiment: sentiment || undefined,
      impactDirection: impactDirection || undefined,
      impactSeverity: impactSeverity || undefined,
      confidence:
        confidenceNum != null && !Number.isNaN(confidenceNum) ? confidenceNum : undefined,
      rationale: rationale || null,
    };
  }

  function submit(status: 'approved' | 'rejected') {
    setError(null);
    startTransition(async () => {
      const result = await reviewNewsMappingAction(buildInput(status));
      if (!result.ok) {
        setError(result.error ?? 'Save failed');
        return;
      }
      router.push('/news');
      router.refresh();
    });
  }

  function skip() {
    if (!confirm('Skip (delete) this mapping? The LLM suggestion will be discarded.')) return;
    setError(null);
    startTransition(async () => {
      const result = await skipNewsMappingAction({ id: initial.id });
      if (!result.ok) {
        setError(result.error ?? 'Skip failed');
        return;
      }
      router.push('/news');
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
      }}
      className="space-y-5"
    >
      {error && (
        <p className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="sentiment"
          label="Sentiment"
          value={sentiment}
          options={SENTIMENTS}
          onChange={(v) => setSentiment(v as Sentiment | '')}
        />
        <SelectField
          id="impactDirection"
          label="Impact direction"
          value={impactDirection}
          options={DIRECTIONS}
          onChange={(v) => setImpactDirection(v as ImpactDirection | '')}
        />
        <SelectField
          id="impactSeverity"
          label="Impact severity"
          value={impactSeverity}
          options={SEVERITIES}
          onChange={(v) => setImpactSeverity(v as ImpactSeverity | '')}
        />
        <div className="space-y-1.5">
          <Label htmlFor="confidence">Confidence (%)</Label>
          <Input
            id="confidence"
            name="confidence"
            type="number"
            min={0}
            max={100}
            step={1}
            value={confidencePct}
            onChange={(e) => setConfidencePct(e.target.value)}
            placeholder="0..100"
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
        <Button type="button" variant="ghost" onClick={() => router.push('/news')}>
          Back to queue
        </Button>
      </div>

      {initial.status !== 'pending' && (
        <p className="rounded-md border border-border bg-bg-muted px-3 py-2 text-xs text-fg-muted">
          This mapping was previously set to{' '}
          <Badge variant={initial.status === 'approved' ? 'positive' : 'negative'}>
            {initial.status}
          </Badge>{' '}
          on {initial.approvedAt ?? 'unknown'}.
        </p>
      )}
    </form>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}