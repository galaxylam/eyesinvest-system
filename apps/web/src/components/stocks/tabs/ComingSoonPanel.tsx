import { getTranslations } from 'next-intl/server';
import { Stat } from './Stat';

interface ComingSoonPanelProps {
  /** Tab key — currently 'technical' | 'shortSelling' | 'news' | 'ai'. */
  tabKey: 'technical' | 'shortSelling' | 'news' | 'ai';
}

/**
 * Shared "Coming soon" panel for tabs whose data isn't wired up yet
 * (Technical / Short Selling / News / AI). Keeps the visual rhythm identical
 * to the three real panels so the tab strip doesn't feel half-built.
 */
export async function ComingSoonPanel({ tabKey }: ComingSoonPanelProps) {
  const t = await getTranslations('stock');
  return (
    <section className="rounded-md border border-border bg-bg-elevated">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-fg">{t(`tab.${tabKey}`)}</h3>
        <p className="mt-0.5 text-xs text-fg-subtle">{t('comingSoon.note')}</p>
      </div>
      <dl className="grid grid-cols-1">
        <Stat label={t(`tab.${tabKey}`)} value={t('comingSoon.value')} />
      </dl>
    </section>
  );
}