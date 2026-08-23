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

  const usable = useMemo(
    () =>
      (data?.series ?? [])
        .filter((p) => p.efficiency != null && p.dailyChangePct != null)
        .map((p) => ({
          time: p.date as Time,
          value: p.efficiency as number,
          change: p.dailyChangePct as number,
        })),
    [data?.series],
  );

  const mean = useMemo(() => {
    if (usable.length === 0) return 0;
    return usable.reduce((s, p) => s + p.value, 0) / usable.length;
  }, [usable]);

  const avg30 = data?.avgTurnoverPct30d != null && data?.turnoverPctToday != null
    ? // 30D avg turnover ÷ today turnover gives an "average efficiency"
      // comparison anchor; if turnover today is zero, fall back to 0.
      data.avgTurnoverPct30d === 0
        ? 0
        : data.turnoverPctToday / data.avgTurnoverPct30d
    : 0;

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

    // Dotted orange = current 30D average. Same shape (flat) so it shows
    // up as a horizontal reference across the chart.
    const avgLine = chart.addLineSeries({
      color: '#fb923c',
      lineWidth: 1,
      lineStyle: 3, // Dotted (large dash)
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
      crosshairMarkerVisible: false,
    });
    avg30Ref.current = avgLine;
    if (avg30 > 0) {
      avgLine.setData(
        usable.map((p) => ({ time: p.time, value: avg30 })),
      );
    } else {
      avgLine.setData([]);
    }

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
        {data && !data.hasFloatData
          ? 'Shares outstanding unavailable for this symbol.'
          : 'Need at least 2 days of price history.'}
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
          <h3 className="text-sm font-semibold text-fg">Volume efficiency</h3>
        </div>
        <div className="flex items-baseline gap-4">
          {avg30 > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-orange-400" aria-hidden />
              <span className="text-2xs text-fg-subtle">30D Avg</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {avg30.toFixed(3)}×
              </span>
            </div>
          )}
          <div className="flex items-baseline gap-2 border-l border-border pl-4">
            <span className="text-2xs text-fg-subtle">Avg green</span>
            <span className="tabular font-mono text-xs font-medium text-emerald-500">
              {greenAvg != null ? `${greenAvg.toFixed(3)}×` : '—'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xs text-fg-subtle">Avg red</span>
            <span className="tabular font-mono text-xs font-medium text-rose-500">
              {redAvg != null ? `${redAvg.toFixed(3)}×` : '—'}
            </span>
          </div>
          <div className="hidden items-baseline gap-2 border-l border-border pl-4 sm:flex">
            <span className="text-2xs text-fg-subtle">Today</span>
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
