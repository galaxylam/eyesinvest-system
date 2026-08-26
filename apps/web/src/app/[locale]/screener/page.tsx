import type { Market } from '@eyesinvest/types';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  type ScreenerFilters,
  type ScreenerSort,
  type ScreenerSortColumn,
  getScreenerRows,
  getScreenerSectors,
} from '@/lib/stocks/queries';
import { ScreenerFilters as ScreenerFiltersPanel } from '@/components/screener/ScreenerFilters';
import { ScreenerTable } from '@/components/screener/ScreenerTable';

interface ScreenerPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    market?: string;
    sector?: string;
    cap?: string;
    pe?: string;
    yield?: string;
    ret1m?: string;
    eff?: string;
    crowd?: string;
    /** Crowded ratio upper bound — currently only '1' for the "<1×" subdued filter. */
    crowdlt?: string;
    /** Short-squeeze score lower bound (0..100). */
    sq?: string;
    /** MA5 trend: 'up' | 'down' */
    ma5?: string;
    /** MA20 trend: 'up' | 'down' */
    ma20?: string;
    /** Green-share threshold: 'g0.1'..'g0.7' / 'r0.1'..'r0.7' (step 0.1). */
    gs?: string;
    /** Short-interest trend: 'u1' / 'u2' / 'u3' / 'd1' / 'd2' / 'd3' */
    sit?: string;
    sort?: string;
    dir?: string;
  }>;
}

const SORT_COLUMNS: ScreenerSortColumn[] = [
  'symbol',
  'marketCap',
  'peRatio',
  'dividendYield',
  'return1m',
  'changePercent',
  'volume',
  'squeezeScore',
];

function parseFilters(sp: Awaited<ScreenerPageProps['searchParams']>): ScreenerFilters {
  const f: ScreenerFilters = {};
  if (sp.market === 'US' || sp.market === 'HK') f.market = sp.market as Market;
  if (sp.sector) f.sector = sp.sector;
  if (sp.cap) {
    const n = Number(sp.cap);
    if (Number.isFinite(n) && n > 0) f.marketCapMin = n;
  }
  if (sp.pe) {
    const n = Number(sp.pe);
    if (Number.isFinite(n) && n > 0) f.peMax = n;
  }
  if (sp.yield) {
    const n = Number(sp.yield);
    if (Number.isFinite(n) && n >= 0) f.yieldMin = n;
  }
  if (sp.ret1m) {
    const n = Number(sp.ret1m);
    if (Number.isFinite(n)) f.return1mMin = n;
  }
  if (sp.eff) {
    const n = Number(sp.eff);
    if (Number.isFinite(n) && n >= 0) f.volumeEfficiencyMin = n;
  }
  if (sp.crowd) {
    const n = Number(sp.crowd);
    if (Number.isFinite(n) && n >= 0) f.crowdedRatioMin = n;
  }
  if (sp.crowdlt) {
    const n = Number(sp.crowdlt);
    if (Number.isFinite(n) && n > 0) f.crowdedRatioMax = n;
  }
  if (sp.sq) {
    const n = Number(sp.sq);
    if (Number.isFinite(n) && n >= 0 && n <= 100) f.squeezeMin = n;
  }
  if (sp.ma5 === 'up' || sp.ma5 === 'down') f.ma5Trend = sp.ma5;
  if (sp.ma20 === 'up' || sp.ma20 === 'down') f.ma20Trend = sp.ma20;
  // 1M green/red share: encoding is a single signed number — `gs=0.5` means
  // `>+50%` (in green, share > 0.5), `gs=-0.4` means `<-40%` (in red,
  // share < -0.4). Anything outside the discrete allow-list is silently
  // ignored so a hand-edited URL doesn't 500 the page.
  if (sp.gs) {
    const n = Number(sp.gs);
    const allowed = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, -0.1, -0.2, -0.3, -0.4, -0.5, -0.6];
    if (Number.isFinite(n) && allowed.includes(n)) {
      f.greenShareThreshold = n as 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | -0.1 | -0.2 | -0.3 | -0.4 | -0.5 | -0.6;
    }
  }
  if (sp.sit) {
    const c = sp.sit[0];
    const n = Number(sp.sit.slice(1));
    if ((c === 'u' || c === 'd') && (n === 1 || n === 2 || n === 3)) {
      f.shortInterestTrend = {
        direction: c === 'u' ? 'up' : 'down',
        periods: n as 1 | 2 | 3,
      };
    }
  }
  return f;
}

function parseSort(sp: Awaited<ScreenerPageProps['searchParams']>): ScreenerSort {
  const column: ScreenerSortColumn =
    sp.sort && (SORT_COLUMNS as string[]).includes(sp.sort)
      ? (sp.sort as ScreenerSortColumn)
      : 'marketCap';
  const dir: ScreenerSort['dir'] = sp.dir === 'asc' ? 'asc' : 'desc';
  return { column, dir };
}

/**
 * Server-side screener page. URL search params are the source of truth for
 * both filters and sort, so the page is fully shareable / bookmarkable.
 *
 *   /en/screener?market=US&cap=100000000000&sort=return1m&dir=desc
 *
 * Yields a list of screener rows, a filter bar, and a sortable table.
 */
export default async function ScreenerPage({ params, searchParams }: ScreenerPageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('screener');

  const filters = parseFilters(sp);
  const sort = parseSort(sp);

  // Two parallel reads: sectors (dropdown options) + the filtered/sorted rows.
  const [sectorsRes, rowsRes] = await Promise.all([
    getScreenerSectors(),
    getScreenerRows({ filters, sort }),
  ]);

  const sectors = sectorsRes.data;
  const rows = rowsRes.data;

  // Forward everything except sort/dir to the table so its SortHeader links
  // preserve filter state when the user re-sorts.
  const preservedSearch: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'sort' || k === 'dir') continue;
    if (typeof v === 'string' && v.length > 0) preservedSearch[k] = v;
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </div>

      <div className="space-y-4">
        <ScreenerFiltersPanel current={filters} sectors={sectors} />

        <ScreenerTable rows={rows} sort={sort} preservedSearch={preservedSearch} />

        <p className="text-2xs text-fg-subtle">
          {t('count', { count: rows.length })}
        </p>
      </div>
    </div>
  );
}