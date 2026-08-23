'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import { useTranslations } from 'next-intl';
import type { PriceBar } from '@eyesinvest/types';
import type { MaSeries } from '@/lib/format/ma';
import { ChartOverlayLegend, type MaKey } from './ChartOverlayLegend';

interface PriceChartProps {
  symbol: string;
  height?: number;
  /**
   * Real OHLC bars from `getPriceSeries()`. When omitted, falls back to a
   * deterministic synthetic series so previews / Storybook still render.
   */
  series?: PriceBar[];
  /**
   * Per-day MA20/MA50/MA200 time series from `getStockAnalytics()`. Each
   * window has its own toggle in the legend above the chart. When omitted
   * (e.g. synthetic-only preview) no MA lines render.
   */
  maSeries?: MaSeries;
  /**
   * If set, the chart's time scale only shows the most recent `visibleDays`
   * bars (e.g. 21 for 1M, 252 for 1Y). All MA data is still rendered so MA200
   * stays meaningful within the visible window. When undefined the chart
   * fits all available data.
   */
  visibleDays?: number;
}

const MA_COLORS: Record<MaKey, string> = {
  ma20: '#fbbf24',
  ma50: '#60a5fa',
  ma200: '#a78bfa',
};

const DEFAULT_VISIBLE: Record<MaKey, boolean> = {
  ma20: true,
  ma50: true,
  ma200: false,
};

/**
 * Candlestick chart for the stock detail page. Prefers the `series` prop
 * when supplied (real OHLC from the yfinance worker); otherwise generates
 * a deterministic synthetic series seeded by the symbol.
 *
 * Layout:
 *   - Top ~75%: candlestick price series (open / high / low / close)
 *               + optional MA20 / MA50 / MA200 line overlays (same scale)
 *   - Bottom ~25%: volume histogram, green on up days, red on down days
 *
 * Toggling an MA in the legend above the chart mutates the line series
 * data in place — the chart itself is never destroyed.
 */
export function PriceChart({
  symbol,
  height = 360,
  series,
  maSeries,
  visibleDays,
}: PriceChartProps) {
  const t = useTranslations('stock');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const maLineRefs = useRef<Partial<Record<MaKey, ISeriesApi<'Line'>>>>({});

  const [visible, setVisible] = useState<Record<MaKey, boolean>>(DEFAULT_VISIBLE);

  // Build / tear down the chart whenever symbol, height, or the underlying
  // price series changes. MA line series are added here too — visibility
  // toggles are handled in the second effect below.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.3)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.3)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
      height,
    });

    // ===== Candlestick price series (top 75%) =====
    const priceSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceScaleId: 'right',
    });
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });

    // ===== Volume histogram (separate scale, bottom 25%) =====
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      color: 'rgba(148, 163, 184, 0.4)',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // ===== MA line overlays (same 'right' scale as candles) =====
    (Object.keys(MA_COLORS) as MaKey[]).forEach((key) => {
      const line = chart.addLineSeries({
        color: MA_COLORS[key],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        priceScaleId: 'right',
        crosshairMarkerVisible: false,
      });
      maLineRefs.current[key] = line;
    });

    const candleData: {
      time: Time;
      open: number;
      high: number;
      low: number;
      close: number;
    }[] = [];
    const volumeData: { time: Time; value: number; color: string }[] = [];

    if (series && series.length > 0) {
      for (const b of series) {
        candleData.push({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        });
        const up = b.close >= b.open;
        volumeData.push({
          time: b.time as Time,
          value: b.volume,
          color: up ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)',
        });
      }
    } else {
      candleData.push(...generateSyntheticSeries(symbol));
    }

    priceSeries.setData(candleData);
    if (volumeData.length > 0) volumeSeries.setData(volumeData);

    // Default: fit everything. If the caller asked for a visible window
    // (e.g. ?range=1M), constrain the time scale to the most recent N
    // bars — but leave all data + MA values in place so the visible region
    // is correctly rendered.
    if (visibleDays && candleData.length > 0) {
      const last = candleData[candleData.length - 1];
      const first = candleData[Math.max(0, candleData.length - visibleDays)];
      if (first && last) {
        chart.timeScale().setVisibleRange({ from: first.time, to: last.time });
      } else {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
    }

    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      maLineRefs.current = {};
    };
  }, [symbol, height, series, visibleDays]);

  // Toggle MA line data without recreating the chart.
  useEffect(() => {
    (Object.keys(MA_COLORS) as MaKey[]).forEach((key) => {
      const line = maLineRefs.current[key];
      if (!line) return;
      if (!maSeries || !visible[key]) {
        line.setData([]);
        return;
      }
      const data: LineData[] = maSeries[key].map((p) => ({
        time: p.time as Time,
        value: p.value,
      }));
      line.setData(data);
    });
  }, [visible, maSeries]);

  const labels: Record<MaKey, string> = {
    ma20: t('chart.ma20'),
    ma50: t('chart.ma50'),
    ma200: t('chart.ma200'),
  };

  return (
    <div className="rounded-md border border-border bg-bg-elevated p-2">
      {maSeries && (
        <ChartOverlayLegend
          visible={visible}
          onToggle={(key) =>
            setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
          }
          labels={labels}
        />
      )}
      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  );
}

/**
 * Inline deterministic synthetic OHLC series for layout preview when no
 * real data is available. Kept here (not in `mock-data.ts`) because it's
 * purely a chart fallback — the data layer should never see this.
 */
function generateSyntheticSeries(symbol: string, days = 252) {
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;
  }

  function rng() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const startPrice = 50 + rng() * 200;
  const trend = (rng() - 0.5) * 0.0015;
  const vol = 0.018 + rng() * 0.012;
  const data: {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
  }[] = [];
  let prevClose = startPrice;
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const dateStr = d.toISOString().slice(0, 10) as Time;
    const shock = (rng() - 0.5) * vol;
    const open = prevClose;
    const close = Math.max(0.5, open * (1 + trend + shock));
    const high = Math.max(open, close) * (1 + rng() * 0.005);
    const low = Math.min(open, close) * (1 - rng() * 0.005);
    data.push({
      time: dateStr,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
    prevClose = close;
  }

  return data;
}