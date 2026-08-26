'use client';

import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export type DashboardMarket = 'all' | 'US' | 'HK';

const MARKETS: DashboardMarket[] = ['all', 'US', 'HK'];

interface DashboardMarketFilterProps {
  /** Current selection, derived from ?market= on the page. Defaults to 'all'. */
  current: DashboardMarket;
}

/**
 * All / US / HK segmented control for the dashboard. Writes ?market= to the
 * URL so the filter is shareable / bookmarkable and survives refresh.
 *
 * 'all' is the default — the URL omits the param when it's selected so the
 * canonical `/dashboard` URL stays clean (mirrors `RangePicker`).
 */
export function DashboardMarketFilter({ current }: DashboardMarketFilterProps) {
  const t = useTranslations('dashboard.marketFilter');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (next: DashboardMarket) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') {
      params.delete('market');
    } else {
      params.set('market', next);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-bg-elevated p-0.5 text-2xs"
    >
      {MARKETS.map((m) => {
        const active = m === current;
        return (
          <button
            key={m}
            type="button"
            onClick={() => handleClick(m)}
            aria-pressed={active}
            className={clsx(
              'focus-ring rounded px-2 py-1 font-medium transition-colors',
              active
                ? 'bg-bg-muted text-fg shadow-sm'
                : 'text-fg-subtle hover:text-fg',
            )}
          >
            {t(m)}
          </button>
        );
      })}
    </div>
  );
}
