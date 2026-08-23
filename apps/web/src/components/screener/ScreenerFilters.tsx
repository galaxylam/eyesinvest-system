'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ScreenerFilters } from '@/lib/stocks/queries';

interface ScreenerFiltersProps {
  current: ScreenerFilters;
  /** Available sector values, derived from the data so the dropdown isn't hard-coded. */
  sectors: string[];
}

/**
 * Filter controls for /screener. Six `<select>` dropdowns + a Reset button.
 * On change, builds a new searchParams object and `router.replace`s the URL
 * with `scroll: false` so the table re-renders without losing scroll state.
 *
 * Default values (empty / all / etc.) are stripped from the URL so it stays
 * canonical — `/screener` rather than `/screener?market=&sector=&...`.
 */
export function ScreenerFilters({ current, sectors }: ScreenerFiltersProps) {
  const t = useTranslations('screener');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (next: ScreenerFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    // Always reset sort to the user's previous sort; changing filters shouldn't
    // flip the column they're viewing.
    if (next.market) params.set('market', next.market);
    else params.delete('market');
    if (next.sector) params.set('sector', next.sector);
    else params.delete('sector');
    if (next.marketCapMin != null) params.set('cap', String(next.marketCapMin));
    else params.delete('cap');
    if (next.peMax != null) params.set('pe', String(next.peMax));
    else params.delete('pe');
    if (next.yieldMin != null) params.set('yield', String(next.yieldMin));
    else params.delete('yield');
    if (next.return1mMin != null) params.set('ret1m', String(next.return1mMin));
    else params.delete('ret1m');

    const query = params.toString();
    startTransition(() => {
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
    });
  };

  const reset = () => {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  const hasAny =
    current.market != null ||
    current.sector != null ||
    current.marketCapMin != null ||
    current.peMax != null ||
    current.yieldMin != null ||
    current.return1mMin != null;

  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-bg-elevated p-3"
      data-pending={pending ? '' : undefined}
    >
      <SelectField
        label={t('filter.market')}
        value={current.market ?? ''}
        onChange={(v) => apply({ ...current, market: v === '' ? undefined : (v as 'US' | 'HK') })}
        options={[
          { value: '', label: t('filter.all') },
          { value: 'US', label: t('filter.us') },
          { value: 'HK', label: t('filter.hk') },
        ]}
      />
      <SelectField
        label={t('filter.sector')}
        value={current.sector ?? ''}
        onChange={(v) => apply({ ...current, sector: v === '' ? undefined : v })}
        options={[
          { value: '', label: t('filter.all') },
          ...sectors.map((s) => ({ value: s, label: s })),
        ]}
      />
      <SelectField
        label={t('filter.marketCap')}
        value={current.marketCapMin == null ? '' : String(current.marketCapMin)}
        onChange={(v) =>
          apply({ ...current, marketCapMin: v === '' ? undefined : Number(v) })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: '10000000000', label: t('filter.cap10b') },
          { value: '50000000000', label: t('filter.cap50b') },
          { value: '100000000000', label: t('filter.cap100b') },
          { value: '500000000000', label: t('filter.cap500b') },
        ]}
      />
      <SelectField
        label={t('filter.peMax')}
        value={current.peMax == null ? '' : String(current.peMax)}
        onChange={(v) =>
          apply({ ...current, peMax: v === '' ? undefined : Number(v) })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: '15', label: `≤ 15` },
          { value: '25', label: `≤ 25` },
          { value: '40', label: `≤ 40` },
          { value: '100', label: `≤ 100` },
        ]}
      />
      <SelectField
        label={t('filter.yield')}
        value={current.yieldMin == null ? '' : String(current.yieldMin)}
        onChange={(v) =>
          apply({ ...current, yieldMin: v === '' ? undefined : Number(v) })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: '0.01', label: `≥ 1%` },
          { value: '0.03', label: `≥ 3%` },
          { value: '0.05', label: `≥ 5%` },
        ]}
      />
      <SelectField
        label={t('filter.return1m')}
        value={current.return1mMin == null ? '' : String(current.return1mMin)}
        onChange={(v) =>
          apply({ ...current, return1mMin: v === '' ? undefined : Number(v) })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: '-20', label: `≥ −20%` },
          { value: '-10', label: `≥ −10%` },
          { value: '0', label: `≥ 0%` },
          { value: '10', label: `≥ 10%` },
        ]}
      />

      {hasAny && (
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="focus-ring rounded-md border border-border bg-bg-muted px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
        >
          {t('filter.reset')}
        </button>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-fg"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}