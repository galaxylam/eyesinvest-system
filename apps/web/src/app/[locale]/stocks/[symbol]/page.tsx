import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getCrowdedRatio,
  getPriceRange52W,
  getPriceSeries,
  getQuote,
  getRelativeStrength,
  getShortSelling,
  getSqueeze,
  getStockAnalytics,
  getStockDetail,
  getStockFundamentals,
  getVolumeEfficiency,
  getVolumeSeries,
} from '@/lib/stocks/queries';
import { extractMaSeries } from '@/lib/format/ma';
import { AnalyticsPanel } from '@/components/stocks/AnalyticsPanel';
import { KeyStats } from '@/components/stocks/KeyStats';
import { RangePicker, type ChartRange } from '@/components/stocks/RangePicker';
import { StockChartStack } from '@/components/stocks/StockChartStack';
import { StockHeader } from '@/components/stocks/StockHeader';
import { SqueezeCard } from '@/components/stocks/SqueezeCard';
import { StockTabs } from '@/components/stocks/tabs/StockTabs';

interface StockPageProps {
  params: Promise<{ locale: string; symbol: string }>;
  searchParams: Promise<{ range?: string }>;
}

// ~3 years of trading days (3 * 252). Matches the worker's 3y history window
// so the chart + MA overlays always have the full history behind them, even
// when the user picks a short visible range like 1M.
const CHART_DAYS = 756;

// ?range= → visibleDays. Default '1Y' (= 252) so an unparameterized URL
// behaves the same as today.
const RANGE_DAYS: Record<ChartRange, number> = {
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
  '3Y': 756,
};

function parseRange(raw: string | undefined): ChartRange {
  if (raw === '1M' || raw === '3M' || raw === '6M' || raw === '3Y') return raw;
  return '1Y';
}

export default async function StockPage({ params, searchParams }: StockPageProps) {
  const { locale, symbol } = await params;
  const { range } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('stock');

  const decodedSymbol = decodeURIComponent(symbol);
  const currentRange = parseRange(range);

  const [
    detailRes,
    quoteRes,
    seriesRes,
    fundamentalsRes,
    rangeRes,
    analyticsRes,
    volumeRes,
    volumeEfficiencyRes,
    crowdedRatioRes,
    shortSellingRes,
    squeezeRes,
  ] = await Promise.all([
    getStockDetail(decodedSymbol),
    getQuote(decodedSymbol),
    getPriceSeries(decodedSymbol, { days: CHART_DAYS }),
    getStockFundamentals(decodedSymbol),
    getPriceRange52W(decodedSymbol),
    // Window matches the price series so the MA overlays span the full chart.
    getStockAnalytics(decodedSymbol, { days: CHART_DAYS }),
    getVolumeSeries(decodedSymbol, { days: CHART_DAYS }),
    // Full 3y window so the sub-chart covers any range-picker setting (1M…3Y).
    getVolumeEfficiency(decodedSymbol, { days: CHART_DAYS }),
    // Full 3y window so the sub-chart covers any range-picker setting (1M…3Y).
    getCrowdedRatio(decodedSymbol, { days: CHART_DAYS }),
    // FINRA: short-circuit upstream to null for HK stocks.
    getShortSelling(decodedSymbol, { days: CHART_DAYS }),
    // Phase 5 — short-squeeze score (single-day summary, no days window).
    getSqueeze(decodedSymbol),
  ]);

  const stock = detailRes.data;
  if (!stock) notFound();

  const quote = quoteRes.data;
  const series = seriesRes.data;
  const fundamentals = fundamentalsRes.data;
  const range52W = rangeRes.data;
  const analyticsSeries = analyticsRes.data;
  const volume = volumeRes.data;
  const volumeEfficiency = volumeEfficiencyRes.data;
  const crowdedRatio = crowdedRatioRes.data;
  const shortSelling = shortSellingRes.data;
  const squeeze = squeezeRes.data;
  const latestAnalytics = analyticsSeries[analyticsSeries.length - 1] ?? null;
  const maSeries = extractMaSeries(analyticsSeries);

  // RS depends on stock.market (only known after detailRes) — fetch
  // sequentially after the parallel block.
  const rsRes = await getRelativeStrength(decodedSymbol, {
    market: stock.market,
    quoteChangePercent: quote?.changePercent ?? null,
  });
  const rs = rsRes.data;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-3">
        <a
          href={`/${locale}/search`}
          className="inline-flex items-center text-xs text-fg-muted hover:text-fg"
        >
          ← {t('backToSearch')}
        </a>
      </div>

      <div className="space-y-4">
        <StockHeader
          symbol={stock.symbol}
          name={stock.name}
          market={stock.market}
          currency={stock.currency}
          exchange={stock.exchange}
          sector={stock.sector}
          aliases={stock.aliases}
          quote={quote}
        />

        <div className="flex items-center justify-end">
          <RangePicker current={currentRange} />
        </div>

        {/* PriceChart + sub-charts share one Range-picker-driven visible
            window. The main chart is freely zoomable on its own; the two
            sub-charts are locked to the same window via `visibleDays`
            so they can never drift out of sync. */}
        <StockChartStack
          symbol={stock.symbol}
          series={series?.bars}
          maSeries={maSeries}
          volumeEfficiency={volumeEfficiency}
          crowdedRatio={crowdedRatio}
          shortSelling={shortSelling}
          visibleDays={RANGE_DAYS[currentRange]}
        />

        <KeyStats currency={stock.currency} fundamentals={fundamentals} range52W={range52W} />

        <SqueezeCard squeeze={squeeze} />

        <AnalyticsPanel currency={stock.currency} analytics={latestAnalytics} />

        <StockTabs
          symbol={stock.symbol}
          currency={stock.currency}
          volume={volume}
          latestAnalytics={latestAnalytics}
          rs={rs}
          quote={quote}
        />
      </div>
    </div>
  );
}
