'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';

interface VolumeBar {
  date: string;
  close: number;
  volume: number;
}

interface VolumeChartProps {
  symbol: string;
  bars: VolumeBar[];
  height?: number;
}

/**
 * Volume histogram for the Volume tab. Reuses lightweight-charts already in
 * the bundle; bars are coloured by the day's direction (close ≥ previous
 * close = emerald, otherwise rose). No legend — the tab already names the
 * metric.
 */
export function VolumeChart({ symbol, bars, height = 180 }: VolumeChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#1f2937', style: 3 },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const series = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'right',
    });
    seriesRef.current = series;

    const data = bars.map((b, i) => {
      const prev = i > 0 ? bars[i - 1]?.close : b.close;
      const up = b.close >= (prev ?? b.close);
      return {
        time: b.date as Time,
        value: b.volume,
        color: up ? '#10b981' : '#f43f5e',
      };
    });
    series.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [bars, symbol]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      role="img"
      aria-label={`Volume histogram for ${symbol}`}
      className="w-full"
    />
  );
}