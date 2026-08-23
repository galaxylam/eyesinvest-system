'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useWatchlist } from '@/lib/watchlist/useWatchlist';
import { formatPrice, formatSignedChange, formatSignedPercent } from '@/lib/format/quote';
import type { WatchlistRowResponse } from '@/app/api/quotes/route';
import { SignedNumber } from '@/components/stocks/SignedNumber';

/**
 * Client island for /watchlist. Reads the local-storage symbol list,
 * batch-fetches quote + detail rows, and renders them. Re-runs on every
 * `useWatchlist` change so a star click on another tab/page updates
 * immediately.
 */
export function WatchlistView() {
  const t = useTranslations('watchlist');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { symbols, hydrated, remove, clear } = useWatchlist();
  const [rows, setRows] = useState<Record<string, WatchlistRowResponse>>({});
  const [isPending, startTransition] = useTransition();

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
        // Swallow aborts; surface real failures quietly (empty grid below).
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[watchlist] quote fetch failed', err);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbols, hydrated]);

  // Pre-hydration: render the same shell on server + client.
  if (!hydrated) {
    return <SkeletonList rows={4} />;
  }

  if (symbols.length === 0) {
    return <EmptyState locale={locale} />;
  }

  const handleClear = () => {
    startTransition(() => clear());
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xs uppercase tracking-wide text-fg-subtle">
          {t('count', { count: symbols.length })}
        </p>
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending}
          className="focus-ring text-2xs uppercase tracking-wide text-fg-subtle hover:text-rose-500 disabled:opacity-50"
        >
          {t('clearAll')}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {symbols.map((sym) => (
          <WatchlistRow
            key={sym}
            symbol={sym}
            row={rows[sym]}
            locale={locale}
            onRemove={() => remove(sym)}
            removeLabel={t('remove', { symbol: sym })}
          />
        ))}
      </div>
    </div>
  );
}

function WatchlistRow({
  symbol,
  row,
  locale,
  onRemove,
  removeLabel,
}: {
  symbol: string;
  row: WatchlistRowResponse | undefined;
  locale: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  const t = useTranslations('watchlist');
  const quote = row?.quote ?? null;
  const detail = row?.detail ?? null;
  const detailMissing = row !== undefined && detail === null;

  return (
    <article className="group relative rounded-md border border-border bg-bg-elevated p-4 transition-colors hover:border-accent">
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={t('removeTitle')}
        className="focus-ring absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-bg-muted hover:text-rose-500 group-hover:opacity-100"
      >
        <span aria-hidden="true">×</span>
      </button>

      <Link
        href={`/${locale}/stocks/${encodeURIComponent(symbol)}`}
        className="focus-ring block rounded-sm"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-medium text-fg">{symbol}</span>
          {detail?.market && (
            <span className="rounded border border-border bg-bg-muted px-1.5 py-0.5 text-2xs text-fg-muted">
              {detail.market}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-fg-muted">
          {detail?.name ?? (detailMissing ? t('unavailable') : '…')}
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="tabular text-xl font-semibold text-fg">
            {quote ? formatPrice(quote.lastPrice, quote.currency, locale) : '—'}
          </span>
          {quote && (
            <SignedNumber value={quote.changePercent} className="text-xs">
              {formatSignedPercent(quote.changePercent, locale)}
            </SignedNumber>
          )}
        </div>
        {quote && (
          <div className="mt-1 flex items-center gap-3 text-2xs text-fg-subtle">
            <span className="tabular">{formatSignedChange(quote.change, quote.currency, locale)}</span>
            <span>·</span>
            <span>{quote.status}</span>
          </div>
        )}
      </Link>
    </article>
  );
}

function EmptyState({ locale }: { locale: string }) {
  const t = useTranslations('watchlist');
  return (
    <div className="rounded-md border border-dashed border-border bg-bg-elevated p-8 text-center">
      <div className="text-3xl text-fg-subtle" aria-hidden="true">
        ☆
      </div>
      <h2 className="mt-3 text-base font-semibold text-fg">{t('empty.title')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('empty.note')}</p>
      <Link
        href={`/${locale}/search`}
        className="focus-ring mt-4 inline-flex items-center rounded-md border border-border bg-bg-muted px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent"
      >
        {t('empty.cta')}
      </Link>
    </div>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-bg-elevated p-4"
          aria-hidden="true"
        >
          <div className="h-3 w-16 animate-pulse rounded bg-bg-muted" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-bg-muted" />
          <div className="mt-4 h-5 w-24 animate-pulse rounded bg-bg-muted" />
        </div>
      ))}
    </div>
  );
}