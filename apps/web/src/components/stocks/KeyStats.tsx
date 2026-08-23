import { getLocale, getTranslations } from 'next-intl/server';
import type { StockFundamentals } from '@eyesinvest/types';
import {
  formatMarketCap,
  formatPrice,
  formatVolume,
} from '@/lib/format/quote';

interface KeyStatsProps {
  currency: string;
  fundamentals: StockFundamentals | null;
  /** 52-wk high/low derived from ey_price_1d window. */
  range52W: { high: number | null; low: number | null };
}

export async function KeyStats({ currency, fundamentals, range52W }: KeyStatsProps) {
  const t = await getTranslations('stock');
  const locale = await getLocale();

  const fmtPct = (v: number | null): string => {
    if (v == null) return '—';
    return `${(v * 100).toFixed(2)}%`;
  };
  const fmtShares = (v: number | null): string => {
    if (v == null) return '—';
    return formatVolume(v, locale);
  };
  const fmtPriceRange = (low: number | null, high: number | null): string => {
    if (low == null || high == null) return '—';
    return `${formatPrice(low, currency, locale)} – ${formatPrice(high, currency, locale)}`;
  };
  const fmtSinglePrice = (v: number | null): string => {
    if (v == null) return '—';
    return formatPrice(v, currency, locale);
  };

  const stats: { label: string; value: string }[] = [
    { label: t('marketCap'), value: formatMarketCap(fundamentals?.marketCap ?? null, locale) },
    { label: t('pe'), value: fundamentals?.peRatio == null ? '—' : fundamentals.peRatio.toFixed(2) },
    { label: t('dividendYield'), value: fmtPct(fundamentals?.dividendYield ?? null) },
    { label: t('fiftyTwoWeekRange'), value: fmtPriceRange(range52W.low, range52W.high) },
    { label: t('avgVolume'), value: formatVolume(fundamentals?.sharesOutstanding ?? null, locale) },
    { label: t('sharesOutstanding'), value: fmtShares(fundamentals?.sharesOutstanding ?? null) },
  ];

  // Day range isn't yet computed from intraday data — leave blank with a hint.
  // We include it so the grid stays balanced with the existing layout.

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-fg">{t('keyStats')}</h2>
        <p className="mt-0.5 text-xs text-fg-subtle">
          {t('keyStatsPhase1Note', { currency: fmtSinglePrice(null) || currency })}
        </p>
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="px-5 py-3">
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">
              {s.label}
            </dt>
            <dd className="tabular mt-1 text-sm font-medium text-fg">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
