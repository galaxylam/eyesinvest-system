'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useTranslations } from 'next-intl';
import type { ShortSelling } from '@/lib/stocks/queries';

interface ShortSellingChartProps {
  data: ShortSelling | null;
  /** Optional sync from the parent PriceChart's visible-range subscription. */
  visibleRange?: { from: string; to: string } | null;
  height?: number;
}

// Threshold above which today's short % is rendered rose rather than emerald.
// 50% is the eyeballed "elevated" line — matches CrowdedRatioChart's color
// language so a user trained on that subplot doesn't need a new mental model.
const ELEVATED_PCT = 50;

// HK-only: AM share-of-full-day threshold above which the ratio pill tints
// amber. 40–55% is normal for the morning session; >60% tilts toward an
// elevated day and is worth surfacing.
const ELEVATED_AM_RATIO_PCT = 60;

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
 * US short-selling subplot under the main PriceChart. Two layers:
 *
 *   1. Histogram of daily Reg-SHO short % of volume on the secondary
 *      right scale (0–100%). Emerald below 50%, rose at-or-above.
 *   2. Bi-weekly short-interest line (shares outstanding) on the primary
 *      right scale. Sparse points are connected by the line — FINRA only
 *      publishes bi-weekly settlement snapshots.
 *
 * Header pills surface the latest daily + bi-weekly KPIs without
 * crowding the chart.
 *
 * The chart is locked to the Range picker — no drag/zoom — so it stays
 * in sync with PriceChart + the other subplots.
 *
 * HK stocks and other no-data cases fall through to the dashed empty state.
 */
export function ShortSellingChart({
  data,
  visibleRange,
  height = 200,
}: ShortSellingChartProps) {
  const t = useTranslations('stock.charts.shortSelling');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const hkFullDayRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const hkAmRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const isHK = data?.market === 'HK';

  // US: daily short-volume % per trading day, ascending.
  const sale = useMemo(
    () =>
      (data?.series.sale ?? [])
        .filter((p) => p.shortPctOfVolume != null)
        .map((p) => ({
          time: p.date as Time,
          value: p.shortPctOfVolume as number,
        })),
    [data?.series.sale],
  );

  // HK: full-day short-volume absolute shares, ascending. Filter to > 0 so
  // the mid-day "AM-only, full-day not yet out" state renders no amber bar.
  const hkFullDay = useMemo(
    () =>
      isHK
        ? (data?.series.sale ?? [])
            .filter((p) => p.shortVolume > 0)
            .map((p) => ({ time: p.date as Time, value: p.shortVolume }))
        : [],
    [data?.series.sale, isHK],
  );

  // HK: morning-session overlay. Only renders when both AM is published
  // AND full-day has been written (so we have a reference scale); this
  // prevents a 50K-share AM bar from looking massive on a still-empty day.
  const hkAm = useMemo(
    () =>
      isHK
        ? (data?.series.sale ?? [])
            .filter(
              (p) =>
                p.amShortVolume != null &&
                p.shortVolume > 0,
            )
            .map((p) => ({
              time: p.date as Time,
              value: p.amShortVolume as number,
            }))
        : [],
    [data?.series.sale, isHK],
  );

  // Bi-weekly short-interest points in ascending order. Sparse is fine —
  // the line connects gaps between settlement dates.
  const interest = useMemo(
    () =>
      (data?.series.interest ?? []).map((p) => ({
        time: p.date as Time,
        value: p.shortInterest,
      })),
    [data?.series.interest],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (sale.length === 0 && hkFullDay.length === 0 && hkAm.length === 0 && interest.length === 0) return;

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

    // ===== US: Daily Reg-SHO histogram (% of volume, 0–100%) =====
    // Lives on the secondary right scale so it can't conflict with the
    // bi-weekly share-count line on the primary scale.
    if (sale.length > 0) {
      const hist = chart.addHistogramSeries({
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        priceScaleId: 'shortPct',
        color: '#10b981',
      });
      histRef.current = hist;
      hist.setData(
        sale.map((p) => ({
          time: p.time,
          value: p.value,
          color:
            p.value >= ELEVATED_PCT
              ? 'rgba(244, 63, 94, 0.55)'
              : 'rgba(16, 185, 129, 0.55)',
        })),
      );
      chart.priceScale('shortPct').applyOptions({
        scaleMargins: { top: 0.05, bottom: 0.05 },
        borderVisible: false,
        // Force the 0–100% scale so a quiet stock's tiny bars don't get
        // auto-scaled up and visually overstate the activity.
        autoScale: false,
      });
      // Anchor the secondary scale to 0–100 once we have data on it.
      hist.applyOptions({
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    // ===== HK: Full-day absolute short-volume + AM overlay (own right scale) =====
    // Two histograms share `shortVol` so the AM bar overlays the full-day
    // bar from the bottom. The primary right scale is free for the bi-weekly
    // short-interest line below.
    if (hkFullDay.length > 0) {
      const fullDaySeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'shortVol',
        color: HK_FULL_DAY_COLOR,
      });
      hkFullDayRef.current = fullDaySeries;
      fullDaySeries.setData(hkFullDay);
      chart.priceScale('shortVol').applyOptions({
        scaleMargins: { top: 0.05, bottom: 0.05 },
        borderVisible: false,
      });
      fullDaySeries.applyOptions({
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }
    if (hkAm.length > 0) {
      const amSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'shortVol',
        color: HK_AM_COLOR,
      });
      hkAmRef.current = amSeries;
      amSeries.setData(hkAm);
      amSeries.applyOptions({
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    // ===== Bi-weekly short-interest line (primary right scale) =====
    // Purple to read as "official regulator filing" data, distinct from
    // the price line on the main chart above.
    if (interest.length > 0) {
      const line = chart.addLineSeries({
        color: '#a78bfa',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: '#a78bfa',
        crosshairMarkerBackgroundColor: '#a78bfa',
        pointMarkersVisible: true,
        pointMarkersRadius: 3,
      });
      lineRef.current = line;
      line.setData(interest);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      histRef.current = null;
      lineRef.current = null;
      hkFullDayRef.current = null;
      hkAmRef.current = null;
    };
  }, [sale, interest, hkFullDay, hkAm, height]);

  // Keep this subplot's visible window synced with the main chart's.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (
      sale.length === 0 &&
      hkFullDay.length === 0 &&
      hkAm.length === 0 &&
      interest.length === 0
    ) {
      return;
    }
    if (visibleRange != null) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }
  }, [visibleRange, sale, hkFullDay, hkAm, interest]);

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
  // Stock returned but the worker hasn't shipped any rows yet — different
  // per-market so we surface a quiet "noFloat" rather than the chart frame.
  const hasAnyData =
    (data.market === 'HK'
      ? data.todayShortVolume != null ||
        data.todayAmShortVolume != null ||
        data.shortInterest != null
      : data.todayShortPctOfVolume != null || data.shortInterest != null);
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
  const changePct = data.shortInterestChangePct;
  const changeTone =
    changePct == null
      ? 'text-fg-subtle'
      : changePct > 0
        ? 'text-rose-500'
        : changePct < 0
          ? 'text-emerald-500'
          : 'text-fg-subtle';

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
          {/* Daily KPI — today's short-volume ratio (% of FINRA volume). */}
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
          {/* HK-only AM-session KPI — short volume + ratio pill. Tints amber
              when the AM share of the full day crosses ELEVATED_AM_RATIO_PCT
              so the user can see disproportionate morning activity before the
              day's close. */}
          {data.market === 'HK' && data.todayAmShortVolume != null && (
            <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
              <span className="text-2xs text-fg-subtle">{t('amVol')}</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {formatSharesCompact(data.todayAmShortVolume)}
              </span>
              {data.todayAmPctOfFullDay != null && (
                <span
                  className={
                    data.todayAmPctOfFullDay > ELEVATED_AM_RATIO_PCT
                      ? 'rounded bg-amber-500/20 px-1.5 py-0.5 text-2xs tabular text-amber-400'
                      : 'rounded bg-bg px-1.5 py-0.5 text-2xs tabular text-fg-muted'
                  }
                  title={t('amSession')}
                >
                  {t('amRatio', {
                    pct: `${data.todayAmPctOfFullDay.toFixed(0)}%`,
                  })}
                </span>
              )}
            </div>
          )}
          {/* Bi-weekly KPI — latest short-interest (outstanding shares). */}
          {data.shortInterest != null && (
            <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
              <span className="text-2xs text-fg-subtle">{t('shortInt')}</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {formatSharesCompact(data.shortInterest)}
              </span>
            </div>
          )}
          {/* Bi-weekly KPI — change vs prior settlement. */}
          {changePct != null && (
            <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
              <span className="text-2xs text-fg-subtle">{t('change')}</span>
              <span className={`tabular font-mono text-xs font-medium ${changeTone}`}>
                {changePct > 0 ? '+' : ''}
                {changePct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height, touchAction: 'pan-y' }} />
    </section>
  );
}