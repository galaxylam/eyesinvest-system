import { getLocale, getTranslations } from 'next-intl/server';
import { formatPrice, formatSignedChange, formatSignedPercent, formatAsOf, formatVolume } from '@/lib/format/quote';
import type { Quote } from '@eyesinvest/types';
import { MarketStatusBadge } from './MarketStatusBadge';
import { SignedNumber } from './SignedNumber';

interface StockHeaderProps {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  exchange?: string | null;
  sector?: string | null;
  aliases: string[];
  quote: Quote | null;
}

export async function StockHeader({
  symbol,
  name,
  market,
  currency,
  exchange,
  sector,
  aliases,
  quote,
}: StockHeaderProps) {
  const t = await getTranslations('stock');
  const locale = await getLocale();

  return (
    <header className="flex flex-col gap-3 rounded-md border border-border bg-bg-elevated p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {name}{' '}
          <span className="font-mono text-base font-medium text-fg-muted">
            {symbol}
          </span>
        </h1>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="rounded-md border border-border bg-bg-muted px-2 py-0.5">
            {market}
          </span>
          {exchange && (
            <span className="rounded-md border border-border bg-bg-muted px-2 py-0.5">
              {exchange}
            </span>
          )}
          {sector && (
            <span className="rounded-md border border-border bg-bg-muted px-2 py-0.5">
              {sector}
            </span>
          )}
          {quote && <MarketStatusBadge status={quote.status} />}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {quote ? (
          <>
            <span className="tabular text-3xl font-semibold text-fg">
              {formatPrice(quote.lastPrice, quote.currency, locale)}
            </span>
            <SignedNumber value={quote.change}>
              {formatSignedChange(quote.change, quote.currency, locale)}
            </SignedNumber>
            <SignedNumber value={quote.changePercent}>
              {formatSignedPercent(quote.changePercent, locale)}
            </SignedNumber>
            <span className="tabular text-xs text-fg-subtle">
              {t('asOf')}: {formatAsOf(quote.asOf)}
            </span>
            <span className="tabular text-xs text-fg-subtle">
              {t('avgVolume')}: {formatVolume(quote.volume, locale)}
            </span>
          </>
        ) : (
          <>
            <span className="tabular text-3xl font-semibold text-fg">
              {formatPrice(0, currency, locale)}
            </span>
            <span className="tabular text-sm text-fg-subtle">
              {t('lastUpdated')}: —
            </span>
          </>
        )}
      </div>

      {aliases.length > 0 && (
        <p className="text-xs text-fg-muted">
          <span className="text-fg-subtle">{t('alsoKnownAs')}: </span>
          {aliases.join(' · ')}
        </p>
      )}
    </header>
  );
}
