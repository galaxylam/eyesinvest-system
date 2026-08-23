import { getTranslations, setRequestLocale } from 'next-intl/server';
import { WatchlistView } from '@/components/watchlist/WatchlistView';

interface WatchlistPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Server shell. Symbols live in localStorage (client-only), so all data
 * fetching is deferred to the client island.
 */
export default async function WatchlistPage({ params }: WatchlistPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('watchlist');

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
        </div>
      </div>

      <WatchlistView />
    </div>
  );
}