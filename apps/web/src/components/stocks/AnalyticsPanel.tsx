import { getLocale, getTranslations } from 'next-intl/server';
import type { StockAnalytics } from '@eyesinvest/types';
import { formatPrice, formatSignedPercent } from '@/lib/format/quote';

interface AnalyticsPanelProps {
  /** Currency used to format MA / MACD values (they share unit with the price). */
  currency: string;
  /** Latest indicator snapshot — usually the last element of getStockAnalytics(). */
  analytics: StockAnalytics | null;
}

/**
 * Render a single stock's most recent technical indicators. Falls back to
 * "—" for any null field (worker hasn't computed it yet, or not enough
 * history). Designed to live on the stock detail page below the price chart.
 */
export async function AnalyticsPanel({ currency, analytics }: AnalyticsPanelProps) {
  const t = await getTranslations('stock');
  const locale = await getLocale();

  const fmtPrice = (v: number | null): string => {
    if (v == null) return '—';
    return formatPrice(v, currency, locale);
  };
  const fmtPct = (v: number | null): string => {
    if (v == null) return '—';
    return formatSignedPercent(v, locale);
  };
  const fmtPctRaw = (v: number | null): string => {
    if (v == null) return '—';
    return `${(v * 100).toFixed(2)}%`;
  };
  const fmtNum = (v: number | null, digits = 2): string => {
    if (v == null) return '—';
    return v.toFixed(digits);
  };

  const rsiLabel = (() => {
    if (analytics?.rsi14 == null) return null;
    if (analytics.rsi14 >= 70) return t('indicator.rsiOverbought');
    if (analytics.rsi14 <= 30) return t('indicator.rsiOversold');
    return t('indicator.rsiNeutral');
  })();

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-fg">{t('indicator.panelTitle')}</h2>
        {analytics?.asOfDate && (
          <p className="mt-0.5 text-xs text-fg-subtle">
            {t('indicator.asOf', { date: analytics.asOfDate })}
          </p>
        )}
      </div>

      {/* Technical (MA / RSI / MACD) */}
      <div className="px-5 pt-4 text-2xs uppercase tracking-wide text-fg-subtle">
        Technical
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4">
        <Stat label={t('indicator.ma5')} value={fmtPrice(analytics?.ma5 ?? null)} />
        <Stat label={t('indicator.ma20')} value={fmtPrice(analytics?.ma20 ?? null)} />
        <Stat label={t('indicator.ma50')} value={fmtPrice(analytics?.ma50 ?? null)} />
        <Stat label={t('indicator.ma200')} value={fmtPrice(analytics?.ma200 ?? null)} />
        <Stat
          label={t('indicator.rsi14')}
          value={fmtNum(analytics?.rsi14 ?? null, 2)}
          sub={rsiLabel ?? undefined}
          subTone={
            analytics?.rsi14 != null && analytics.rsi14 >= 70
              ? 'negative'
              : analytics?.rsi14 != null && analytics.rsi14 <= 30
                ? 'positive'
                : undefined
          }
        />
        <Stat label={t('indicator.macdLine')} value={fmtNum(analytics?.macdLine ?? null, 3)} />
        <Stat label={t('indicator.macdSignal')} value={fmtNum(analytics?.macdSignal ?? null, 3)} />
        <Stat label={t('indicator.macdHist')} value={fmtNum(analytics?.macdHist ?? null, 3)} />
        {/* Empty cell to keep grid balance */}
        <div className="px-5 py-3" />
      </dl>

      {/* Risk */}
      <div className="border-t border-border px-5 pt-4 text-2xs uppercase tracking-wide text-fg-subtle">
        Risk
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-2">
        <Stat label={t('indicator.volatility30d')} value={fmtPctRaw(analytics?.volatility30d ?? null)} />
        <Stat label={t('indicator.maxDrawdown30d')} value={fmtPctRaw(analytics?.maxDrawdown30d ?? null)} />
      </dl>

      {/* Returns */}
      <div className="border-t border-border px-5 pt-4 text-2xs uppercase tracking-wide text-fg-subtle">
        Returns
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4">
        <Stat label={t('indicator.return1m')} value={fmtPct(analytics?.return1m ?? null)} />
        <Stat label={t('indicator.return3m')} value={fmtPct(analytics?.return3m ?? null)} />
        <Stat label={t('indicator.return6m')} value={fmtPct(analytics?.return6m ?? null)} />
        <Stat label={t('indicator.return1y')} value={fmtPct(analytics?.return1y ?? null)} />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: 'positive' | 'negative';
}) {
  return (
    <div className="px-5 py-3">
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="tabular mt-1 text-sm font-medium text-fg">{value}</dd>
      {sub && (
        <dd
          className={
            'tabular mt-0.5 text-2xs ' +
            (subTone === 'positive'
              ? 'text-emerald-500'
              : subTone === 'negative'
                ? 'text-rose-500'
                : 'text-fg-subtle')
          }
        >
          {sub}
        </dd>
      )}
    </div>
  );
}