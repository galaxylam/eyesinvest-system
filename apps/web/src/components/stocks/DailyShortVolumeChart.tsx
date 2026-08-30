'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useTranslations } from 'next-intl';
import type { ShortSelling } from '@/lib/stocks/queries';

interface DailyShortVolumeChartProps {
  data: ShortSelling | null;
  /** Optional sync from the parent PriceChart's visible-range subscription. */
  visibleRange?: { from: string; to: string } | null;
  height?: number;
}

// Threshold above which today's short % is rendered rose rather than emerald.
// 50% is the eyeballed "elevated" line — matches the prior chart's color
// language so a user trained on it doesn't need a new mental model.
const ELEVATED_PCT = 50;

// HK bar colors — distinct from the US palette so a user can read at a
// glance which market they're on. Amber = full day, emerald = AM overlay
// (chosen to read as "partial / provisional" against the amber backdrop).
const HK_FULL_DAY_COLOR = 'rgba(245, 158, 11, 0.55)';
const HK_AM_COLOR = 'rgba(16, 185, 129, 0.85)';

// `Intl.NumberFormat` is expensive to construct — cache one compact formatter
// for the short-volume (shares) pill.
const _compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
function formatSharesCompact(value: number | null): string {
  if (value == null) return '—';
  return _compactFmt.format(value);
}

/**
 * Daily short-selling subplot under the main PriceChart. Y-axis is the
 * ratio of short volume to total trading volume on each day
 * (shortPctOfVolume = shortVolume / totalVolume × 100), expressed as a
 * percent for both US and HK on a single shared right scale.
 *
 * For US, totalVolume comes from FINRA's Reg-SHO daily file. For HK,
 * HKEX doesn't publish it, so the query layer falls back to
 * `ey_price_1d.volume` (the same number, just sourced from the price
 * series). The y-axis is therefore a uniform "what % of today's volume
 * was short" across markets.
 *
 * Two histogram layers share the percent scale:
 *   1. Full-day bar: shortVolume / totalVolume × 100. Emerald below 50%,
 *      rose at-or-above.
 *   2. AM-session overlay (HK only): amShortVolume / totalVolume × 100,
 *      drawn from the bottom of the full-day bar so the green portion
 *      visualises what fraction of today's total volume was shorted
 *      during the morning session.
 *
 * The chart is locked to the Range picker — no drag/zoom — so it stays
 * in sync with PriceChart + the other subplots.
 */
export function DailyShortVolumeChart({
  data,
  visibleRange,
  height = 200,
}: DailyShortVolumeChartProps) {
  const t = useTranslations('stock.charts.dailyShort');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const fullDayRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const amRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const isHK = data?.market === 'HK';

  // Full-day bar: shortPctOfVolume per trading day, ascending. Shared
  // scale across US + HK — the y-axis reads "what % of today's volume
  // was short" identically on both markets.
  const fullDay = useMemo(
    () =>
      (data?.series.sale ?? [])
        .filter((p) => p.shortPctOfVolume != null && p.shortVolume > 0)
        .map((p) => {
          const pct = p.shortPctOfVolume as number;
          return {
            time: p.date as Time,
            value: pct,
            color:
              isHK
                ? HK_FULL_DAY_COLOR
                : pct >= ELEVATED_PCT
                  ? 'rgba(244, 63, 94, 0.55)'
                  : 'rgba(16, 185, 129, 0.55)',
          };
        }),
    [data?.series.sale, isHK],
  );

  // HK AM-session overlay: amShortVolume / totalVolume × 100. Drawn from
  // the bottom of the full-day bar so the green portion reads as
  // "morning share of today's total volume".
  const am = useMemo(
    () =>
      isHK
        ? (data?.series.sale ?? [])
            .filter(
              (p) =>
                p.amShortVolume != null &&
                p.shortVolume > 0 &&
                p.shortPctOfVolume != null &&
                p.totalVolume > 0,
            )
            .map((p) => ({
              time: p.date as Time,
              value: +((p.amShortVolume as number) / p.totalVolume * 100).toFixed(2),
            }))
        : [],
    [data?.series.sale, isHK],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (fullDay.length === 0 && am.length === 0) return;

    const chart = createChart(container, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#1f2937', style: 3 },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false },
      // Sub-charts are locked to the Range picker — disable direct
      // pan/zoom so they can never drift out of sync with the main
      // chart or each other.
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    // Single shared percent scale — full-day bar and AM overlay both
    // render against it so a 50% full-day bar with a 25% AM overlay
    // means "half of today's volume was short, half of that happened
    // before noon".
    const shortPctScale = chart.priceScale('shortPct');
    shortPctScale.applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.05 },
      borderVisible: false,
      autoScale: true,
      // Custom-named scales don't inherit `layout.textColor` —
      // set it explicitly so the tick labels render in the same
      // muted-grey the rest of the chart uses.
      textColor: '#9ca3af',
    });

    if (fullDay.length > 0) {
      const fullDaySeries = chart.addHistogramSeries({
        priceFormat: { type: 'percent', precision: 1, minMove: 0.1 },
        priceScaleId: 'shortPct',
        color: '#10b981',
      });
      fullDayRef.current = fullDaySeries;
      fullDaySeries.setData(
        fullDay.map((p) => ({ time: p.time, value: p.value, color: p.color })),
      );
      fullDaySeries.applyOptions({
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }
    if (am.length > 0) {
      const amSeries = chart.addHistogramSeries({
        priceFormat: { type: 'percent', precision: 1, minMove: 0.1 },
        priceScaleId: 'shortPct',
        color: HK_AM_COLOR,
      });
      amRef.current = amSeries;
      amSeries.setData(am);
      amSeries.applyOptions({
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      fullDayRef.current = null;
      amRef.current = null;
    };
  }, [fullDay, am, height]);

  // Keep this subplot's visible window synced with the main chart's.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (fullDay.length === 0 && am.length === 0) return;
    if (visibleRange != null) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }
  }, [visibleRange, fullDay, am]);

  // ----- Empty states -----
  // No data at all (e.g. unsupported market, stock not in universe).
  if (data == null) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-elevated px-4 text-2xs text-fg-muted"
        style={{ height }}
      >
        {t('empty')}
      </div>
    );
  }
  // Stock returned but the worker hasn't shipped any rows yet.
  const hasAnyData =
    data.todayShortPctOfVolume != null ||
    data.todayShortVolume != null ||
    data.todayAmShortVolume != null;
  if (!hasAnyData) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-elevated px-4 text-2xs text-fg-muted"
        style={{ height }}
      >
        {t('noFloat')}
      </div>
    );
  }

  const todayPct = data.todayShortPctOfVolume;
  const todayTone =
    todayPct == null
      ? 'text-fg-subtle'
      : todayPct >= ELEVATED_PCT
        ? 'text-rose-500'
        : 'text-emerald-500';

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-fg">{t('title')}</h3>
          <span className="hidden text-2xs text-fg-subtle sm:inline">
            {t('subtitle')}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {/* Daily KPI — today's short-volume ratio (% of total volume). */}
          {todayPct != null && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xs text-fg-subtle">{t('today')}</span>
              <span className={`tabular font-mono text-base font-semibold ${todayTone}`}>
                {todayPct.toFixed(1)}%
              </span>
            </div>
          )}
          {/* Daily KPI — today's short-volume amount (shares). */}
          {data.todayShortVolume != null && (
            <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
              <span className="text-2xs text-fg-subtle">{t('dailyAmount')}</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {formatSharesCompact(data.todayShortVolume)}
              </span>
            </div>
          )}
          {/* HK AM-session pill — surfaces the AM share as a % of today's
              total volume so the user sees the same unit the chart is
              plotted against. Tints amber when the AM share crosses 60%. */}
          {data.market === 'HK' &&
              data.todayAmShortVolume != null &&
              data.todayShortPctOfVolume != null &&
              data.todayTotalVolume != null &&
              data.todayTotalVolume > 0 && (
                <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
                  <span className="text-2xs text-fg-subtle">{t('amVol')}</span>
                  <span className="tabular font-mono text-xs font-medium text-fg">
                    {formatSharesCompact(data.todayAmShortVolume)}
                  </span>
                  {(() => {
                    const amPct = (data.todayAmShortVolume / data.todayTotalVolume) * 100;
                    return (
                      <span
                        className={
                          amPct > 60
                            ? 'rounded bg-amber-500/20 px-1.5 py-0.5 text-2xs tabular text-amber-400'
                            : 'rounded bg-bg px-1.5 py-0.5 text-2xs tabular text-fg-muted'
                        }
                        title={t('amSession')}
                      >
                        {t('amRatio', {
                          pct: `${amPct.toFixed(0)}%`,
                        })}
                      </span>
                    );
                  })()}
                </div>
              )}
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height, touchAction: 'pan-y' }} />
    </section>
  );
}