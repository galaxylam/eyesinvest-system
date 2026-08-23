'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { Badge } from '@eyesinvest/ui';
import type { AdminStockRow } from '@/lib/stocks/admin-queries';
import { deleteStockAction } from '@/app/(authed)/stocks/actions';

const columnHelper = createColumnHelper<AdminStockRow>();

interface DataTableProps {
  rows: AdminStockRow[];
}

export function DataTable({ rows }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.accessor('symbol', {
        header: 'Symbol',
        cell: (info) => (
          <span className="tabular font-mono text-xs font-semibold">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', {
        header: 'Company',
        cell: (info) => <span>{info.getValue()}</span>,
      }),
      columnHelper.accessor('market', {
        header: 'Market',
        cell: (info) => (
          <Badge variant={info.getValue() === 'US' ? 'info' : 'warn'}>{info.getValue()}</Badge>
        ),
      }),
      columnHelper.accessor('sector', {
        header: 'Sector',
        cell: (info) => info.getValue() ?? '—',
      }),
      columnHelper.accessor('isActive', {
        header: 'Status',
        cell: (info) =>
          info.getValue() ? (
            <Badge variant="positive">Active</Badge>
          ) : (
            <Badge variant="outline">Inactive</Badge>
          ),
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/stocks/${row.original.id}/edit`}
              className="text-xs text-fg-muted hover:text-fg"
            >
              Edit
            </Link>
            <button
              type="button"
              disabled={busyId === row.original.id}
              onClick={async () => {
                if (!confirm(`Delete ${row.original.symbol}?`)) return;
                setBusyId(row.original.id);
                const result = await deleteStockAction(row.original.id);
                setBusyId(null);
                if (!result.ok) alert(result.error ?? 'Delete failed');
              }}
              className="text-xs text-negative hover:opacity-80 disabled:opacity-40"
            >
              {busyId === row.original.id ? '…' : 'Delete'}
            </button>
          </div>
        ),
      }),
    ],
    [busyId],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elevated p-8 text-center text-sm text-fg-muted">
        No stocks yet. Add one to get started.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
      <table className="w-full text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sort = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="cursor-pointer select-none px-4 py-2.5 font-medium hover:text-fg"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {sort === 'asc' && ' ▲'}
                    {sort === 'desc' && ' ▼'}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-bg-muted">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
