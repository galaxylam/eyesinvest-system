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

interface AccumulatedShortPositionChartProps {
  data: ShortSelling | null;
  /** Optional sync from the parent PriceChart's visible-range subscription. */
  visibleRange?: { from: string; to: string } | null;
  height?: number;
}

// `Intl.NumberFormat` is expensive to construct — cache one compact formatter
// for the short-interest (shares) pill.
const _compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
function formatSharesCompact(value: number | null): string {
  if (value == null) return '—';
  return _compactFmt.format(value);
}

/**
 * Accumulated short-position subplot. Y-axis is the FINRA-reported short
 * interest (shares outstanding) expressed as a percentage of total shares
 * outstanding — the standard "% of float shorted" metric.
 *
 * US: FINRA publishes bi-weekly settlements in `ey_short_interest`. Each
 * `ShortInterestPoint.shortInterest` becomes `shortInterest /
 * sharesOutstanding × 100` on the line.
 *
 * HK: same bi-weekly column is shared (SFC publishes to similar cadence).
 * The line still renders against `sharesOutstanding` for a consistent
 * y-axis across markets.
 *
 * The chart is locked to the Range picker — no drag/zoom — so it stays
 * in sync with PriceChart + the other subplots.
 *
 * Empty states:
 *   - sharesOutstanding missing → "Shares outstanding unavailable" pill.
 *   - no bi-weekly settlements → "No short-selling data yet" pill.
 */
export function AccumulatedShortPositionChart({
  data,
  visibleRange,
  height = 200,
}: AccumulatedShortPositionChartProps) {
  const t = useTranslations('stock.charts.accumulatedShort');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Bi-weekly short-interest as % of float. Each `ShortInterestPoint` is
  // a settlement-date snapshot; we map it to `shortInterest /
  // sharesOutstanding × 100`. Null when either input is missing so the
  // line skips the point rather than dropping to zero (which would imply
  // a sharp unwind the chart can't defend).
  const pctSeries = useMemo(() => {
    const shares = data?.sharesOutstanding ?? null;
    if (shares == null || shares <= 0) return [];
    return (data?.series.interest ?? [])
      .map((p) => {
        const pct = (p.shortInterest / shares) * 100;
        return {
          time: p.date as Time,
          value: +pct.toFixed(2),
        };
      });
  }, [data?.series.interest, data?.sharesOutstanding]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (pctSeries.length === 0) return;

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
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false },
      // Sub-charts are locked to the Range picker — disable direct
      // pan/zoom so they can never drift out of sync with the main
      // chart or each other.
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    // Purple to read as "official regulator filing" data, distinct from
    // the price line on the main chart above and from the green/rose
    // daily short-volume bars on the sibling chart.
    const line = chart.addLineSeries({
      color: '#a78bfa',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#a78bfa',
      crosshairMarkerBackgroundColor: '#a78bfa',
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
    });
    lineRef.current = line;
    line.setData(pctSeries);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
    };
  }, [pctSeries, height]);

  // Keep this subplot's visible window synced with the main chart's.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || pctSeries.length === 0) return;
    if (visibleRange != null) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }
  }, [visibleRange, pctSeries]);

  // ----- Empty states -----
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
  // No bi-weekly data — the worker hasn't shipped settlements yet.
  if (data.shortInterest == null) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-elevated px-4 text-2xs text-fg-muted"
        style={{ height }}
      >
        {t('noFloat')}
      </div>
    );
  }
  // No float denominator — can't compute % of float without shares outstanding.
  if (data.sharesOutstanding == null || data.sharesOutstanding <= 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-elevated px-4 text-2xs text-fg-muted"
        style={{ height }}
      >
        {t('noSharesOutstanding')}
      </div>
    );
  }

  const latestPct = pctSeries[pctSeries.length - 1]?.value ?? null;
  const changePct = data.shortInterestChangePct;
  const changeTone =
    changePct == null
      ? 'text-fg-subtle'
      : changePct > 0
        ? 'text-rose-500'
        : changePct < 0
          ? 'text-emerald-500'
          : 'text-fg-subtle';
  const dtc = data.daysToCover;

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
          {/* Headline: latest short interest as % of float — the y-axis value
              the chart is built around, surfaced as the biggest pill. */}
          {latestPct != null && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xs text-fg-subtle">{t('pctOfFloat')}</span>
              <span className="tabular font-mono text-base font-semibold text-fg">
                {latestPct.toFixed(2)}%
              </span>
            </div>
          )}
          {/* Latest short-interest (shares outstanding). */}
          {data.shortInterest != null && (
            <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
              <span className="text-2xs text-fg-subtle">{t('shortInt')}</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {formatSharesCompact(data.shortInterest)}
              </span>
            </div>
          )}
          {/* Days-to-cover — surfaces how many days of average volume would
              be needed to cover the current short position. Shared with the
              SqueezeCard so the two views agree. */}
          {dtc != null && (
            <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
              <span className="text-2xs text-fg-subtle">{t('dtc')}</span>
              <span className="tabular font-mono text-xs font-medium text-fg">
                {dtc.toFixed(1)}d
              </span>
            </div>
          )}
          {/* Change vs prior settlement. */}
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