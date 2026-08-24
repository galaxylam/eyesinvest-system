import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { getStocksBySector, getSectorStrengthLatest } from '@/lib/stocks/queries';
import { SignedNumber } from '@/components/stocks/SignedNumber';
import { formatPrice, formatSignedPercent } from '@/lib/format/quote';
import { SECTOR_KEYS } from '@/components/dashboard/SectorStrengthCard';

interface SectorPageProps {
  params: Promise<{ locale: string; sector: string }>;
}

/**
 * Sector detail page — list the constituents of one sector.
 *
 *   /en/sectors/Technology
 *   /en/sectors/Financial%20Services  ← spaces URL-encoded by the dashboard link
 *
 * Reads the latest `ey_sector_daily` row for the sector header (member count
 * + 1w/1m return), then `getStocksBySector` for the constituents. Both go
 * through `withFallback` so the page works against the mock universe when
 * Supabase isn't configured.
 *
 * Each row links to `/[locale]/stocks/[symbol]` so the user can drill one
 * level deeper. The sector name itself is localizable via the same
 * `SECTOR_KEYS` map used on the dashboard.
 */
export default async function SectorPage({ params }: SectorPageProps) {
  const { locale, sector } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard.sectorDetail');

  // URL-decode the sector string. The dashboard encodes "Consumer Cyclical"
  // and "Financial Services" with %20.
  const decodedSector = decodeURIComponent(sector);

  const [latestRes, membersRes] = await Promise.all([
    getSectorStrengthLatest(),
    getStocksBySector(decodedSector),
  ]);

  // The latest snapshot row for this sector (1w/1m return + breadth header).
  const latestRow = latestRes.data.find((r) => r.sector === decodedSector) ?? null;
  const members = membersRes.data;

  // If the sector has no members AND no latest snapshot row, the route
  // refers to a non-existent sector — 404 instead of rendering an empty page.
  if (!latestRow && members.length === 0) notFound();

  const sectorKey = SECTOR_KEYS[decodedSector];
  const localizedName = sectorKey
    ? t(`sectors.${sectorKey}` as 'sectors.financialServices')
    : decodedSector;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-3">
        <Link
          href={`/${locale}/dashboard`}
          className="inline-flex items-center text-xs text-fg-muted hover:text-fg"
        >
          ← {t('backToDashboard')}
        </Link>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {localizedName}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t('subtitle', { count: latestRow?.memberCount ?? members.length })}
        </p>
      </div>

      {latestRow ? (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-bg-elevated p-4 sm:grid-cols-5">
          <div>
            <p className="text-2xs uppercase tracking-wide text-fg-subtle">
              {t('col1wReturn')}
            </p>
            <SignedNumber value={latestRow.sectorReturn1w} className="mt-1 text-lg font-semibold tabular">
              {formatSignedPercent(latestRow.sectorReturn1w, locale)}
            </SignedNumber>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide text-fg-subtle">
              {t('col1mReturn')}
            </p>
            <SignedNumber value={latestRow.sectorReturn1m} className="mt-1 text-lg font-semibold tabular">
              {formatSignedPercent(latestRow.sectorReturn1m, locale)}
            </SignedNumber>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide text-fg-subtle">
              {t('col1wRsVsMarket')}
            </p>
            <SignedNumber value={latestRow.rsVsMarket1w} className="mt-1 text-lg font-semibold tabular">
              {formatSignedPercent(latestRow.rsVsMarket1w, locale)}
            </SignedNumber>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide text-fg-subtle">
              {t('col1mRsVsMarket')}
            </p>
            <SignedNumber value={latestRow.rsVsMarket1m} className="mt-1 text-lg font-semibold tabular">
              {formatSignedPercent(latestRow.rsVsMarket1m, locale)}
            </SignedNumber>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide text-fg-subtle">
              {t('colBreadth')}
            </p>
            <p className="mt-1 text-lg font-semibold tabular text-fg">
              {latestRow.breadthPct != null ? `${latestRow.breadthPct.toFixed(0)}%` : '—'}
            </p>
          </div>
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-bg-elevated">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wide text-fg-subtle">
                <th className="px-4 pb-2 pt-3 text-left font-medium">{t('colSymbol')}</th>
                <th className="px-4 pb-2 pt-3 text-right font-medium">{t('colPrice')}</th>
                <th className="px-4 pb-2 pt-3 text-right font-medium">{t('colChange')}</th>
                <th className="px-4 pb-2 pt-3 text-right font-medium">{t('col1mReturn')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.symbol}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/${locale}/stocks/${encodeURIComponent(m.symbol)}`}
                      className="block"
                    >
                      <span className="font-medium text-fg hover:text-accent hover:underline">
                        {m.symbol}
                      </span>
                      <span className="ml-2 text-xs text-fg-muted">{m.name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular text-fg">
                    {m.lastPrice != null
                      ? formatPrice(m.lastPrice, m.currency, locale)
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <SignedNumber value={m.changePercent} className="tabular text-xs">
                      {formatSignedPercent(m.changePercent, locale)}
                    </SignedNumber>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <SignedNumber value={m.return1m} className="tabular text-xs">
                      {formatSignedPercent(m.return1m, locale)}
                    </SignedNumber>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}