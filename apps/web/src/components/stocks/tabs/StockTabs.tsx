import { getTranslations } from 'next-intl/server';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@eyesinvest/ui';
import type { Quote, StockAnalytics } from '@eyesinvest/types';
import type {
  RelativeStrength,
  VolumeSeries,
} from '@/lib/stocks/queries';
import { ComingSoonPanel } from './ComingSoonPanel';
import { RelativeStrengthPanel } from './RelativeStrengthPanel';
import { VolatilityPanel } from './VolatilityPanel';
import { VolumePanel } from './VolumePanel';

interface StockTabsProps {
  symbol: string;
  currency: string;
  volume: VolumeSeries | null;
  /** Latest row of the analytics series, already fetched on the page. */
  latestAnalytics: StockAnalytics | null;
  rs: RelativeStrength | null;
  quote: Quote | null;
}

/**
 * Tabbed panel surface for the stock detail page. Replaces the static
 * `<ul>` placeholder that previously rendered the 8 tab labels. Three real
 * data tabs (Volume / Volatility / Relative Strength) and four "Coming soon"
 * tabs share a single visual rhythm via `<ComingSoonPanel>`.
 *
 * `defaultValue="volume"` makes the Volume tab — which carries the headline
 * chart plus the Volume Efficiency + Crowded Ratio sub-graphs — the
 * surface the user sees on first load. The chart + KeyStats +
 * AnalyticsPanel sections above stay visible regardless of tab choice.
 */
export async function StockTabs({
  symbol,
  currency,
  volume,
  latestAnalytics,
  rs,
  quote,
}: StockTabsProps) {
  const t = await getTranslations('stock');

  return (
    <section className="rounded-md border border-border bg-bg-elevated p-5">
      <h2 className="text-sm font-semibold text-fg">{t('tabsTitle')}</h2>

      <Tabs defaultValue="volume" className="mt-3">
        <div className="overflow-x-auto">
          <TabsList className="flex w-max min-w-full sm:w-auto">
            <TabsTrigger value="overview">{t('tab.overview')}</TabsTrigger>
            <TabsTrigger value="technical">{t('tab.technical')}</TabsTrigger>
            <TabsTrigger value="volume">{t('tab.volume')}</TabsTrigger>
            <TabsTrigger value="relativeStrength">
              {t('tab.relativeStrength')}
            </TabsTrigger>
            <TabsTrigger value="shortSelling">{t('tab.shortSelling')}</TabsTrigger>
            <TabsTrigger value="volatility">{t('tab.volatility')}</TabsTrigger>
            <TabsTrigger value="news">{t('tab.news')}</TabsTrigger>
            <TabsTrigger value="ai">{t('tab.ai')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <p className="mt-2 text-xs text-fg-muted">{t('tabsPhase1Note')}</p>
        </TabsContent>

        <TabsContent value="technical">
          <ComingSoonPanel tabKey="technical" />
        </TabsContent>

        <TabsContent value="volume">
          <VolumePanel
            currency={currency}
            symbol={symbol}
            volume={volume}
          />
        </TabsContent>

        <TabsContent value="volatility">
          <VolatilityPanel analytics={latestAnalytics} />
        </TabsContent>

        <TabsContent value="relativeStrength">
          <RelativeStrengthPanel rs={rs} quote={quote} />
        </TabsContent>

        <TabsContent value="shortSelling">
          <ComingSoonPanel tabKey="shortSelling" />
        </TabsContent>

        <TabsContent value="news">
          <ComingSoonPanel tabKey="news" />
        </TabsContent>

        <TabsContent value="ai">
          <ComingSoonPanel tabKey="ai" />
        </TabsContent>
      </Tabs>
    </section>
  );
}