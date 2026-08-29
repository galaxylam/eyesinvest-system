'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Badge, Button } from '@eyesinvest/ui';
import type {
  MappingStatus,
  RelationshipType,
  StockRelationshipDto,
} from '@eyesinvest/types';
import {
  bulkReviewRelationshipsAction,
  skipRelationshipAction,
} from '@/app/(authed)/relationships/actions';

interface RelationshipQueueTableProps {
  pending: StockRelationshipDto[];
  approved: StockRelationshipDto[];
  rejected: StockRelationshipDto[];
}

type Row = StockRelationshipDto & {
  _srcSymbol: string;
  _tgtSymbol: string;
  _srcMarket: string;
};

const columnHelper = createColumnHelper<Row>();

function typeBadgeVariant(t: RelationshipType): 'info' | 'warn' | 'positive' | 'outline' {
  switch (t) {
    case 'supplier': return 'info';
    case 'customer': return 'positive';
    case 'competitor': return 'warn';
    default: return 'outline';
  }
}

export function RelationshipQueueTable({
  pending,
  approved,
  rejected,
}: RelationshipQueueTableProps) {
  const [tab, setTab] = useState<MappingStatus | 'all'>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const rows: Row[] = useMemo(() => {
    const source =
      tab === 'pending' ? pending :
      tab === 'approved' ? approved :
      tab === 'rejected' ? rejected :
      [...pending, ...approved, ...rejected];
    return source.map((r) => ({
      ...r,
      _srcSymbol: r.source.symbol,
      _tgtSymbol: r.target.symbol,
      _srcMarket: r.source.market,
    }));
  }, [tab, pending, approved, rejected]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all on this page"
            checked={rows.length > 0 && selected.size === rows.length}
            onChange={(e) =>
              setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
            }
            className="h-4 w-4 rounded border-border bg-bg-elevated text-accent focus:ring-accent"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select relationship ${row.original.id}`}
            checked={selected.has(row.original.id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(row.original.id);
              else next.delete(row.original.id);
              setSelected(next);
            }}
            className="h-4 w-4 rounded border-border bg-bg-elevated text-accent focus:ring-accent"
          />
        ),
      }),
      columnHelper.accessor('_srcSymbol', {
        header: 'Source',
        cell: (info) => (
          <span className="tabular font-mono text-xs font-semibold">{info.getValue()}</span>
        ),
      }),
      columnHelper.display({
        id: 'arrow',
        header: '',
        cell: () => <span className="text-fg-subtle">→</span>,
      }),
      columnHelper.accessor('_tgtSymbol', {
        header: 'Target',
        cell: (info) => (
          <span className="tabular font-mono text-xs font-semibold">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('relationshipType', {
        header: 'Type',
        cell: (info) => (
          <Badge variant={typeBadgeVariant(info.getValue())}>{info.getValue()}</Badge>
        ),
      }),
      columnHelper.accessor('confidence', {
        header: 'Confidence',
        cell: (info) => {
          const v = info.getValue();
          return v == null ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="tabular text-xs">{(v * 100).toFixed(0)}%</span>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: (info) => {
          const v = info.getValue();
          const variant =
            v === 'approved' ? 'positive' : v === 'rejected' ? 'negative' : 'outline';
          return <Badge variant={variant}>{v}</Badge>;
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Link
            href={`/relationships/${row.original.id}`}
            className="text-xs text-fg-muted hover:text-fg"
          >
            Review →
          </Link>
        ),
      }),
    ],
    [rows, selected],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  async function onBulk(status: 'approved' | 'rejected') {
    if (selected.size === 0) return;
    setBusy(true);
    setBanner(null);
    const result = await bulkReviewRelationshipsAction({
      ids: Array.from(selected),
      status,
    });
    setBusy(false);
    if (!result.ok) {
      setBanner({ kind: 'err', msg: result.error ?? 'Bulk action failed' });
      return;
    }
    setBanner({
      kind: 'ok',
      msg: `${status === 'approved' ? 'Approved' : 'Rejected'} ${result.count ?? selected.size} edge(s)`,
    });
    setSelected(new Set());
  }

  async function onSkipSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Skip (delete) ${selected.size} edge(s)? This cannot be undone.`)) return;
    setBusy(true);
    for (const id of selected) {
      const r = await skipRelationshipAction({ id });
      if (!r.ok) {
        setBusy(false);
        setBanner({ kind: 'err', msg: r.error ?? 'Skip failed' });
        return;
      }
    }
    setBusy(false);
    setBanner({ kind: 'ok', msg: `Skipped ${selected.size} edge(s)` });
    setSelected(new Set());
  }

  return (
    <div className="space-y-3">
      <div role="tablist" className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-bg-muted p-1 text-fg-muted">
        <TabBtn label="Pending" count={pending.length} active={tab === 'pending'} onClick={() => { setTab('pending'); setSelected(new Set()); }} />
        <TabBtn label="Approved" count={approved.length} active={tab === 'approved'} onClick={() => { setTab('approved'); setSelected(new Set()); }} />
        <TabBtn label="Rejected" count={rejected.length} active={tab === 'rejected'} onClick={() => { setTab('rejected'); setSelected(new Set()); }} />
        <TabBtn label="All" count={pending.length + approved.length + rejected.length} active={tab === 'all'} onClick={() => { setTab('all'); setSelected(new Set()); }} />
      </div>

      {banner && (
        <p className={`rounded-md border px-3 py-2 text-xs ${banner.kind === 'ok' ? 'border-positive/40 bg-positive/10 text-positive' : 'border-negative/40 bg-negative/10 text-negative'}`}>
          {banner.msg}
        </p>
      )}

      {tab === 'pending' && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated p-3 text-xs text-fg-muted">
          <span>{selected.size} selected</span>
          <Button size="sm" disabled={busy} onClick={() => onBulk('approved')}>
            Approve selected
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onBulk('rejected')}>
            Reject selected
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={onSkipSelected}>
            Skip (delete) selected
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-border bg-bg-elevated p-8 text-center text-sm text-fg-muted">
          {tab === 'pending'
            ? 'No pending edges. Run sync-news to ingest more articles.'
            : `No ${tab} edges.`}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
          <table className="w-full text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-4 py-2.5 font-medium">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-bg-muted">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-medium transition-all ${
        active ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {label}
      <span className={`rounded px-1 text-[10px] ${active ? 'bg-bg-muted text-fg-muted' : 'bg-bg-elevated text-fg-subtle'}`}>
        {count}
      </span>
    </button>
  );
}