import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@eyesinvest/ui';
import {
  getRecentKnowledgeGraph,
  getRecentNewsMappings,
} from '@/lib/stocks/queries';
import type {
  ImpactDirection,
  ImpactSeverity,
  Sentiment,
} from '@eyesinvest/types';

export default async function NewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('newsPage');

  const [{ data: mappings }, { data: edges }] = await Promise.all([
    getRecentNewsMappings({ limit: 50 }),
    getRecentKnowledgeGraph({ limit: 30 }),
  ]);

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>

      {/* Recent impact analysis */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
          {t('sections.recentImpact')}
        </h2>
        {mappings.length === 0 ? (
          <div className="rounded-md border border-border bg-bg-elevated p-8 text-center text-sm text-fg-muted">
            {t('empty')}
          </div>
        ) : (
          <ul className="space-y-3">
            {mappings.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-border bg-bg-elevated p-5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <Link
                    href={`/${locale}/stocks/${m.stock.symbol}`}
                    className="tabular font-mono font-semibold text-fg hover:text-accent"
                  >
                    {m.stock.symbol}
                  </Link>
                  <Badge variant={m.stock.market === 'US' ? 'info' : 'warn'}>
                    {m.stock.market}
                  </Badge>
                  <Badge variant="outline">{m.article.sourceName}</Badge>
                  {m.article.publishedAt && (
                    <span>{formatDateTime(m.article.publishedAt)}</span>
                  )}
                </div>

                <h3 className="mt-2 text-base font-semibold text-fg">
                  <a
                    href={m.article.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent"
                  >
                    {m.article.title}
                  </a>
                </h3>
                {m.article.summary && (
                  <p className="mt-1 text-sm text-fg-muted">
                    {m.article.summary}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {m.sentiment && <SentimentBadge value={m.sentiment} />}
                  {m.impactDirection && <DirectionBadge value={m.impactDirection} />}
                  {m.impactSeverity && <SeverityBadge value={m.impactSeverity} />}
                  {m.confidence != null && (
                    <span className="text-fg-subtle tabular">
                      {t('confidenceLabel')}: {Math.round(m.confidence * 100)}%
                    </span>
                  )}
                </div>

                {m.rationale && (
                  <p className="mt-2 text-sm text-fg-muted">
                    <span className="text-fg-subtle">
                      {t('rationaleLabel')}:{' '}
                    </span>
                    {m.rationale}
                  </p>
                )}

                <a
                  href={m.article.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs text-accent hover:opacity-80"
                >
                  {t('viewSource')}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Knowledge graph */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
          {t('sections.knowledgeGraph')}
        </h2>
        {edges.length === 0 ? (
          <div className="rounded-md border border-border bg-bg-elevated p-8 text-center text-sm text-fg-muted">
            {t('empty')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
            <table className="w-full text-sm">
              <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-2 py-2.5" />
                  <th className="px-4 py-2.5 font-medium">Target</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {edges.map((e) => (
                  <tr key={e.id} className="hover:bg-bg-muted">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/${locale}/stocks/${e.source.symbol}`}
                        className="tabular font-mono text-xs font-semibold hover:text-accent"
                      >
                        {e.source.symbol}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 text-fg-subtle">→</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/${locale}/stocks/${e.target.symbol}`}
                        className="tabular font-mono text-xs font-semibold hover:text-accent"
                      >
                        {e.target.symbol}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={typeBadgeVariant(e.relationshipType)}>
                        {e.relationshipType}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular text-xs">
                      {e.confidence == null
                        ? '—'
                        : `${Math.round(e.confidence * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SentimentBadge({ value }: { value: Sentiment }) {
  const variant =
    value === 'bullish' ? 'positive' :
    value === 'bearish' ? 'negative' :
    'outline';
  return <Badge variant={variant}>{value}</Badge>;
}

function DirectionBadge({ value }: { value: ImpactDirection }) {
  const variant =
    value === 'positive' ? 'positive' :
    value === 'negative' ? 'negative' :
    'outline';
  return <Badge variant={variant}>{value}</Badge>;
}

function SeverityBadge({ value }: { value: ImpactSeverity }) {
  const variant =
    value === 'critical' ? 'negative' :
    value === 'high' ? 'warn' :
    value === 'medium' ? 'outline' :
    'info';
  return <Badge variant={variant}>{value}</Badge>;
}

function typeBadgeVariant(
  t: 'supplier' | 'competitor' | 'customer' | 'partner' | 'parent_subsidiary',
): 'info' | 'warn' | 'positive' | 'outline' {
  switch (t) {
    case 'supplier':
      return 'info';
    case 'customer':
      return 'positive';
    case 'competitor':
      return 'warn';
    default:
      return 'outline';
  }
}