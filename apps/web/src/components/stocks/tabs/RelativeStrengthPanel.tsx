import { getLocale, getTranslations } from 'next-intl/server';
import type { Quote } from '@eyesinvest/types';
import type { RelativeStrength } from '@/lib/stocks/queries';
import { formatSignedPercent } from '@/lib/format/quote';
import { Sparkline } from '@/components/ui/Sparkline';
import { Stat } from './Stat';

interface RelativeStrengthPanelProps {
  rs: RelativeStrength | null;
  /** Latest quote, shown for context (last price + change %). */
  quote: Quote | null;
}

/** 'en' → 'En', 'zh-HK' → 'ZhHk', 'zh-CN' → 'ZhCn'. Matches `MARKET_INDICES` name* keys. */
function localeNameSuffix(locale: string): 'En' | 'ZhHk' | 'ZhCn' {
  if (locale.startsWith('zh-HK')) return 'ZhHk';
  if (locale.startsWith('zh-CN')) return 'ZhCn';
  return 'En';
}

/**
 * Relative Strength tab panel.
 *
 * Session RS (stock change − benchmark change today) is the only meaningful
 * comparison we can make: `ey_index_quote` is a single-row-per-index snapshot
 * with no per-window history, so subtracting today's benchmark from a 1m/3m/6m/1y
 * stock return gives a value with no usable interpretation. We surface that
 * limitation in `rsNote` and confine the comparison to the session.
 *
 * Stock return tiles (1m/3m/6m/1y) are still shown without a benchmark so the
 * panel remains a useful single-glance read on trailing performance.
 */
export async function RelativeStrengthPanel({ rs, quote }: RelativeStrengthPanelProps) {
  const t = await getTranslations('stock');
  const locale = await getLocale();
  const suffix = localeNameSuffix(locale);
  const indexName = rs
    ? rs.indexName[suffix === 'En' ? 'en' : suffix === 'ZhHk' ? 'zhHk' : 'zhCn']
    : '';

  const fmtPct = (v: number | null | undefined): string =>
    v == null ? '—' : formatSignedPercent(v, locale);

  // Sparkline: today's session as a 2-point indicator (open → close via
  // last + change_percent) — honest placeholder until per-window index
  // history is stored.
  const sparklineData =
    quote != null && Number.isFinite(quote.lastPrice) && Number.isFinite(quote.change)
      ? [
          { time: 'open', value: quote.lastPrice - quote.change },
          { time: 'now', value: quote.lastPrice },
        ]
      : [];

  const rsTone =
    rs?.rsSession == null
      ? undefined
      : rs.rsSession > 0
        ? 'positive'
        : rs.rsSession < 0
          ? 'negative'
          : 'neutral';

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-fg">
          {t('relativeStrengthPanel.panelTitle', { indexName })}
        </h3>
        <p className="mt-0.5 text-xs text-fg-subtle">{t('relativeStrengthPanel.rsNote')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 px-5 pt-4 sm:grid-cols-[1fr_2fr] sm:items-stretch">
        {/* LEFT — Benchmark snapshot (name, today's change, session sparkline) */}
        <div className="flex flex-col">
          <div className="text-2xs uppercase tracking-wide text-fg-subtle">
            {t('relativeStrengthPanel.indexHeader')}
          </div>
          <div className="tabular mt-1 text-2xl font-semibold text-fg">
            {rs ? rs.indexCode : '—'}
          </div>
          <div className="text-xs text-fg-muted">
            {t('relativeStrengthPanel.indexChange', {
              indexName,
              pct: fmtPct(rs?.indexChangePercent ?? null),
            })}
          </div>
          <div className="mt-2">
            <Sparkline
              data={sparklineData}
              width={160}
              height={32}
              ariaLabel={t('relativeStrengthPanel.sparklineNote')}
            />
            <div className="mt-0.5 text-2xs text-fg-subtle">
              {t('relativeStrengthPanel.sparklineNote')}
            </div>
          </div>
        </div>

        {/* RIGHT — Session RS, the only windowed comparison we can honestly make */}
        <div className="flex flex-col rounded-md border border-border bg-bg-muted px-4 py-3">
          <div className="text-2xs uppercase tracking-wide text-fg-subtle">
            {t('relativeStrengthPanel.sessionRsLabel')}
          </div>
          <div
            className={
              'tabular mt-1 text-3xl font-semibold ' +
              (rsTone === 'positive'
                ? 'text-emerald-500'
                : rsTone === 'negative'
                  ? 'text-rose-500'
                  : 'text-fg')
            }
          >
            {fmtPct(rs?.rsSession ?? null)}
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            {t('relativeStrengthPanel.sessionRsVs', {
              stockPct: fmtPct(quote?.changePercent ?? null),
              indexName,
              indexPct: fmtPct(rs?.indexChangePercent ?? null),
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 border-t border-border px-5 pt-4 text-2xs uppercase tracking-wide text-fg-subtle">
        Stock returns
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4">
        <Stat label={t('relativeStrengthPanel.stockReturn1m')} value={fmtPct(rs?.stockReturn1m ?? null)} />
        <Stat label={t('relativeStrengthPanel.stockReturn3m')} value={fmtPct(rs?.stockReturn3m ?? null)} />
        <Stat label={t('relativeStrengthPanel.stockReturn6m')} value={fmtPct(rs?.stockReturn6m ?? null)} />
        <Stat label={t('relativeStrengthPanel.stockReturn1y')} value={fmtPct(rs?.stockReturn1y ?? null)} />
      </dl>
    </section>
  );
}