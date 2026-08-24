'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ScreenerFilters } from '@/lib/stocks/queries';

/** Serialise the four new combined filters into compact URL params.
 *  - ma5 / ma20: 'up' | 'down' (or undefined)
 *  - gs: '<direction><threshold>' — 'g0.55', 'r0.65', etc. (green-share)
 *  - sit: '<direction><periods>' — 'u2', 'd3', etc. */
function encodeMaTrend(v: 'up' | 'down' | undefined): string | undefined {
  return v;
}
function encodeGs(v: ScreenerFilters['greenShare']): string | undefined {
  if (!v) return undefined;
  return `${v.direction[0]}${v.threshold}`;
}
function encodeSit(v: ScreenerFilters['shortInterestTrend']): string | undefined {
  if (!v) return undefined;
  return `${v.direction[0]}${v.periods}`;
}

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
    if (next.volumeEfficiencyMin != null) params.set('eff', String(next.volumeEfficiencyMin));
    else params.delete('eff');
    if (next.crowdedRatioMin != null) params.set('crowd', String(next.crowdedRatioMin));
    else params.delete('crowd');
    if (next.crowdedRatioMax != null) params.set('crowdlt', String(next.crowdedRatioMax));
    else params.delete('crowdlt');
    if (next.squeezeMin != null) params.set('sq', String(next.squeezeMin));
    else params.delete('sq');
    const ma5 = encodeMaTrend(next.ma5Trend);
    if (ma5) params.set('ma5', ma5); else params.delete('ma5');
    const ma20 = encodeMaTrend(next.ma20Trend);
    if (ma20) params.set('ma20', ma20); else params.delete('ma20');
    const gs = encodeGs(next.greenShare);
    if (gs) params.set('gs', gs); else params.delete('gs');
    const sit = encodeSit(next.shortInterestTrend);
    if (sit) params.set('sit', sit); else params.delete('sit');

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
    current.return1mMin != null ||
    current.volumeEfficiencyMin != null ||
    current.crowdedRatioMin != null ||
    current.crowdedRatioMax != null ||
    current.squeezeMin != null ||
    current.ma5Trend != null ||
    current.ma20Trend != null ||
    current.greenShare != null ||
    current.shortInterestTrend != null;

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
      <SelectField
        label={t('filter.volumeEfficiency')}
        value={current.volumeEfficiencyMin == null ? '' : String(current.volumeEfficiencyMin)}
        onChange={(v) =>
          apply({ ...current, volumeEfficiencyMin: v === '' ? undefined : Number(v) })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: '0.25', label: t('filter.eff0_25') },
          { value: '0.5', label: t('filter.eff0_5') },
          { value: '1', label: t('filter.eff1') },
          { value: '2', label: t('filter.eff2') },
        ]}
      />
      <SelectField
        label={t('filter.crowdedRatio')}
        value={
          current.crowdedRatioMax != null
            ? `lt${current.crowdedRatioMax}`
            : current.crowdedRatioMin == null
              ? ''
              : String(current.crowdedRatioMin)
        }
        onChange={(v) => {
          if (v === '') {
            apply({ ...current, crowdedRatioMin: undefined, crowdedRatioMax: undefined });
            return;
          }
          if (v.startsWith('lt')) {
            // "< 1×" subdued bucket — exclusive upper bound.
            apply({
              ...current,
              crowdedRatioMin: undefined,
              crowdedRatioMax: Number(v.slice(2)),
            });
            return;
          }
          apply({ ...current, crowdedRatioMin: Number(v), crowdedRatioMax: undefined });
        }}
        options={[
          { value: '', label: t('filter.any') },
          { value: '1', label: t('filter.crowd1') },
          { value: '1.2', label: t('filter.crowd1_2') },
          { value: '1.5', label: t('filter.crowd1_5') },
          { value: '2', label: t('filter.crowd2') },
          { value: 'lt1', label: t('filter.crowdLT1') },
        ]}
      />
      <SelectField
        label={t('filter.squeezeScore')}
        value={current.squeezeMin == null ? '' : String(current.squeezeMin)}
        onChange={(v) =>
          apply({ ...current, squeezeMin: v === '' ? undefined : Number(v) })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: '40', label: t('filter.sq40') },
          { value: '60', label: t('filter.sq60') },
          { value: '80', label: t('filter.sq80') },
        ]}
      />
      <SelectField
        label={t('filter.ma5')}
        value={current.ma5Trend ?? ''}
        onChange={(v) =>
          apply({ ...current, ma5Trend: v === '' ? undefined : (v as 'up' | 'down') })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: 'up', label: t('filter.maUp') },
          { value: 'down', label: t('filter.maDown') },
        ]}
      />
      <SelectField
        label={t('filter.ma20')}
        value={current.ma20Trend ?? ''}
        onChange={(v) =>
          apply({ ...current, ma20Trend: v === '' ? undefined : (v as 'up' | 'down') })
        }
        options={[
          { value: '', label: t('filter.any') },
          { value: 'up', label: t('filter.maUp') },
          { value: 'down', label: t('filter.maDown') },
        ]}
      />
      <SelectField
        label={t('filter.greenShare')}
        value={current.greenShare ? `${current.greenShare.direction[0]}${current.greenShare.threshold}` : ''}
        onChange={(v) => {
          if (v === '') {
            apply({ ...current, greenShare: undefined });
            return;
          }
          const direction = v[0] === 'g' ? 'green' : 'red';
          const threshold = Number(v.slice(1)) as 0.55 | 0.6 | 0.65;
          apply({ ...current, greenShare: { direction, threshold } });
        }}
        options={[
          { value: '', label: t('filter.any') },
          { value: 'g0.55', label: t('filter.greenGE55') },
          { value: 'g0.6', label: t('filter.greenGE60') },
          { value: 'g0.65', label: t('filter.greenGE65') },
          { value: 'r0.55', label: t('filter.redGE55') },
          { value: 'r0.6', label: t('filter.redGE60') },
          { value: 'r0.65', label: t('filter.redGE65') },
        ]}
      />
      <SelectField
        label={t('filter.shortInterestTrend')}
        value={current.shortInterestTrend ? `${current.shortInterestTrend.direction[0]}${current.shortInterestTrend.periods}` : ''}
        onChange={(v) => {
          if (v === '') {
            apply({ ...current, shortInterestTrend: undefined });
            return;
          }
          const direction = v[0] === 'u' ? 'up' : 'down';
          const periods = Number(v.slice(1)) as 1 | 2 | 3;
          apply({ ...current, shortInterestTrend: { direction, periods } });
        }}
        options={[
          { value: '', label: t('filter.any') },
          { value: 'u1', label: t('filter.siInc1') },
          { value: 'u2', label: t('filter.siInc2') },
          { value: 'u3', label: t('filter.siInc3') },
          { value: 'd1', label: t('filter.siDec1') },
          { value: 'd2', label: t('filter.siDec2') },
          { value: 'd3', label: t('filter.siDec3') },
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