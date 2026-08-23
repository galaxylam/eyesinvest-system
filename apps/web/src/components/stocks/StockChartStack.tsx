'use client';

import { useMemo } from 'react';
import type { MaSeries } from '@/lib/format/ma';
import type { PriceBar } from '@eyesinvest/types';
import type { CrowdedRatio, VolumeEfficiency } from '@/lib/stocks/queries';
import { PriceChart } from './PriceChart';
import { VolumeEfficiencyChart } from './VolumeEfficiencyChart';
import { CrowdedRatioChart } from './CrowdedRatioChart';

interface StockChartStackProps {
  symbol: string;
  series?: PriceBar[];
  maSeries?: MaSeries;
  volumeEfficiency: VolumeEfficiency | null;
  crowdedRatio: CrowdedRatio | null;
  /**
   * How many trailing trading days the visible window should span.
   * Driven by the Range picker (1M=21 / 3M=63 / 6M=126 / 1Y=252 /
   * 3Y=756). All three charts read this single source of truth, so the
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
  visibleDays,
  chartHeight = 360,
  subchartHeight = 180,
}: StockChartStackProps) {
  // Convert trailing-N-days into an absolute {from, to} range pinned
  // to the last data point in each sub-chart's series. This is the
  // single source of truth that both sub-charts apply via
  // `setVisibleRange()` on mount and whenever visibleDays changes.
  const visibleRange = useMemo<
    { from: string; to: string } | null
  >(() => {
    const candidates = [
      ...(volumeEfficiency?.series ?? []).map((p) => p.date),
      ...(crowdedRatio?.series ?? []).map((p) => p.date),
    ];
    if (candidates.length === 0) return null;
    const sorted = [...new Set(candidates)].sort();
    const last = sorted[sorted.length - 1];
    if (!last) return null;
    const cutoff = sorted[Math.max(0, sorted.length - visibleDays)];
    if (!cutoff) return null;
    return { from: cutoff, to: last };
  }, [volumeEfficiency?.series, crowdedRatio?.series, visibleDays]);

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
    </div>
  );
}