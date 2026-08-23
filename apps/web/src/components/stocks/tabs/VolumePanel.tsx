import { getLocale, getTranslations } from 'next-intl/server';
import type { VolumeSeries } from '@/lib/stocks/queries';
import { formatSignedPercent, formatVolume } from '@/lib/format/quote';
import { Stat } from './Stat';
import { VolumeChart } from './VolumeChart';

interface VolumePanelProps {
  currency: string;
  symbol: string;
  volume: VolumeSeries | null;
}

/**
 * Volume tab panel — daily histogram plus 4 stat tiles (latest, 30d avg,
 * 90d avg, window high). Aggregates are derived in `getVolumeSeries` from
 * `ey_price_1d`. The combination metrics (Volume Efficiency + Crowded
 * Ratio) now live as dedicated sub-charts directly below the main
 * PriceChart on the stock page; this panel is intentionally raw-volume
 * focused.
 */
export async function VolumePanel({
  currency,
  symbol,
  volume,
}: VolumePanelProps) {
  const t = await getTranslations('stock');
  const locale = await getLocale();

  const headline =
    volume?.aggregates.latestVs30dPct == null
      ? '—'
      : formatSignedPercent(volume.aggregates.latestVs30dPct, locale);
  const headlineTone =
    volume?.aggregates.latestVs30dPct == null
      ? undefined
      : volume.aggregates.latestVs30dPct > 0
        ? 'positive'
        : volume.aggregates.latestVs30dPct < 0
          ? 'negative'
          : 'neutral';

  const latest =
    volume != null && volume.daily.length > 0
      ? volume.daily[volume.daily.length - 1]
      : null;

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-fg">{t('volumePanel.panelTitle')}</h3>
        <p className="mt-0.5 text-xs text-fg-subtle">{t('volumePanel.note')}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 px-5 pt-4 sm:grid-cols-[2fr_3fr] sm:items-center">
        <div>
          <div className="text-2xs uppercase tracking-wide text-fg-subtle">
            {t('volumePanel.headline')}
          </div>
          <div
            className={
              'tabular mt-1 text-3xl font-semibold ' +
              (headlineTone === 'positive'
                ? 'text-emerald-500'
                : headlineTone === 'negative'
                  ? 'text-rose-500'
                  : 'text-fg')
            }
          >
            {headline}
          </div>
          <div className="text-2xs text-fg-subtle">
            {currency} · {volume?.aggregates.maxDate ?? '—'}
          </div>
        </div>
        <VolumeChart symbol={symbol} bars={volume?.daily ?? []} />
      </div>
      <dl className="mt-2 grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-4">
        <Stat
          label={t('volumePanel.latestVolume')}
          value={formatVolume(latest?.volume ?? null, locale)}
        />
        <Stat
          label={t('volumePanel.avg30d')}
          value={formatVolume(volume?.aggregates.avg30d ?? null, locale)}
        />
        <Stat
          label={t('volumePanel.avg90d')}
          value={formatVolume(volume?.aggregates.avg90d ?? null, locale)}
        />
        <Stat
          label={t('volumePanel.maxInWindow')}
          value={formatVolume(volume?.aggregates.maxInWindow ?? null, locale)}
          sub={
            volume?.aggregates.maxDate
              ? t('volumePanel.maxDate', { date: volume.aggregates.maxDate })
              : undefined
          }
        />
      </dl>
    </section>
  );
}