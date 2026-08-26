'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useWatchlist } from '@/lib/watchlist/useWatchlist';
import { formatPrice, formatSignedPercent } from '@/lib/format/quote';
import { SignedNumber } from '@/components/stocks/SignedNumber';
import type { WatchlistRowResponse } from '@/app/api/quotes/route';
import type { DashboardMarket } from '@/components/dashboard/DashboardMarketFilter';

const PREVIEW_LIMIT = 4;

interface DashboardWatchlistCardProps {
  /** 'all' = no filtering; 'US' / 'HK' = show only symbols whose `detail.market` matches. */
  market: DashboardMarket;
}

/**
 * Compact watchlist preview for the dashboard. Shows the first
 * {@link PREVIEW_LIMIT} saved symbols (after market filter) with price +
 * change%. Server + first client render match (no rows visible) to avoid
 * hydration mismatches.
 */
export function DashboardWatchlistCard({ market }: DashboardWatchlistCardProps) {
  const t = useTranslations('dashboard');
  const tWatch = useTranslations('watchlist');
  const locale = useLocale();
  const { symbols, hydrated } = useWatchlist();
  const [rows, setRows] = useState<Record<string, WatchlistRowResponse>>({});

  // Symbols filtered by market — the API quote details carry `market`, so
  // we filter using the loaded detail rows (when available). Until the
  // quote fetch resolves, fall back to passing through unfiltered so the
  // user sees their saved list immediately.
  const visibleSymbols = useMemo(() => {
    if (market === 'all') return symbols;
    return symbols.filter((sym) => rows[sym]?.detail?.market === market);
  }, [symbols, rows, market]);

  useEffect(() => {
    if (!hydrated || symbols.length === 0) {
      setRows({});
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Record<string, WatchlistRowResponse>;
        if (!cancelled) setRows(json);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[dashboard:watchlist] fetch failed', err);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbols, hydrated]);

  if (!hydrated) {
    return (
      <Card title={t('watchlist')} subtitle={t('watchlistSubtitle')}>
        <p className="text-sm text-fg-muted">{t('watchlistBody')}</p>
      </Card>
    );
  }

  if (symbols.length === 0) {
    return (
      <Card title={t('watchlist')} subtitle={t('watchlistSubtitle')}>
        <p className="text-sm text-fg-muted">{t('watchlistBody')}</p>
        <Link
          href={`/${locale}/search`}
          className="mt-3 inline-flex items-center text-xs text-accent hover:underline"
        >
          {t('findStocks')} →
        </Link>
      </Card>
    );
  }

  // No symbols in the selected market — show a market-specific empty state
  // rather than the generic "no saved stocks" message.
  if (visibleSymbols.length === 0) {
    const marketLabel = market === 'US'
      ? t('marketFilter.us')
      : market === 'HK'
        ? t('marketFilter.hk')
        : '';
    return (
      <Card title={t('watchlist')} subtitle={t('watchlistSubtitle')}>
        <p className="text-sm text-fg-muted">
          {t('watchlistEmptyForMarket', { market: marketLabel })}
        </p>
        <Link
          href={`/${locale}/search`}
          className="mt-3 inline-flex items-center text-xs text-accent hover:underline"
        >
          {t('findStocks')} →
        </Link>
      </Card>
    );
  }

  const visible = visibleSymbols.slice(0, PREVIEW_LIMIT);
  const overflow = visibleSymbols.length - visible.length;

  return (
    <Card
      title={t('watchlist')}
      subtitle={tWatch('count', { count: visibleSymbols.length })}
    >
      <ul className="divide-y divide-border text-sm">
        {visible.map((sym) => {
          const row = rows[sym];
          const quote = row?.quote ?? null;
          return (
            <li key={sym} className="flex items-center justify-between gap-2 py-1.5">
              <Link
                href={`/${locale}/stocks/${encodeURIComponent(sym)}`}
                className="flex items-baseline gap-2 truncate hover:text-accent"
              >
                <span className="tabular font-mono text-xs font-medium text-fg">{sym}</span>
                <span className="truncate text-2xs text-fg-muted">
                  {row?.detail?.name ?? '…'}
                </span>
              </Link>
              <span className="flex items-baseline gap-2">
                <span className="tabular text-2xs text-fg">
                  {quote ? formatPrice(quote.lastPrice, quote.currency, locale) : '—'}
                </span>
                {quote && (
                  <SignedNumber value={quote.changePercent} className="text-2xs">
                    {formatSignedPercent(quote.changePercent, locale)}
                  </SignedNumber>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {overflow > 0 && (
        <p className="mt-2 text-2xs text-fg-subtle">
          +{overflow} {tWatch('more')}
        </p>
      )}
      <Link
        href={`/${locale}/watchlist`}
        className="mt-3 inline-flex items-center text-xs text-accent hover:underline"
      >
        {tWatch('viewAll')} →
      </Link>
    </Card>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {subtitle && <span className="text-2xs text-fg-subtle">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}