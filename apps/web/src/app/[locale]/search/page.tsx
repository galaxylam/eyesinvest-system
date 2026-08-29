import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@eyesinvest/ui';
import { searchStocks } from '@/lib/stocks/queries';
import { BackLink } from '@/components/stocks/BackLink';

interface SearchPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}

/**
 * Search results page. Never 404s — empty results render as a friendly
 * "No matches" state with a hint to check the symbol. The header search
 * bar navigates here instead of /stocks/<SYMBOL> for unknown symbols.
 *
 * Empty `?q=` renders the full universe as a browse-friendly default
 * (delegates to listAllStocks via the searchStocks helper).
 */
export default async function SearchPage({
  params,
  searchParams,
}: SearchPageProps) {
  const { locale } = await params;
  const { q = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('searchPage');

  const trimmed = q.trim();
  const { data: results, source } = await searchStocks(trimmed, { limit: 20 });

  return (
    <div className="mx-auto max-w-screen-md px-4 py-8 sm:px-6">
      <div className="mb-6">
        <BackLink />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          {trimmed
            ? t('titleWithQuery', { query: trimmed.toUpperCase() })
            : t('titleAll')}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {trimmed
            ? t('subtitleResults', { count: results.length })
            : t('subtitleAll')}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="rounded-md border border-border bg-bg-elevated p-8 text-center text-sm text-fg-muted">
          {trimmed ? t('noResults', { query: trimmed }) : t('noResultsAll')}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-md border border-border bg-bg-elevated">
          {results.map((s) => (
            <li
              key={s.id}
              className="border-b border-border last:border-b-0 transition-colors hover:bg-bg-muted"
            >
              <Link
                href={`/${locale}/stocks/${encodeURIComponent(s.symbol)}`}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="tabular w-20 shrink-0 font-mono text-xs font-semibold text-fg">
                  {s.symbol}
                </span>
                <Badge variant={s.market === 'US' ? 'info' : 'warn'}>{s.market}</Badge>
                <span className="flex-1 truncate text-fg">{s.name}</span>
                {s.sector && (
                  <span className="hidden text-2xs text-fg-subtle sm:inline">
                    {s.sector}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-2xs text-fg-subtle">
        {source === 'supabase'
          ? t('sourceSupabase')
          : t('sourceMock')}
      </p>
    </div>
  );
}