import { getTranslations } from 'next-intl/server';
import { cn } from '@eyesinvest/ui';
import type { SqueezeRegime, SqueezeScore } from '@/lib/stocks/types';

interface SqueezeCardProps {
  squeeze: SqueezeScore | null;
}

/**
 * Render a single stock's short-squeeze score + breakdown. Lives on the
 * stock detail page above `AnalyticsPanel` so the always-on single-day
 * signal is visible alongside the long-window technical indicators.
 *
 * Falsy `squeeze` or `squeeze.score === null` renders an "unavailable"
 * state — no synthetic 0, no misleading bar.
 */
export async function SqueezeCard({ squeeze }: SqueezeCardProps) {
  const t = await getTranslations('stock.squeezePanel');

  if (!squeeze || squeeze.score == null) {
    return (
      <section className="rounded-md border border-border bg-bg-elevated p-5">
        <h2 className="text-sm font-semibold text-fg">{t('title')}</h2>
        <p className="mt-2 text-xs text-fg-muted">{t('unavailable')}</p>
      </section>
    );
  }

  const regimeLabel = t(
    squeeze.regime === 'high'
      ? 'regimeHigh'
      : squeeze.regime === 'elevated'
        ? 'regimeElevated'
        : squeeze.regime === 'normal'
          ? 'regimeNormal'
          : squeeze.regime === 'low'
            ? 'regimeLow'
            : 'regimeUnknown',
  );

  const regimeTone = REGIME_TONE[squeeze.regime ?? 'null'];
  const barTone = REGIME_BAR[squeeze.regime ?? 'normal'];
  // 20-cell inline progress bar — fill ratio = score/5 (each cell = 5 points).
  const filled = Math.round(squeeze.score / 5);

  return (
    <section className="rounded-md border border-border bg-bg-elevated p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{t('title')}</h2>
        <p className="text-2xs text-fg-subtle">
          {t('subtitle', { date: squeeze.asOfDate ?? '—' })}
        </p>
      </header>

      <div className="mt-3 flex items-center gap-3">
        <div className="tabular text-2xl font-semibold text-fg">
          {Math.round(squeeze.score)}
          <span className="ml-1 text-sm font-normal text-fg-muted">/ 100</span>
        </div>
        <span
          className={cn(
            'rounded bg-bg-muted px-2 py-0.5 text-xs font-medium',
            regimeTone,
          )}
        >
          {regimeLabel}
        </span>
      </div>

      {/* Inline progress bar — 20 cells, each = 5 score points */}
      <div className="mt-3 flex gap-0.5" aria-hidden>
        {Array.from({ length: 20 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-sm',
              i < filled ? barTone : 'bg-bg-muted',
            )}
          />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4">
        <BreakdownStat
          label={t('dtc')}
          value={
            squeeze.daysToCover != null
              ? squeeze.daysToCover.toFixed(1)
              : '—'
          }
          hint={t('dtcHint')}
        />
        <BreakdownStat
          label={t('siChg1w')}
          value={
            squeeze.siChangePct1w != null
              ? `${squeeze.siChangePct1w >= 0 ? '+' : ''}${squeeze.siChangePct1w.toFixed(1)}%`
              : '—'
          }
          hint={t('siChg1wHint')}
          tone={
            squeeze.siChangePct1w != null && squeeze.siChangePct1w > 0
              ? 'rose'
              : 'neutral'
          }
        />
        <BreakdownStat
          label={t('drawdown')}
          value={
            squeeze.drawdown30d != null
              ? `${(squeeze.drawdown30d * 100).toFixed(1)}%`
              : '—'
          }
          hint={t('drawdownHint')}
          tone={
            squeeze.drawdown30d != null && squeeze.drawdown30d < -0.10
              ? 'rose'
              : 'neutral'
          }
        />
        <BreakdownStat
          label={t('volSpike')}
          value={
            squeeze.volumeSpike != null
              ? `${squeeze.volumeSpike.toFixed(2)}×`
              : '—'
          }
          hint={t('volSpikeHint')}
          tone={
            squeeze.volumeSpike != null && squeeze.volumeSpike > 2
              ? 'amber'
              : 'neutral'
          }
        />
        {/* HK-only AM share row — spans full width when present */}
        {squeeze.amRatio != null && (
          <BreakdownStat
            className="col-span-2 sm:col-span-4"
            label={t('amRatio')}
            value={`${squeeze.amRatio.toFixed(0)}%`}
            hint={t('amRatioHint')}
            tone={squeeze.amRatio > 60 ? 'amber' : 'neutral'}
          />
        )}
      </dl>
    </section>
  );
}

const REGIME_TONE: Record<SqueezeRegime | 'null', string> = {
  high: 'text-rose-500',
  elevated: 'text-amber-500',
  normal: 'text-fg',
  low: 'text-fg-muted',
  null: 'text-fg-muted',
};

const REGIME_BAR: Record<SqueezeRegime, string> = {
  high: 'bg-rose-500',
  elevated: 'bg-amber-500',
  normal: 'bg-fg',
  low: 'bg-fg-muted',
};

function BreakdownStat({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'rose' | 'amber' | 'neutral';
  className?: string;
}) {
  const toneClass =
    tone === 'rose' ? 'text-rose-500' : tone === 'amber' ? 'text-amber-500' : 'text-fg';
  return (
    <div className={cn('flex flex-col gap-0.5 p-3', className)}>
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={cn('tabular text-sm font-medium', toneClass)}>{value}</dd>
      <dd className="text-2xs text-fg-subtle">{hint}</dd>
    </div>
  );
}