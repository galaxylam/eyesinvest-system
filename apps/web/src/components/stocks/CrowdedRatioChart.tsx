'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { CrowdedRatio } from '@/lib/stocks/queries';

interface CrowdedRatioChartProps {
  data: CrowdedRatio | null;
  /** Optional sync from PriceChart's visible-range subscription. */
  visibleRange?: { from: string; to: string } | null;
  height?: number;
}

/**
 * Client-side lightweight-charts implementation of the crowded-ratio
 * subgraph. Layout mirrors the reference image:
 *
 *   - Solid blue ratio line, with green / red dot markers per data point
 *     (rising dot = green, falling dot = red, flat = muted).
 *   - Four horizontal threshold lines:
 *       2.0× dashed gray   — extreme crowding
 *       1.5× dashed red    — crowded regime (shaded region above)
 *       1.2× dashed orange — warm / elevated
 *       1.0× solid black   — baseline
 *   - Shaded red region where ratio > 1.5 (the "crowded period" band).
 *
 * Accepts `visibleRange` from PriceChart's subscription so the x-axis
 * zooms and pans in lockstep with the main chart.
 */
export function CrowdedRatioChart({
  data,
  visibleRange,
  height = 200,
}: CrowdedRatioChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const baselineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const avgRef = useRef<ISeriesApi<'Line'> | null>(null);

  const usable = useMemo(
    () =>
      (data?.series ?? [])
        .filter((p) => p.ratio != null)
        .map((p) => ({
          time: p.date as Time,
          value: p.ratio as number,
        })),
    [data?.series],
  );

  const avg = useMemo(() => {
    if (usable.length === 0) return 1;
    return usable.reduce((s, p) => s + p.value, 0) / usable.length;
  }, [usable]);

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

    // ===== Ratio line (solid blue, with colored markers) =====
    const line = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#3b82f6',
      crosshairMarkerBackgroundColor: '#3b82f6',
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
    });
    lineRef.current = line;

    // Color each dot marker by trend vs the previous data point so the
    // user can see direction at a glance (rising=green, falling=red).
    const colored: LineData[] = usable.map((p, i) => {
      const prev = i > 0 ? usable[i - 1]?.value : undefined;
      const next = i < usable.length - 1 ? usable[i + 1]?.value : undefined;
      const dir =
        prev != null && next != null
          ? next > p.value
            ? 'down'
            : next < p.value
              ? 'up'
              : 'flat'
          : prev != null
            ? p.value >= prev
              ? 'up'
              : 'down'
            : 'flat';
      const markerColor =
        dir === 'up'
          ? '#10b981' // emerald
          : dir === 'down'
            ? '#f43f5e' // rose
            : '#94a3b8'; // muted slate
      return {
        time: p.time,
        value: p.value,
        color: markerColor,
      };
    });
    line.setData(colored);

    // ===== Threshold horizontal lines =====
    // 2.0× — dashed gray (extreme crowding ceiling)
    line.createPriceLine({
      price: 2.0,
      color: '#6b7280',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '2.0×',
    });
    // 1.0× — solid black baseline
    const baseline = chart.addLineSeries({
      color: '#0a0a0a',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
      crosshairMarkerVisible: false,
    });
    baselineRef.current = baseline;
    baseline.setData(
      usable.map((p) => ({ time: p.time, value: 1.0 })),
    );

    // ===== Subtle average line (dashed blue) =====
    const avgLine = chart.addLineSeries({
      color: '#60a5fa',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
      crosshairMarkerVisible: false,
    });
    avgRef.current = avgLine;
    if (avg > 0) {
      avgLine.setData(
        usable.map((p) => ({ time: p.time, value: avg })),
      );
    } else {
      avgLine.setData([]);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
      baselineRef.current = null;
      avgRef.current = null;
    };
  }, [usable, avg, height]);

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

  if (!data || usable.length < 30) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-elevated px-4 text-2xs text-fg-muted"
        style={{ height }}
      >
        Need at least 30 days of price history to compute MA30 baseline.
      </div>
    );
  }

  const ratio = data.ratio;
  const tone =
    ratio == null
      ? 'text-fg'
      : ratio >= 1.5
        ? 'text-rose-500'
        : ratio >= 1.2
          ? 'text-amber-500'
          : ratio >= 1.0
            ? 'text-emerald-500'
            : 'text-fg-muted';

  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-fg">Crowded ratio</h3>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xs text-fg-subtle">Today</span>
          <span className={`tabular font-mono text-base font-semibold ${tone}`}>
            {ratio != null ? `${ratio.toFixed(2)}×` : '—'}
          </span>
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height }} />
    </section>
  );
}