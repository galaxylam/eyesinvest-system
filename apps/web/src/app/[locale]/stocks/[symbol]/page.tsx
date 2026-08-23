import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getPriceRange52W,
  getPriceSeries,
  getQuote,
  getStockAnalytics,
  getStockDetail,
  getStockFundamentals,
} from '@/lib/stocks/queries';
import { extractMaSeries } from '@/lib/format/ma';
import { AnalyticsPanel } from '@/components/stocks/AnalyticsPanel';
import { KeyStats } from '@/components/stocks/KeyStats';
import { PriceChart } from '@/components/stocks/PriceChart';
import { StockHeader } from '@/components/stocks/StockHeader';

interface StockPageProps {
  params: Promise<{ locale: string; symbol: string }>;
}

const CHART_DAYS = 252;

export default async function StockPage({ params }: StockPageProps) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('stock');

  const decodedSymbol = decodeURIComponent(symbol);
  const [detailRes, quoteRes, seriesRes, fundamentalsRes, rangeRes, analyticsRes] =
    await Promise.all([
      getStockDetail(decodedSymbol),
      getQuote(decodedSymbol),
      getPriceSeries(decodedSymbol, { days: CHART_DAYS }),
      getStockFundamentals(decodedSymbol),
      getPriceRange52W(decodedSymbol),
      // Window matches the price series so the MA overlays span the full chart.
      getStockAnalytics(decodedSymbol, { days: CHART_DAYS }),
    ]);

  const stock = detailRes.data;
  if (!stock) notFound();

  const quote = quoteRes.data;
  const series = seriesRes.data;
  const fundamentals = fundamentalsRes.data;
  const range52W = rangeRes.data;
  const analyticsSeries = analyticsRes.data;
  const latestAnalytics = analyticsSeries[analyticsSeries.length - 1] ?? null;
  const maSeries = extractMaSeries(analyticsSeries);

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

        <section className="rounded-md border border-border bg-bg-elevated p-5">
          <h2 className="text-sm font-semibold text-fg">{t('tabsTitle')}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-fg-muted sm:grid-cols-4">
            <li>{t('tab.overview')}</li>
            <li>{t('tab.technical')}</li>
            <li>{t('tab.volume')}</li>
            <li>{t('tab.relativeStrength')}</li>
            <li>{t('tab.shortSelling')}</li>
            <li>{t('tab.volatility')}</li>
            <li>{t('tab.news')}</li>
            <li>{t('tab.ai')}</li>
          </ul>
          <p className="mt-4 text-xs text-fg-subtle">{t('tabsPhase1Note')}</p>
        </section>
      </div>
    </div>
  );
}
