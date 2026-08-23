import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getPriceRange52W,
  getPriceSeries,
  getQuote,
  getRelativeStrength,
  getStockAnalytics,
  getStockDetail,
  getStockFundamentals,
  getVolumeSeries,
} from '@/lib/stocks/queries';
import { extractMaSeries } from '@/lib/format/ma';
import { AnalyticsPanel } from '@/components/stocks/AnalyticsPanel';
import { KeyStats } from '@/components/stocks/KeyStats';
import { PriceChart } from '@/components/stocks/PriceChart';
import { StockHeader } from '@/components/stocks/StockHeader';
import { StockTabs } from '@/components/stocks/tabs/StockTabs';

interface StockPageProps {
  params: Promise<{ locale: string; symbol: string }>;
}

// ~3 years of trading days (3 * 252). Matches the worker's 3y history window
// so the chart + MA overlays span the full price history.
const CHART_DAYS = 756;

export default async function StockPage({ params }: StockPageProps) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('stock');

  const decodedSymbol = decodeURIComponent(symbol);
  const [detailRes, quoteRes, seriesRes, fundamentalsRes, rangeRes, analyticsRes, volumeRes] =
    await Promise.all([
      getStockDetail(decodedSymbol),
      getQuote(decodedSymbol),
      getPriceSeries(decodedSymbol, { days: CHART_DAYS }),
      getStockFundamentals(decodedSymbol),
      getPriceRange52W(decodedSymbol),
      // Window matches the price series so the MA overlays span the full chart.
      getStockAnalytics(decodedSymbol, { days: CHART_DAYS }),
      getVolumeSeries(decodedSymbol, { days: CHART_DAYS }),
    ]);

  const stock = detailRes.data;
  if (!stock) notFound();

  const quote = quoteRes.data;
  const series = seriesRes.data;
  const fundamentals = fundamentalsRes.data;
  const range52W = rangeRes.data;
  const analyticsSeries = analyticsRes.data;
  const volume = volumeRes.data;
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

        <PriceChart
          symbol={stock.symbol}
          series={series?.bars}
          maSeries={maSeries}
        />

        <KeyStats currency={stock.currency} fundamentals={fundamentals} range52W={range52W} />

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
