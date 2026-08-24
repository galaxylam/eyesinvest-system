import Link from 'next/link';
import clsx from 'clsx';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  formatMarketCap,
  formatPrice,
  formatRatio,
  formatSignedPercent,
  formatVolume,
} from '@/lib/format/quote';
import { SignedNumber } from '@/components/stocks/SignedNumber';
import type {
  ScreenerRow,
  ScreenerSort,
  ScreenerSortColumn,
} from '@/lib/stocks/queries';

interface ScreenerTableProps {
  rows: ScreenerRow[];
  sort: ScreenerSort;
  /** Current searchParams — preserved when the user clicks a sort header so
   *  filters aren't accidentally wiped while re-sorting. */
  preservedSearch: Record<string, string>;
}

interface ColumnSpec {
  /** Sort column key (or null for non-sortable columns). */
  sortColumn: ScreenerSortColumn | null;
  /** Translation key for the visible header label. */
  labelKey:
    | 'col.symbol'
    | 'col.market'
    | 'col.price'
    | 'col.change'
    | 'col.volume'
    | 'col.marketCap'
    | 'col.pe'
    | 'col.yield'
    | 'col.return1m'
    | 'col.efficiency'
    | 'col.crowded'
    | 'col.squeeze';
  align?: 'left' | 'right';
}

const COLUMNS: ColumnSpec[] = [
  { sortColumn: 'symbol', labelKey: 'col.symbol' },
  { sortColumn: null, labelKey: 'col.market' },
  { sortColumn: null, labelKey: 'col.price', align: 'right' },
  { sortColumn: 'changePercent', labelKey: 'col.change', align: 'right' },
  { sortColumn: 'volume', labelKey: 'col.volume', align: 'right' },
  { sortColumn: 'marketCap', labelKey: 'col.marketCap', align: 'right' },
  { sortColumn: 'peRatio', labelKey: 'col.pe', align: 'right' },
  { sortColumn: 'dividendYield', labelKey: 'col.yield', align: 'right' },
  { sortColumn: 'return1m', labelKey: 'col.return1m', align: 'right' },
  { sortColumn: null, labelKey: 'col.efficiency', align: 'right' },
  { sortColumn: null, labelKey: 'col.crowded', align: 'right' },
  { sortColumn: 'squeezeScore', labelKey: 'col.squeeze', align: 'right' },
];

/**
 * One-row-per-stock table for /screener. Server component — sorting is
 * driven by URL search params (`?sort=...&dir=...`), so each header is a
 * `<Link>` that flips the current column's direction (or starts descending
 * for a new column). `null` values sink to the bottom regardless of dir
 * (handled in `applyScreenerSort`).
 */
export async function ScreenerTable({ rows, sort, preservedSearch }: ScreenerTableProps) {
  const t = await getTranslations('screener');
  const locale = await getLocale();

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elevated p-6 text-center text-sm text-fg-muted">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-bg-elevated">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-fg-subtle">
            {COLUMNS.map((col) => (
              <th
                key={col.labelKey}
                scope="col"
                className={
                  col.align === 'right' ? 'px-3 py-2 text-right' : 'px-3 py-2 text-left'
                }
              >
                {col.sortColumn == null ? (
                  t(col.labelKey)
                ) : (
                  <SortHeader
                    column={col.sortColumn}
                    sort={sort}
                    label={t(col.labelKey)}
                    align={col.align}
                    preservedSearch={preservedSearch}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={`${row.market}:${row.symbol}`} row={row} locale={locale} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  column,
  sort,
  label,
  align,
  preservedSearch,
}: {
  column: ScreenerSortColumn;
  sort: ScreenerSort;
  label: string;
  align?: 'left' | 'right';
  preservedSearch: Record<string, string>;
}) {
  const isActive = sort.column === column;
  const nextDir: ScreenerSort['dir'] =
    isActive && sort.dir === 'desc' ? 'asc' : 'desc';
  const arrow = isActive ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';

  // Preserve everything in the URL except sort/dir. That way clicking a
  // header from a filtered view doesn't accidentally wipe the filters.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(preservedSearch)) {
    if (k !== 'sort' && k !== 'dir') qs.set(k, v);
  }
  qs.set('sort', column);
  qs.set('dir', nextDir);

  return (
    <Link
      href={`?${qs.toString()}`}
      className={`inline-flex items-center gap-1 hover:text-fg ${
        align === 'right' ? 'justify-end' : ''
      } ${isActive ? 'text-fg' : ''}`}
      aria-sort={isActive ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      <span aria-hidden>{arrow}</span>
    </Link>
  );
}

function Row({
  row,
  locale,
}: {
  row: ScreenerRow;
  locale: string;
}) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-bg-muted/50">
      <td className="px-3 py-2">
        <Link
          href={`/${locale}/stocks/${encodeURIComponent(row.symbol)}`}
          className="flex flex-col hover:text-accent"
        >
          <span className="tabular font-mono text-xs font-medium text-fg">{row.symbol}</span>
          <span className="truncate text-2xs text-fg-muted" title={row.name}>
            {row.name}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2 text-2xs text-fg-muted">{row.market}</td>
      <td className="px-3 py-2 text-right">
        <span className="tabular font-mono text-xs text-fg">
          {row.lastPrice != null ? formatPrice(row.lastPrice, row.currency, locale) : '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <SignedNumber value={row.changePercent} className="text-xs">
          {formatSignedPercent(row.changePercent, locale)}
        </SignedNumber>
      </td>
      <td className="px-3 py-2 text-right tabular font-mono text-2xs text-fg-muted">
        {formatVolume(row.volume, locale)}
      </td>
      <td className="px-3 py-2 text-right tabular font-mono text-2xs text-fg-muted">
        {formatMarketCap(row.marketCap, locale)}
      </td>
      <td className="px-3 py-2 text-right tabular font-mono text-2xs text-fg-muted">
        {row.peRatio != null ? row.peRatio.toFixed(2) : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular font-mono text-2xs text-fg-muted">
        {row.dividendYield != null ? `${(row.dividendYield * 100).toFixed(2)}%` : '—'}
      </td>
      <td className="px-3 py-2 text-right">
        <SignedNumber value={row.return1m} className="text-2xs">
          {row.return1m != null ? formatSignedPercent(row.return1m, locale) : '—'}
        </SignedNumber>
      </td>
      <td
        className={clsx(
          'px-3 py-2 text-right tabular font-mono text-2xs',
          row.volumeEfficiencyToday == null
            ? 'text-fg-subtle'
            : row.volumeEfficiencyToday >= 2
              ? 'text-emerald-500'
              : row.volumeEfficiencyToday >= 1
                ? 'text-fg'
                : 'text-fg-muted',
        )}
      >
        {formatRatio(row.volumeEfficiencyToday)}
      </td>
      <td
        className={clsx(
          'px-3 py-2 text-right tabular font-mono text-2xs',
          (() => {
            const r = row.crowdedRatio;
            if (r == null) return 'text-fg-subtle';
            if (r >= 1.5) return 'text-rose-500';
            if (r >= 1.2) return 'text-amber-500';
            if (r >= 0.8) return 'text-emerald-500';
            return 'text-fg-muted';
          })(),
        )}
      >
        {formatRatio(row.crowdedRatio)}
      </td>
      <td
        className={clsx(
          'px-3 py-2 text-right tabular font-mono text-2xs',
          (() => {
            const s = row.squeezeScore;
            if (s == null) return 'text-fg-subtle';
            // Mirror SqueezeCard regime bands: ≥70 rose, ≥50 amber, else fg.
            if (s >= 70) return 'text-rose-500';
            if (s >= 50) return 'text-amber-500';
            return 'text-fg';
          })(),
        )}
      >
        {row.squeezeScore == null ? '—' : Math.round(row.squeezeScore)}
      </td>
    </tr>
  );
}