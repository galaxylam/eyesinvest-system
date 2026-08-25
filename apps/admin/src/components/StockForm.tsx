'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, cn } from '@eyesinvest/ui';
import type { StockFormInput } from '@/app/(authed)/stocks/actions';
import { saveStockAction } from '@/app/(authed)/stocks/actions';

interface StockFormProps {
  initial?: Partial<StockFormInput>;
  submitLabel?: string;
}

const DEFAULTS: StockFormInput = {
  symbol: '',
  name: '',
  market: 'US',
  currency: 'USD',
  exchange: '',
  sector: '',
  industry: '',
  isActive: true,
};

export function StockForm({ initial, submitLabel = 'Save stock' }: StockFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const values: StockFormInput = { ...DEFAULTS, ...initial };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const input: StockFormInput = {
      ...(initial?.id ? { id: initial.id } : {}),
      symbol: String(formData.get('symbol') ?? '').trim().toUpperCase(),
      name: String(formData.get('name') ?? '').trim(),
      market: formData.get('market') === 'HK' ? 'HK' : 'US',
      currency: String(formData.get('currency') ?? 'USD').trim().toUpperCase(),
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
        <Field id="symbol" label="Symbol" required defaultValue={values.symbol} placeholder="AAPL or 0700.HK" />
        <Field id="name" label="Company name" required defaultValue={values.name} />
        <SelectField id="market" label="Market" defaultValue={values.market} options={['US', 'HK']} />
        <Field id="currency" label="Currency" defaultValue={values.currency} placeholder="USD / HKD" />
        <Field id="exchange" label="Exchange" defaultValue={values.exchange ?? ''} placeholder="NASDAQ / HKEX" />
        <Field id="sector" label="Sector" defaultValue={values.sector ?? ''} placeholder="Technology" />
        <Field id="industry" label="Industry" defaultValue={values.industry ?? ''} placeholder="Semiconductors" />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={values.isActive}
          className="h-4 w-4 rounded border-border bg-bg-elevated text-accent focus:ring-accent"
        />
        <Label htmlFor="isActive" className="cursor-pointer">
          Active
        </Label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
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
  defaultValue,
  placeholder,
}: {
  id: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-negative">*</span>}
      </Label>
      <Input id={id} name={id} required={required} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}

function SelectField({
  id,
  label,
  defaultValue,
  options,
}: {
  id: string;
  label: string;
  defaultValue?: string;
  options: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        defaultValue={defaultValue}
        className={cn(
          'flex h-9 w-full rounded-md border border-border bg-bg-elevated px-3 py-1 text-sm text-fg shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        )}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
