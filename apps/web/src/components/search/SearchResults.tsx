import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { StockSearchResult } from '@/lib/stocks/types';

interface SearchResultsProps {
  locale: string;
  results: StockSearchResult[];
  query: string;
}

export async function SearchResults({ locale, results, query }: SearchResultsProps) {
  const t = await getTranslations('search');
  const tStock = await getTranslations('stock');
  const tCommon = await getTranslations('common');

  if (query.length < 2) {
    return (
      <p className="rounded-md border border-border bg-bg-elevated px-4 py-6 text-center text-sm text-fg-muted">
        {t('minChars')}
      </p>
    );
  }

  if (results.length === 0) {
    return (
      <p className="rounded-md border border-border bg-bg-elevated px-4 py-6 text-center text-sm text-fg-muted">
        {t('noResults', { query })}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
      <table className="w-full text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th className="px-4 py-2.5 font-medium">{tStock('symbol')}</th>
            <th className="px-4 py-2.5 font-medium">{tStock('name')}</th>
            <th className="px-4 py-2.5 font-medium">{tStock('market')}</th>
            <th className="px-4 py-2.5 font-medium">{tStock('sector')}</th>
            <th className="px-4 py-2.5 text-right font-medium">{tStock('action')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {results.map((r) => (
            <tr key={r.id} className="transition-colors hover:bg-bg-muted">
              <td className="px-4 py-2.5">
                <span className="tabular font-mono text-xs font-semibold text-fg">
                  {r.symbol}
                </span>
              </td>
              <td className="px-4 py-2.5 text-fg">{r.name}</td>
              <td className="px-4 py-2.5 text-fg-muted">{marketLabel(locale, r.market)}</td>
              <td className="px-4 py-2.5 text-fg-muted">{r.sector ?? '—'}</td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  href={`/${locale}/stocks/${encodeURIComponent(r.symbol)}`}
                  className="focus-ring inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs text-fg transition-colors hover:bg-bg"
                >
                  {tCommon('view')}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function marketLabel(locale: string, code: string): string {
  if (code === 'US') return 'United States';
  if (code === 'HK') return locale === 'zh-HK' ? '香港' : locale === 'zh-CN' ? '香港' : 'Hong Kong';
  return code;
}
