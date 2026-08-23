import { getTranslations, setRequestLocale } from 'next-intl/server';
import { searchStocks } from '@/lib/stocks/queries';
import { SearchResults } from '@/components/search/SearchResults';

interface SearchPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ params, searchParams }: SearchPageProps) {
  const { locale } = await params;
  const { q = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('search');

  const { data } = q.trim().length >= 2 ? await searchStocks(q) : { data: [] };

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">
        {t('title')}
      </h1>
      <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>

      <div className="mt-6">
        <SearchResults locale={locale} results={data} query={q} />
      </div>
    </div>
  );
}
