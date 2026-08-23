import { getLocale, getTranslations } from 'next-intl/server';
import type { StockAnalytics } from '@eyesinvest/types';
import { formatSignedPercent } from '@/lib/format/quote';
import { Stat } from './Stat';

interface VolatilityPanelProps {
  analytics: StockAnalytics | null;
}

/**
 * Volatility tab panel. Reads `latestAnalytics` from the analytics series
 * already fetched on the page — no separate query needed.
 */
export async function VolatilityPanel({ analytics }: VolatilityPanelProps) {
  const t = await getTranslations('stock');
  const locale = await getLocale();

  const fmtPct = (v: number | null): string => {
    if (v == null) return '—';
    return formatSignedPercent(v, locale);
  };
  const fmtPctRaw = (v: number | null): string => {
    if (v == null) return '—';
    return `${(v * 100).toFixed(2)}%`;
  };

  const volPct = analytics?.volatility30d != null ? analytics.volatility30d * 100 : null;
  // Regime thresholds: <15% Low, 15-35% Moderate, >35% High.
  const regime =
    volPct == null
      ? null
      : volPct < 15
        ? 'low'
        : volPct < 35
          ? 'mid'
          : 'high';
  const regimeTone =
    regime === 'high' ? 'negative' : regime === 'mid' ? 'warning' : undefined;
  const regimeLabel =
    regime == null ? null : t(`volatilityPanel.regimeLabel.${regime}`);

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-fg">{t('volatilityPanel.panelTitle')}</h3>
        <p className="mt-0.5 text-xs text-fg-subtle">{t('volatilityPanel.note')}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 px-5 pt-4 sm:grid-cols-[1fr_2fr] sm:items-center">
        <div>
          <div className="text-2xs uppercase tracking-wide text-fg-subtle">
            {t('volatilityPanel.headline')}
          </div>
          <div
            className={
              'tabular mt-1 text-3xl font-semibold ' +
              (regimeTone === 'negative'
                ? 'text-rose-500'
                : regimeTone === 'warning'
                  ? 'text-amber-500'
                  : 'text-fg')
            }
          >
            {fmtPctRaw(analytics?.volatility30d ?? null)}
          </div>
          {regimeLabel && (
            <div
              className={
                'text-2xs ' +
                (regimeTone === 'negative'
                  ? 'text-rose-500'
                  : regimeTone === 'warning'
                    ? 'text-amber-500'
                    : 'text-fg-subtle')
              }
            >
              {regimeLabel}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-2">
          <Stat
            label={t('volatilityPanel.volatility30d')}
            value={fmtPctRaw(analytics?.volatility30d ?? null)}
          />
          <Stat
            label={t('volatilityPanel.maxDrawdown30d')}
            value={fmtPct(analytics?.maxDrawdown30d != null ? analytics.maxDrawdown30d * 100 : null)}
          />
        </dl>
      </div>
      <div className="mt-2 border-t border-border px-5 pt-4 text-2xs uppercase tracking-wide text-fg-subtle">
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