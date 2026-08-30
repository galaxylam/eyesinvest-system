'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
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
   * Per-day MA5/MA20/MA50/MA200 time series from `getStockAnalytics()`. Each
   * window has its own toggle in the legend above the chart. When omitted
   * (e.g. synthetic-only preview) no MA lines render.
   */
  maSeries?: MaSeries;
  /**
   * If set, the chart's time scale only shows the most recent `visibleDays`
   * bars (e.g. 21 for 1M, 252 for 1Y). All MA data is still rendered so MA200
   * stays meaningful within the visible window. When undefined the chart
   * fits all available data.
   *
   * After the initial render the user is free to pan/zoom freely; the
   * sub-charts in `StockChartStack` are locked to this same value via
   * the Range picker so they always re-sync when it changes.
   */
  visibleDays?: number;
}

const MA_COLORS: Record<MaKey, string> = {
  ma5: '#f472b6',
  ma20: '#fbbf24',
  ma50: '#60a5fa',
  ma200: '#a78bfa',
};

const DEFAULT_VISIBLE: Record<MaKey, boolean> = {
  ma5: false,
  ma20: true,
  ma50: true,
  ma200: false,
};

// Look-back window (trading days) used to find the "highest volume day
// close" — that's what we draw as the dashed support line. 20 matches
// the screener's breakout/breakdown filter so both views agree on the
// same threshold value.
const SUPPORT_WINDOW = 20;

// Accent for the support line + its legend pill. Orange keeps it
// visually distinct from the MA overlays (pink / amber / blue / violet).
const SUPPORT_LINE_COLOR = '#fb923c'; // orange-400

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
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const maLineRefs = useRef<Partial<Record<MaKey, ISeriesApi<'Line'>>>>({});
  // Latest computed support price — kept in a ref so the toggle effect can
  // (re-)create the price line without rebuilding the chart.
  const supportPriceRef = useRef<number | null>(null);
  const supportLineRef = useRef<IPriceLine | null>(null);

  const [visible, setVisible] = useState<Record<MaKey, boolean>>(DEFAULT_VISIBLE);
  // Whether the dashed support line is currently rendered on the chart.
  const [supportVisible, setSupportVisible] = useState(true);
  // Mirror `supportVisible` into a ref so the chart-build effect can read
  // the latest value without needing to re-run on every toggle (we handle
  // toggling in a separate effect below — see its comment).
  const supportVisibleRef = useRef(supportVisible);
  useEffect(() => {
    supportVisibleRef.current = supportVisible;
  }, [supportVisible]);

  // Find the highest-volume trading day within the last `SUPPORT_WINDOW`
  // bars and return its close. `null` when there's no data. Memoised so the
  // chart effect doesn't have to re-run when the user just toggles the
  // legend pill.
  const supportPrice = useMemo<number | null>(() => {
    const bars = series ?? [];
    if (bars.length === 0) return null;
    const window = bars.slice(-SUPPORT_WINDOW);
    let bestIdx = 0;
    let bestVol = -Infinity;
    for (let i = 0; i < window.length; i++) {
      const v = window[i]?.volume ?? 0;
      if (v > bestVol) {
        bestVol = v;
        bestIdx = i;
      }
    }
    return window[bestIdx]?.close ?? null;
  }, [series]);

  // Track the latest support price in a ref so the visibility-toggle
  // effect can (re-)create the price line on the existing chart without
  // requiring the chart effect to re-run.
  useEffect(() => {
    supportPriceRef.current = supportPrice;
  }, [supportPrice]);

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
        attributionLogo: false,
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
      // Mobile UX: a single-finger drag on the chart would otherwise
      // hijack the page's vertical scroll. Disable touch-drag panning
      // so vertical drag falls through to page scroll; keep pinch
      // (two-finger) zoom and the desktop mouse interactions intact.
      // The chart container's `touch-action: pan-y` style (below) is the
      // other half — without it, lightweight-charts' default
      // `touch-action: none` would still swallow the events at the
      // browser level.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: false,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
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
    candleSeriesRef.current = priceSeries;

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

    // ===== Dashed support line (highest-volume-20d close) =====
    // `createPriceLine` mutates the candle series in place — the line is
    // re-created whenever the underlying `series` changes (this effect
    // tears the chart down on each rebuild, so we just add it fresh each
    // time). Visibility is gated by the separate effect below so toggling
    // the legend pill doesn't force a chart rebuild. We read the
    // visibility through a ref so this effect's deps stay focused on the
    // inputs that should actually force a rebuild.
    if (supportPrice != null && supportVisibleRef.current) {
      supportLineRef.current = priceSeries.createPriceLine({
        price: supportPrice,
        color: SUPPORT_LINE_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: t('chart.support'),
      });
    } else {
      supportLineRef.current = null;
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      maLineRefs.current = {};
      supportLineRef.current = null;
    };
  }, [symbol, height, series, visibleDays, supportPrice, t]);

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

  // Toggle the dashed support line without rebuilding the chart.
  // `series.removePriceLine(line)` is the lightweight-charts way to undo
  // `series.createPriceLine(...)` — no chart re-creation needed.
  useEffect(() => {
    const series = candleSeriesRef.current;
    const line = supportLineRef.current;
    if (!series) return;
    if (line) {
      series.removePriceLine(line);
      supportLineRef.current = null;
    }
    if (supportVisible) {
      const price = supportPriceRef.current;
      if (price != null) {
        supportLineRef.current = series.createPriceLine({
          price,
          color: SUPPORT_LINE_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: t('chart.support'),
        });
      }
    }
  }, [supportVisible, t]);

  const labels: Record<MaKey, string> = {
    ma5: t('chart.ma5'),
    ma20: t('chart.ma20'),
    ma50: t('chart.ma50'),
    ma200: t('chart.ma200'),
  };

  // Single source of truth for the support-pill button. Rendered inside
  // the MA legend when MAs are available, or inside a standalone toolbar
  // when the chart falls back to the synthetic series (no MA data).
  const supportPill = (
    <button
      type="button"
      onClick={() => setSupportVisible((v) => !v)}
      aria-pressed={supportVisible}
      title={t('chart.supportHint')}
      className={
        'focus-ring inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 font-mono text-2xs uppercase tracking-wide transition-opacity ' +
        (supportVisible
          ? 'bg-bg-elevated text-fg opacity-100'
          : 'bg-bg-elevated text-fg-muted opacity-50 hover:opacity-100')
      }
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-full"
        style={{
          backgroundColor: SUPPORT_LINE_COLOR,
          opacity: supportVisible ? 1 : 0.4,
        }}
      />
      {t('chart.support')}
    </button>
  );

  return (
    <div className="rounded-md border border-border bg-bg-elevated p-2">
      {maSeries ? (
        <ChartOverlayLegend
          visible={visible}
          onToggle={(key) =>
            setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
          }
          labels={labels}
          extra={supportPill}
        />
      ) : (
        <div className="flex items-center gap-2 px-1 pb-2 pt-1">{supportPill}</div>
      )}
      <div ref={containerRef} className="w-full" style={{ height, touchAction: 'pan-y' }} />
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