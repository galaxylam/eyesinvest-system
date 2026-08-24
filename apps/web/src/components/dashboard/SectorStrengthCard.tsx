/**
 * Sector Strength — leaderboard tile for the dashboard.
 *
 * Reads the latest snapshot from `ey_sector_daily` via
 * `getSectorStrengthLatest` and renders a small table sorted by relative
 * strength vs the global market. Sector names are localized via the
 * `dashboard.sectorStrength.sectors.<key>` message map; if the seeded
 * `ey_stocks.sector` value isn't in the map (e.g. a brand-new sector),
 * the table falls back to the English string from the database.
 *
 * Each sector row is a `<Link>` to `/[locale]/sectors/[sector]` so users
 * can drill into the underlying constituents. Sector name is URL-encoded
 * via `encodeURIComponent` so spaces ("Consumer Cyclical") survive intact.
 *
 * Server component — no client JS, no suspense boundary needed inside
 * (the parent page wraps it in Suspense with a `CardSkeleton` fallback).
 */

import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { getSectorStrengthLatest } from '@/lib/stocks/queries';
import { SignedNumber } from '@/components/stocks/SignedNumber';
import { formatSignedPercent } from '@/lib/format/quote';

// English sector strings → camelCase i18n keys. Mirrors the sector seeds in
// `local/supabase/seed.sql`. New sectors must be added here AND to every
// locale file under `dashboard.sectorStrength.sectors`. Exported so the
// sector detail page can localize the same way.
export const SECTOR_KEYS: Record<string, string> = {
  'Financial Services':     'financialServices',
  'Communication Services': 'communicationServices',
  'Technology':             'technology',
  'Consumer Cyclical':      'consumerCyclical',
  'Energy':                 'energy',
  'Consumer Defensive':     'consumerDefensive',
  'Healthcare':             'healthcare',
};

export async function SectorStrengthCard() {
  const t = await getTranslations('dashboard.sectorStrength');
  const locale = await getLocale();
  const { data, source } = await getSectorStrengthLatest();

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{t('title')}</h3>
        <span className="text-2xs text-fg-subtle">{t('subtitle')}</span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('empty')}</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wide text-fg-subtle">
                <th className="pb-2 text-left font-medium">{t('colSector')}</th>
                <th className="pb-2 text-right font-medium">{t('col1wReturn')}</th>
                <th className="pb-2 text-right font-medium">{t('col1mReturn')}</th>
                <th className="pb-2 text-right font-medium">{t('col1wRsVsMarket')}</th>
                <th className="pb-2 text-right font-medium">{t('col1mRsVsMarket')}</th>
                <th className="pb-2 text-right font-medium">{t('colBreadth')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row) => {
                // Map the persisted English sector string to a localized
                // label. Falls back to the raw string when no key is
                // registered (newly added sector — surfaces the gap to
                // whoever's reading the table).
                const sectorKey = SECTOR_KEYS[row.sector];
                const label = sectorKey
                  ? t(`sectors.${sectorKey}` as 'sectors.financialServices')
                  : row.sector;
                return (
                  <tr key={row.sector}>
                    <td className="py-2 text-sm text-fg">
                      <Link
                        href={`/${locale}/sectors/${encodeURIComponent(row.sector)}`}
                        className="hover:text-accent hover:underline"
                      >
                        {label}
                      </Link>
                    </td>
                    <td className="py-2 text-right">
                      <SignedNumber value={row.sectorReturn1w} className="text-xs tabular">
                        {formatSignedPercent(row.sectorReturn1w, locale)}
                      </SignedNumber>
                    </td>
                    <td className="py-2 text-right">
                      <SignedNumber value={row.sectorReturn1m} className="text-xs tabular">
                        {formatSignedPercent(row.sectorReturn1m, locale)}
                      </SignedNumber>
                    </td>
                    <td className="py-2 text-right">
                      <SignedNumber value={row.rsVsMarket1w} className="text-xs tabular">
                        {formatSignedPercent(row.rsVsMarket1w, locale)}
                      </SignedNumber>
                    </td>
                    <td className="py-2 text-right">
                      <SignedNumber value={row.rsVsMarket1m} className="text-xs tabular">
                        {formatSignedPercent(row.rsVsMarket1m, locale)}
                      </SignedNumber>
                    </td>
                    <td className="py-2 text-right tabular text-xs text-fg-muted">
                      {row.breadthPct != null ? `${row.breadthPct.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-2xs text-fg-subtle">
            {source === 'supabase' ? t('source') : 'Source: mock fallback'}
          </p>
        </>
      )}
    </div>
  );
}