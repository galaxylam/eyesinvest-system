'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@eyesinvest/ui';
import { detectMarketCurrency } from '@/lib/stocks/symbol';
import type { StockFormInput } from '@/app/(authed)/stocks/actions';
import { saveStockAction } from '@/app/(authed)/stocks/actions';

interface StockFormProps {
  initial?: Partial<StockFormInput>;
  submitLabel?: string;
}

export function StockForm({ initial, submitLabel = 'Save stock' }: StockFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState((initial?.symbol ?? '').toUpperCase());
  const detected = detectMarketCurrency(symbol);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!symbol) {
      setError('Symbol is required.');
      return;
    }
    if (!detected) {
      setError(`Cannot determine market for "${symbol}". Only US and HK symbols are supported.`);
      return;
    }
    const formData = new FormData(e.currentTarget);
    const input: StockFormInput = {
      ...(initial?.id ? { id: initial.id } : {}),
      symbol,
      name: String(formData.get('name') ?? '').trim(),
      // Server re-detects and overwrites — we send placeholders so the
      // Zod schema passes; the canonical values come from the symbol.
      market: detected.market,
      currency: detected.currency,
      exchange: formData.get('exchange') ? String(formData.get('exchange')) : null,
      sector: formData.get('sector') ? String(formData.get('sector')) : null,
      industry: formData.get('industry') ? String(formData.get('industry')) : null,
      isActive: formData.get('isActive') === 'on',
    };

    startTransition(async () => {
      const result = await saveStockAction(input);
      if (!result.ok) {
        setError(result.error ?? 'Save failed');
        return;
      }
      router.push('/stocks');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && (
        <p className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="symbol">
            Symbol<span className="ml-1 text-negative">*</span>
          </Label>
          <Input
            id="symbol"
            name="symbol"
            required
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL or 0700.HK"
          />
          {detected ? (
            <p className="text-2xs text-fg-muted">
              → <span className="font-medium text-fg">{detected.market}</span> ·{' '}
              <span className="font-medium text-fg">{detected.currency}</span>{' '}
              <span className="text-fg-subtle">(auto-detected)</span>
            </p>
          ) : (
            <p className="text-2xs text-amber">
              No matching market — only US and HK symbols are supported.
            </p>
          )}
        </div>
        <Field id="name" label="Company name" required defaultValue={initial?.name ?? ''} />
        <Field
          id="exchange"
          label="Exchange"
          optional
          defaultValue={initial?.exchange ?? ''}
          placeholder="NASDAQ / HKEX (optional)"
        />
        <Field
          id="sector"
          label="Sector"
          optional
          defaultValue={initial?.sector ?? ''}
          placeholder="Technology (optional)"
        />
        <Field
          id="industry"
          label="Industry"
          optional
          defaultValue={initial?.industry ?? ''}
          placeholder="Semiconductors (optional)"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={initial?.isActive ?? true}
          className="h-4 w-4 rounded border-border bg-bg-elevated text-accent focus:ring-accent"
        />
        <Label htmlFor="isActive" className="cursor-pointer">
          Active
        </Label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !detected}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  required,
  optional,
  defaultValue,
  placeholder,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-negative">*</span>}
        {optional && <span className="ml-1 text-fg-subtle">(optional)</span>}
      </Label>
      <Input id={id} name={id} required={required} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}
