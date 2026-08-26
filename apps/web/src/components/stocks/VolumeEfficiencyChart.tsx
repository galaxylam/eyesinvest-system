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
import { formatRatio } from '@/lib/format/quote';
import type { VolumeEfficiency } from '@/lib/stocks/queries';

interface VolumeEfficiencyChartProps {
  data: VolumeEfficiency | null;
  /** Optional sync from PriceChart's visible-range subscription. */
  visibleRange?: { from: string; to: string } | null;
  height?: number;
}

/**
 * Inline-SVG replacement that mirrors the reference image: bars colored by
 * the sign of dailyChangePct (green when the stock closed higher than it
 * opened, red when lower), with two average reference lines:
 *   - Dashed blue: the entire-series mean of efficiency
 *   - Dotted orange: 30-day rolling average (current value plotted as a
 *     flat horizontal line for comparison)
 *
 * Mirrors `PriceChart`'s time-axis so the subplot stays in sync when the
 * main chart zooms or pans.
 */
export function VolumeEfficiencyChart({
  data,
  visibleRange,
  height = 200,
}: VolumeEfficiencyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const meanRef = useRef<ISeriesApi<'Line'> | null>(null);
  const avg30Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const t = useTranslations('stock.charts.volumeEfficiency');

  const usable = useMemo(
    () =>
      (data?.series ?? [])
        .filter((p) => p.efficiency != null && p.dailyChangePct != null)
        .map((p) => ({
          time: p.date as Time,
          value: p.efficiency as number,
          change: p.dailyChangePct as number,
          volume: p.volume,
        })),
    [data?.series],
  );

  const mean = useMemo(() => {
    if (usable.length === 0) return 0;
    return usable.reduce((s, p) => s + p.value, 0) / usable.length;
  }, [usable]);

  // 30D Avg = mean of turnoverPct over the last 30 days (independent of
  // the visible picker window — the label is "30D", not "in window").
  // Uses the per-day `turnoverPct` already on each EfficiencyPoint.
  const avg30 = useMemo(() => {
    if (!data) return null;
    const last30 = data.series
      .filter((p) => p.turnoverPct != null)
      .slice(-30);
    if (last30.length === 0) return null;
    const sum = last30.reduce((s, p) => s + (p.turnoverPct as number), 0);
    return sum / last30.length;
  }, [data]);

  // Scope all stats to the visible picker window so the green/red bar
  // averages always reflect "this 1M / 3M / 6M / 1Y / 3Y slice" rather
  // than the full 3y series.
  const windowed = useMemo(() => {
    if (!visibleRange) return usable;
    const { from, to } = visibleRange;
    return usable.filter((p) => p.time >= from && p.time <= to);
  }, [usable, visibleRange]);

  // Mean efficiency of days where price closed up (green bars) and down
  // (red bars). Returns null when there are no qualifying days in the
  // visible window — e.g. a 1M window may have no down days.
  const greenAvg = useMemo(() => {
    const greens = windowed.filter((p) => p.change >= 0);
    if (greens.length === 0) return null;
    return greens.reduce((s, p) => s + p.value, 0) / greens.length;
  }, [windowed]);

  const redAvg = useMemo(() => {
    const reds = windowed.filter((p) => p.change < 0);
    if (reds.length === 0) return null;
    return reds.reduce((s, p) => s + p.value, 0) / reds.length;
  }, [windowed]);

  // Sum-based share of total volume on up-days (sibling to the avg-based
  // green/red ratio pills above). Sum-based weights high-volume days
  // more heavily than the avg-based ratio. Computed inline from the
  // `windowed` series so the pill tracks the visible picker range, same
  // as `greenAvg` / `redAvg`. Dojis (change == 0) are excluded.
  //
  // Signed encoding mirrors the worker's `_green_red_volume_share_1m`:
  // positive when green dominant (magnitude = green share), negative
  // when red dominant (magnitude = red share). The 1M picker uses a
  // 21-day window, so this value matches `signedShare1m` (and the
  // screener) within floating-point noise — the displayed rounded
  // percent is the same.
  const greenShare = useMemo(() => {
    let greenSum = 0;
    let redSum = 0;
    for (const p of windowed) {
      if (p.volume == null) continue;
      if (p.change > 0) greenSum += p.volume;
      else if (p.change < 0) redSum += p.volume;
    }
    const total = greenSum + redSum;
    if (total <= 0) return null;
    const gs = greenSum / total;
    return gs >= 0.5 ? gs : -(1 - gs);
  }, [windowed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || usable.length === 0) return;

    const chart = createChart(container, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#1f2937', style: 3 },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false },
      // Sub-charts are locked to the Range picker — disable direct
      // pan/zoom so they can never drift out of sync with the main
      // chart or each other.
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const hist = chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceScaleId: 'right',
      color: '#10b981',
    });
    histRef.current = hist;
    hist.setData(
      usable.map((p) => ({
        time: p.time,
        value: p.value,
        color: p.change >= 0 ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)',
      })),
    );

    // Dashed blue = full-series mean. Plot as a flat line across the data.
    const meanLine = chart.addLineSeries({
      color: '#60a5fa',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
      crosshairMarkerVisible: false,
    });
    meanRef.current = meanLine;
    meanLine.setData(
      usable.map((p) => ({ time: p.time, value: mean })),
    );

    // The 30D avg turnover is now shown only as a header pill (it lives on
    // a different unit scale than the efficiency bars, so plotting it as
    // a horizontal line on this axis would mislead). The dashed-blue
    // mean-of-efficiency reference above is the only overlay.

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      histRef.current = null;
      meanRef.current = null;
      avg30Ref.current = null;
    };
  }, [usable, mean, avg30, height]);

  // Keep this subplot's visible window synced with the main chart's.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || usable.length === 0) return;
    if (visibleRange != null) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }
  }, [visibleRange, usable]);

  if (!data || !data.hasFloatData || usable.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-elevated px-4 text-2xs text-fg-muted"
        style={{ height }}
      >
        {data && !data.hasFloatData ? t('noFloat') : t('notEnoughHistory')}
      </div>
    );
  }

  const eff = data.efficiencyToday;
  const toneClass =
    eff == null
      ? 'text-fg'
      : eff >= 2
        ? 'text-emerald-500'
        : eff >= 1
          ? 'text-fg'
          : 'text-fg-muted';

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-fg">{t('title')}</h3>
        </div>
        <div className="flex items-baseline gap-4">
          {avg30 != null && (
            <div className="flex items-baseline gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-orange-400" aria-hidden />
              <span className="text-2xs text-fg-subtle">{t('turnover30d')}</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {avg30.toFixed(3)}%
              </span>
            </div>
          )}
          <div className="flex items-baseline gap-2 border-l border-border pl-4">
            <span className="text-2xs text-fg-subtle">{t('avgGreen')}</span>
            <span className="tabular font-mono text-xs font-medium text-emerald-500">
              {greenAvg != null ? `${greenAvg.toFixed(3)}×` : '—'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xs text-fg-subtle">{t('avgRed')}</span>
            <span className="tabular font-mono text-xs font-medium text-rose-500">
              {redAvg != null ? `${redAvg.toFixed(3)}×` : '—'}
            </span>
          </div>
          <div className="flex items-baseline gap-2 border-l border-border pl-4">
            <span className="text-2xs text-fg-subtle">{t('greenShare')}</span>
            <span
              className={`tabular font-mono text-xs font-medium ${
                greenShare == null
                  ? 'text-fg-subtle'
                  : greenShare > 0
                    ? 'text-emerald-500'
                    : greenShare < 0
                      ? 'text-rose-500'
                      : 'text-fg-subtle'
              }`}
            >
              {greenShare != null
                ? `${greenShare > 0 ? '+' : ''}${(greenShare * 100).toFixed(1)}%`
                : '—'}
            </span>
          </div>
          <div className="hidden items-baseline gap-2 border-l border-border pl-4 sm:flex">
            <span className="text-2xs text-fg-subtle">{t('today')}</span>
            <span className={`tabular font-mono text-base font-semibold ${toneClass}`}>
              {formatRatio(eff)}
            </span>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height }} />
    </section>
  );
}
