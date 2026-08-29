import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@eyesinvest/ui';
import { getNewsMappingsForStock } from '@/lib/stocks/queries';
import type {
  ImpactDirection,
  ImpactSeverity,
  Sentiment,
} from '@eyesinvest/types';

interface NewsPanelProps {
  symbol: string;
}

/**
 * News tab for the stock detail page. Reads approved news→stock mappings
 * via `getNewsMappingsForStock` (RLS filters anon to status='approved').
 * Falls back to the bundled mock set when Supabase isn't configured.
 */
export async function NewsPanel({ symbol }: NewsPanelProps) {
  const t = await getTranslations('stock');
  const tNews = await getTranslations('newsPage');
  const { data: rows } = await getNewsMappingsForStock(symbol, { limit: 30 });

  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-fg-muted">
        {tNews('noMappingsForStock')}
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-3">
      {rows.map((m) => (
        <li
          key={m.id}
          className="rounded-md border border-border bg-bg-muted p-4"
        >
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Badge variant="info">{m.article.sourceName}</Badge>
            {m.article.publishedAt && (
              <span>{formatDateTime(m.article.publishedAt)}</span>
            )}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-fg">
            {m.article.title}
          </h3>
          {m.article.summary && (
            <p className="mt-1 text-xs text-fg-muted line-clamp-2">
              {m.article.summary}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {m.sentiment && (
              <SentimentBadge value={m.sentiment} />
            )}
            {m.impactDirection && (
              <DirectionBadge value={m.impactDirection} />
            )}
            {m.impactSeverity && (
              <SeverityBadge value={m.impactSeverity} />
            )}
            {m.confidence != null && (
              <span className="text-fg-subtle tabular">
                {Math.round(m.confidence * 100)}%
              </span>
            )}
          </div>

          {m.rationale && (
            <p className="mt-2 text-xs text-fg-muted">
              <span className="text-fg-subtle">{tNews('rationaleLabel')}: </span>
              {m.rationale}
            </p>
          )}

          <a
            href={m.article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-accent hover:opacity-80"
          >
            {tNews('viewSource')}
          </a>
        </li>
      ))}
    </ul>
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