'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { ScreenerFilters } from '@/lib/stocks/queries';
import { useScreenerTransition } from './ScreenerTransitionContext';

/** Serialise the four new combined filters into compact URL params.
 *  - ma5 / ma20: 'up' | 'down' (or undefined)
 *  - gs: '<direction><threshold>' — 'g0.55', 'r0.65', etc. (green-share)
 *  - sit: '<direction><periods>' — 'u2', 'd3', etc. */
function encodeMaTrend(v: 'up' | 'down' | undefined): string | undefined {
  return v;
}
function encodeGs(v: ScreenerFilters['greenShareThreshold']): string | undefined {
  if (v == null) return undefined;
  return String(v);
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
  // Shared with `<ScreenerTableShell>` so the filter badge and the table
  // overlay flip on the same transition.
  const { pending, startTransition } = useScreenerTransition();

  // Local working state for the filter form. Dropdowns bind to this, not
  // to `current` (which is what the URL says was last applied), so the
  // user can change several filters before clicking Search. We sync to
  // `current` on mount and whenever the URL changes (browser back /
  // forward, external nav).
  const [pendingFilters, setPendingFilters] = useState<ScreenerFilters>(current);
  useEffect(() => {
    setPendingFilters(current);
  }, [current]);

  // Mobile-first: the panel is collapsed on viewports < md so the table
  // gets the first paint. Desktop (md+) always shows the panel — the
  // toggle button is hidden there. Initial server render uses `false`
  // (expanded) to match the desktop default; the post-hydration effect
  // snaps it closed on small screens to avoid a flash of expanded filters.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    setCollapsed(mql.matches);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsed(true);
      else setCollapsed(false); // resize to desktop → always open
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  /** Encode `next` into search params and push the new URL — this is the
   *  only thing that actually triggers a server re-render / data fetch.
   *  Sort + dir are preserved so re-filtering doesn't flip the column. */
  const commitToUrl = (next: ScreenerFilters) => {
    const params = new URLSearchParams(searchParams.toString());
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
    if (next.return1mMax != null) params.set('ret1mmax', String(next.return1mMax));
    else params.delete('ret1mmax');
    if (next.return3mMax != null) params.set('ret3mmax', String(next.return3mMax));
    else params.delete('ret3mmax');
    if (next.return6mMax != null) params.set('ret6mmax', String(next.return6mMax));
    else params.delete('ret6mmax');
    // dd30 is encoded as a percent integer so the URL reads `dd30=-10`
    // instead of `dd30=-0.1` — friendlier for hand-edits / sharing.
    if (next.drawdown30dMax != null) params.set('dd30', String(Math.round(next.drawdown30dMax * 100)));
    else params.delete('dd30');
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
    const gs = encodeGs(next.greenShareThreshold);
    if (gs) params.set('gs', gs); else params.delete('gs');
    const sit = encodeSit(next.shortInterestTrend);
    if (sit) params.set('sit', sit); else params.delete('sit');
    if (next.breakout) params.set('brk', next.breakout); else params.delete('brk');

    const query = params.toString();
    startTransition(() => {
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
      // Bypass the App Router's dynamic RSC cache so the table re-fetches with
      // the new filters instead of serving the previous segment's payload
      // (visible as "stale historical result" until a manual refresh).
      router.refresh();
    });
  };

  const search = () => commitToUrl(pendingFilters);

  const reset = () => {
    setPendingFilters({});
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  // Show Reset whenever there's something to reset — either the last
    // applied filters (URL) or the user's working selection in the form.
  const hasAny = hasAnyFilters(pendingFilters) || hasAnyFilters(current);
  // Search button picks up accent color when the user has unsaved
    // changes pending — visual cue that clicking it will actually do
    // something different from the URL state.
  const isDirty = !sameFilters(pendingFilters, current);

  return (
    <div
      className="rounded-md border border-border bg-bg-elevated p-3"
      data-pending={pending ? '' : undefined}
      aria-busy={pending || undefined}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-wide text-fg-subtle md:hidden">
          {t('filter.title')}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-controls="screener-filter-body"
          aria-label={collapsed ? t('filter.expand') : t('filter.collapse')}
          className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-muted text-fg-muted hover:text-fg md:hidden"
        >
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </button>
      </div>

      <div
        id="screener-filter-body"
        className={
          // md: always visible; below md, hide when collapsed.
          'flex flex-wrap items-end gap-3 ' +
          (collapsed ? 'hidden md:flex' : 'flex')
        }
      >
      <SelectField
        label={t('filter.market')}
        value={pendingFilters.market ?? ''}
        onChange={(v) => setPendingFilters({ ...pendingFilters, market: v === '' ? undefined : (v as 'US' | 'HK') })}
        disabled={pending}
        options={[
          { value: '', label: t('filter.all') },
          { value: 'US', label: t('filter.us') },
          { value: 'HK', label: t('filter.hk') },
        ]}
      />
      <SelectField
        label={t('filter.sector')}
        value={pendingFilters.sector ?? ''}
        onChange={(v) => setPendingFilters({ ...pendingFilters, sector: v === '' ? undefined : v })}
        disabled={pending}
        options={[
          { value: '', label: t('filter.all') },
          ...sectors.map((s) => ({ value: s, label: s })),
        ]}
      />
      <SelectField
        label={t('filter.marketCap')}
        value={pendingFilters.marketCapMin == null ? '' : String(pendingFilters.marketCapMin)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, marketCapMin: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
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
        value={pendingFilters.peMax == null ? '' : String(pendingFilters.peMax)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, peMax: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '10', label: `≤ 10` },
          { value: '15', label: `≤ 15` },
          { value: '25', label: `≤ 25` },
          { value: '40', label: `≤ 40` },
          { value: '100', label: `≤ 100` },
        ]}
      />
      <SelectField
        label={t('filter.yield')}
        value={pendingFilters.yieldMin == null ? '' : String(pendingFilters.yieldMin)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, yieldMin: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '0.01', label: `≥ 1%` },
          { value: '0.03', label: `≥ 3%` },
          { value: '0.05', label: `≥ 5%` },
          { value: '0.07', label: `≥ 7%` },
          { value: '0.1', label: `≥ 10%` },
        ]}
      />
      <SelectField
        label={t('filter.return1m')}
        value={pendingFilters.return1mMin == null ? '' : String(pendingFilters.return1mMin)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, return1mMin: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '-20', label: `≥ −20%` },
          { value: '-10', label: `≥ −10%` },
          { value: '0', label: `≥ 0%` },
          { value: '10', label: `≥ 10%` },
          { value: '20', label: `≥ 20%` },
        ]}
      />
      <SelectField
        label={t('filter.return1mMax')}
        value={pendingFilters.return1mMax == null ? '' : String(pendingFilters.return1mMax)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, return1mMax: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '0', label: t('filter.ret1mMaxLE0') },
          { value: '5', label: t('filter.ret1mMaxLE5') },
          { value: '10', label: t('filter.ret1mMaxLE10') },
        ]}
      />
      <SelectField
        label={t('filter.return3mMax')}
        value={pendingFilters.return3mMax == null ? '' : String(pendingFilters.return3mMax)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, return3mMax: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '0', label: t('filter.ret3mMaxLE0') },
          { value: '10', label: t('filter.ret3mMaxLE10') },
          { value: '20', label: t('filter.ret3mMaxLE20') },
        ]}
      />
      <SelectField
        label={t('filter.return6mMax')}
        value={pendingFilters.return6mMax == null ? '' : String(pendingFilters.return6mMax)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, return6mMax: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '0', label: t('filter.ret6mMaxLE0') },
          { value: '10', label: t('filter.ret6mMaxLE10') },
          { value: '20', label: t('filter.ret6mMaxLE20') },
          { value: '30', label: t('filter.ret6mMaxLE30') },
          { value: '40', label: t('filter.ret6mMaxLE40') },
          { value: '50', label: t('filter.ret6mMaxLE50') },
        ]}
      />
      <SelectField
        label={t('filter.drawdown30dMax')}
        value={
          pendingFilters.drawdown30dMax == null
            ? ''
            : String(Math.round(pendingFilters.drawdown30dMax * 100))
        }
        onChange={(v) =>
          setPendingFilters({
            ...pendingFilters,
            drawdown30dMax: v === '' ? undefined : Number(v) / 100,
          })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '-10', label: t('filter.dd30LE10') },
          { value: '-20', label: t('filter.dd30LE20') },
          { value: '-30', label: t('filter.dd30LE30') },
          { value: '-40', label: t('filter.dd30LE40') },
          { value: '-50', label: t('filter.dd30LE50') },
        ]}
      />
      <SelectField
        label={t('filter.volumeEfficiency')}
        value={pendingFilters.volumeEfficiencyMin == null ? '' : String(pendingFilters.volumeEfficiencyMin)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, volumeEfficiencyMin: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
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
          pendingFilters.crowdedRatioMax != null
            ? `lt${pendingFilters.crowdedRatioMax}`
            : pendingFilters.crowdedRatioMin == null
              ? ''
              : String(pendingFilters.crowdedRatioMin)
        }
        onChange={(v) => {
          if (v === '') {
            setPendingFilters({ ...pendingFilters, crowdedRatioMin: undefined, crowdedRatioMax: undefined });
            return;
          }
          if (v.startsWith('lt')) {
            // "< 1×" subdued bucket — exclusive upper bound.
            setPendingFilters({
              ...pendingFilters,
              crowdedRatioMin: undefined,
              crowdedRatioMax: Number(v.slice(2)),
            });
            return;
          }
          setPendingFilters({ ...pendingFilters, crowdedRatioMin: Number(v), crowdedRatioMax: undefined });
        }}
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '1', label: t('filter.crowd1') },
          { value: '1.2', label: t('filter.crowd1_2') },
          { value: '1.5', label: t('filter.crowd1_5') },
          { value: '2', label: t('filter.crowd2') },
          { value: 'lt0.6', label: t('filter.crowdLT0_6') },
          { value: 'lt0.8', label: t('filter.crowdLT0_8') },
          { value: 'lt1', label: t('filter.crowdLT1') },
        ]}
      />
      <SelectField
        label={t('filter.squeezeScore')}
        value={pendingFilters.squeezeMin == null ? '' : String(pendingFilters.squeezeMin)}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, squeezeMin: v === '' ? undefined : Number(v) })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '40', label: t('filter.sq40') },
          { value: '60', label: t('filter.sq60') },
          { value: '80', label: t('filter.sq80') },
        ]}
      />
      <SelectField
        label={t('filter.ma5')}
        value={pendingFilters.ma5Trend ?? ''}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, ma5Trend: v === '' ? undefined : (v as 'up' | 'down') })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: 'up', label: t('filter.maUp') },
          { value: 'down', label: t('filter.maDown') },
        ]}
      />
      <SelectField
        label={t('filter.ma20')}
        value={pendingFilters.ma20Trend ?? ''}
        onChange={(v) =>
          setPendingFilters({ ...pendingFilters, ma20Trend: v === '' ? undefined : (v as 'up' | 'down') })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: 'up', label: t('filter.maUp') },
          { value: 'down', label: t('filter.maDown') },
        ]}
      />
      <SelectField
        label={t('filter.greenShare')}
        value={pendingFilters.greenShareThreshold != null ? String(pendingFilters.greenShareThreshold) : ''}
        onChange={(v) => {
          if (v === '') {
            setPendingFilters({ ...pendingFilters, greenShareThreshold: undefined });
            return;
          }
          const n = Number(v) as 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | -0.1 | -0.2 | -0.3 | -0.4 | -0.5 | -0.6;
          setPendingFilters({ ...pendingFilters, greenShareThreshold: n });
        }}
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: '0.6', label: t('filter.gsGT60') },
          { value: '0.5', label: t('filter.gsGT50') },
          { value: '0.4', label: t('filter.gsGT40') },
          { value: '0.3', label: t('filter.gsGT30') },
          { value: '0.2', label: t('filter.gsGT20') },
          { value: '0.1', label: t('filter.gsGT10') },
          { value: '-0.1', label: t('filter.gsLT10') },
          { value: '-0.2', label: t('filter.gsLT20') },
          { value: '-0.3', label: t('filter.gsLT30') },
          { value: '-0.4', label: t('filter.gsLT40') },
          { value: '-0.5', label: t('filter.gsLT50') },
          { value: '-0.6', label: t('filter.gsLT60') },
        ]}
      />
      <SelectField
        label={t('filter.shortInterestTrend')}
        value={pendingFilters.shortInterestTrend ? `${pendingFilters.shortInterestTrend.direction[0]}${pendingFilters.shortInterestTrend.periods}` : ''}
        onChange={(v) => {
          if (v === '') {
            setPendingFilters({ ...pendingFilters, shortInterestTrend: undefined });
            return;
          }
          const direction = v[0] === 'u' ? 'up' : 'down';
          const periods = Number(v.slice(1)) as 1 | 2 | 3;
          setPendingFilters({ ...pendingFilters, shortInterestTrend: { direction, periods } });
        }}
        disabled={pending}
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
      <SelectField
        label={t('filter.breakout')}
        value={pendingFilters.breakout ?? ''}
        onChange={(v) =>
          setPendingFilters({
            ...pendingFilters,
            breakout: v === '' ? undefined : (v as 'breakout' | 'breakdown'),
          })
        }
        disabled={pending}
        options={[
          { value: '', label: t('filter.any') },
          { value: 'breakout', label: t('filter.breakoutUp') },
          { value: 'breakdown', label: t('filter.breakoutDown') },
        ]}
      />

      {pending && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 self-center text-2xs text-fg-muted"
        >
          <svg
            className="h-3 w-3 animate-spin text-accent"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="3"
            />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span>{t('loading')}</span>
        </span>
      )}

      <button
        type="button"
        onClick={search}
        disabled={pending}
        className={
          'focus-ring rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ' +
          (isDirty
            ? 'border-accent bg-accent text-accent-fg hover:opacity-90'
            : 'border-border bg-bg-muted text-fg-muted hover:border-accent hover:text-fg')
        }
      >
        {t('filter.search')}
      </button>

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
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

/** True when any field of `f` is non-null. Used to decide whether the Reset
 *  button should be visible. */
function hasAnyFilters(f: ScreenerFilters): boolean {
  return (
    f.market != null ||
    f.sector != null ||
    f.marketCapMin != null ||
    f.peMax != null ||
    f.yieldMin != null ||
    f.return1mMin != null ||
    f.return1mMax != null ||
    f.return3mMax != null ||
    f.return6mMax != null ||
    f.drawdown30dMax != null ||
    f.volumeEfficiencyMin != null ||
    f.crowdedRatioMin != null ||
    f.crowdedRatioMax != null ||
    f.squeezeMin != null ||
    f.ma5Trend != null ||
    f.ma20Trend != null ||
    f.greenShareThreshold != null ||
    f.shortInterestTrend != null ||
    f.breakout != null
  );
}

/** Structural equality over `ScreenerFilters`. Keys are flat except for
 *  `shortInterestTrend` (a {direction, periods} object). Order of keys
 *  doesn't matter. */
function sameFilters(a: ScreenerFilters, b: ScreenerFilters): boolean {
  const keys: (keyof ScreenerFilters)[] = [
    'market', 'sector', 'marketCapMin', 'peMax', 'yieldMin',
    'return1mMin', 'return1mMax', 'return3mMax', 'return6mMax',
    'drawdown30dMax', 'volumeEfficiencyMin', 'crowdedRatioMin',
    'crowdedRatioMax', 'squeezeMin', 'ma5Trend', 'ma20Trend',
    'greenShareThreshold', 'shortInterestTrend', 'breakout',
  ];
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (k === 'shortInterestTrend') {
      const aSit = av as ScreenerFilters['shortInterestTrend'];
      const bSit = bv as ScreenerFilters['shortInterestTrend'];
      if (aSit?.direction !== bSit?.direction || aSit?.periods !== bSit?.periods) return false;
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="focus-ring rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-fg disabled:cursor-not-allowed disabled:opacity-50"
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