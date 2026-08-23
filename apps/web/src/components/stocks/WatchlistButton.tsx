'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useWatchlist } from '@/lib/watchlist/useWatchlist';

interface WatchlistButtonProps {
  symbol: string;
  className?: string;
  /** Larger size used in the page header vs. compact list rows. */
  size?: 'sm' | 'md';
}

/**
 * Star toggle for adding/removing a stock from the local-storage watchlist.
 * Pre-hydration renders as a faint, non-interactive placeholder so the
 * server-rendered HTML matches the first client render — avoids hydration
 * warnings for `aria-pressed`.
 */
export function WatchlistButton({ symbol, className, size = 'md' }: WatchlistButtonProps) {
  const t = useTranslations('stock');
  const { has, toggle, hydrated } = useWatchlist();
  const saved = hydrated && has(symbol);

  const sizes =
    size === 'sm' ? 'h-7 w-7 text-base' : 'h-9 w-9 text-lg';

  return (
    <button
      type="button"
      onClick={() => toggle(symbol)}
      aria-pressed={hydrated ? saved : undefined}
      aria-label={
        hydrated
          ? saved
            ? t('watchlist.removeFromWatchlist', { symbol })
            : t('watchlist.addToWatchlist', { symbol })
          : t('watchlist.loading')
      }
      title={saved ? t('watchlist.saved') : t('watchlist.addToWatchlist', { symbol })}
      className={clsx(
        'focus-ring inline-flex items-center justify-center rounded-md border border-border bg-bg-elevated transition-colors',
        'hover:border-accent hover:bg-bg-muted',
        saved && 'border-accent text-accent',
        sizes,
        className,
      )}
    >
      <span aria-hidden="true">{saved ? '★' : '☆'}</span>
    </button>
  );
}