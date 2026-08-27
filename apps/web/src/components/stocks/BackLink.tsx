'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Browser-history back link for the stock detail page. Replaces the old
 * static `<a href="/search">` so we don't rely on a `/search` route that
 * doesn't exist (the app's search is the header SearchBar that jumps
 * straight to a stock page). Falls back to the dashboard if there's no
 * history to pop.
 */
export function BackLink() {
  const router = useRouter();
  const t = useTranslations('stock');
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back();
        } else {
          router.push('/en');
        }
      }}
      className="focus-ring inline-flex items-center rounded-sm text-xs text-fg-muted hover:text-fg"
    >
      ← {t('backToSearch')}
    </button>
  );
}