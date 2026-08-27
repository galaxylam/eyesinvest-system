'use client';

import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export type ChartRange = '1M' | '3M' | '6M' | '1Y' | '3Y';

const RANGES: ChartRange[] = ['1M', '3M', '6M', '1Y', '3Y'];

interface RangePickerProps {
  /** Current range, derived from ?range= on the page. Defaults to '1M'. */
  current: ChartRange;
}

/**
 * 1M / 3M / 6M / 1Y / 3Y range picker for the stock chart. Renders above
 * the chart, navigates via `router.replace(?range=X)` so the back button
 * stays clean (one entry per stock page, not one per range flip).
 */
export function RangePicker({ current }: RangePickerProps) {
  const t = useTranslations('stock');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (range: ChartRange) => {
    const params = new URLSearchParams(searchParams.toString());
    if (range === '1M') {
      // '1M' is the default — strip the param so the URL stays canonical.
      params.delete('range');
    } else {
      params.set('range', range);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  return (
    <div
      role="group"
      aria-label={t('chartRange.label')}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-bg-elevated p-0.5 text-2xs"
    >
      {RANGES.map((r) => {
        const active = r === current;
        return (
          <button
            key={r}
            type="button"
            onClick={() => handleClick(r)}
            aria-pressed={active}
            className={clsx(
              'focus-ring rounded px-2 py-1 font-medium transition-colors',
              active
                ? 'bg-bg-muted text-fg shadow-sm'
                : 'text-fg-subtle hover:text-fg',
            )}
          >
            {t(`chartRange.${r}`)}
          </button>
        );
      })}
    </div>
  );
}