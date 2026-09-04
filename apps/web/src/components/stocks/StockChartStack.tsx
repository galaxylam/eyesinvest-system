'use client';

import { useMemo } from 'react';
import type { MaSeries } from '@/lib/format/ma';
import type { PriceBar } from '@eyesinvest/types';
import type { CrowdedRatio, ShortSelling, VolumeEfficiency } from '@/lib/stocks/queries';
import { PriceChart } from './PriceChart';
import { VolumeEfficiencyChart } from './VolumeEfficiencyChart';
import { CrowdedRatioChart } from './CrowdedRatioChart';
import { DailyShortVolumeChart } from './DailyShortVolumeChart';
import { AccumulatedShortPositionChart } from './AccumulatedShortPositionChart';

interface StockChartStackProps {
  symbol: string;
  series?: PriceBar[];
  maSeries?: MaSeries;
  volumeEfficiency: VolumeEfficiency | null;
  crowdedRatio: CrowdedRatio | null;
  /** FINRA short-selling payload. US-only; null for HK and un-shipped data. */
  shortSelling: ShortSelling | null;
  /**
   * How many trailing trading days the visible window should span.
   * Driven by the Range picker (1M=21 / 3M=63 / 6M=126 / 1Y=252 /
   * 3Y=756). All four charts read this single source of truth, so the
   * user can never drag one out of sync with the others.
   */
  visibleDays: number;
  chartHeight?: number;
  subchartHeight?: number;
}

/**
 * Stacks the main PriceChart with two time-aligned sub-charts (Volume
 * Efficiency + Crowded Ratio) and locks all three on a single visible
 * window driven by the Range picker.
 *
 * - The main PriceChart is fully draggable / zoomable on its own. Its
 *   `visibleDays` prop seeds the initial window but is then free to
 *   follow the user's pan/zoom gestures.
 * - The two sub-charts have `handleScroll: false` and `handleScale:
 *   false` so the user can't drag or zoom them independently. They
 *   always reflect the `visibleDays` value passed in from the picker,
 *   which guarantees they re-sync whenever the picker changes.
 */
export function StockChartStack({
  symbol,
  series,
  maSeries,
  volumeEfficiency,
  crowdedRatio,
  shortSelling,
  visibleDays,
  chartHeight = 360,
  subchartHeight = 180,
}: StockChartStackProps) {
  // Convert trailing-N-days into an absolute {from, to} range pinned
  // to the last data point in `volumeEfficiency.series` only. This is
  // intentional: `ey_stock_analytics.green_red_volume_share_1m` is computed
  // by the worker as a strict trailing-21-row window on `ey_price_1d`, so
  // using only the volume-efficiency series (which is derived from the same
  // OHLCV source) keeps the page's 1M greenShare pill in sync with both the
  // screener's persisted value and the worker's rolling window.
  //
  // Using the union of all four series (short interest, crowded ratio, etc.)
  // would drift the cutoff date because those series have different date
  // coverage — short interest is bi-weekly (settlement dates), crowded
  // ratio has MA30 gaps, FINRA data lands on US trading days only — causing
  // the page's window to be shorter or longer than 21 trading days, which
  // makes the green share diverge from what the screener shows.
  const visibleRange = useMemo<
    { from: string; to: string } | null
  >(() => {
    const dates = (volumeEfficiency?.series ?? [])
      .map((p) => p.date as string)
      .filter(Boolean);
    if (dates.length === 0) return null;
    const sorted = dates.sort();
    const last = sorted[sorted.length - 1];
    if (!last) return null;
    const cutoff = sorted[Math.max(0, sorted.length - visibleDays)];
    if (!cutoff) return null;
    return { from: cutoff, to: last };
  }, [volumeEfficiency?.series, visibleDays]);

  return (
    <div className="flex flex-col gap-3">
      <PriceChart
        symbol={symbol}
        series={series}
        maSeries={maSeries}
        height={chartHeight}
        visibleDays={visibleDays}
      />
      <VolumeEfficiencyChart
        data={volumeEfficiency}
        height={subchartHeight}
        visibleRange={visibleRange}
      />
      <CrowdedRatioChart
        data={crowdedRatio}
        height={subchartHeight}
        visibleRange={visibleRange}
      />
      <DailyShortVolumeChart
        data={shortSelling}
        height={subchartHeight}
        visibleRange={visibleRange}
      />
      <AccumulatedShortPositionChart
        data={shortSelling}
        height={subchartHeight}
        visibleRange={visibleRange}
      />
    </div>
  );
}