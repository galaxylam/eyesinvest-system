'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, cn } from '@eyesinvest/ui';
import { bulkImportStocksAction } from '@/app/(authed)/stocks/actions';
import type { BulkImportResult, StockFormInput } from '@/app/(authed)/stocks/actions';

interface BulkImportDialogProps {
  /** Open state controlled by parent (the "+ Bulk import" button on /stocks). */
  open: boolean;
  onClose: () => void;
}

/** Expected column order — keep in sync with `parseRows` below. */
const COLUMNS = [
  'symbol',
  'name',
  'market',
  'currency',
  'exchange',
  'sector',
  'industry',
  'isActive',
] as const;

const SAMPLE_TSV =
  'symbol\tname\tmarket\tcurrency\texchange\tsector\tindustry\tisActive\n' +
  'AAPL\tApple Inc.\tUS\tUSD\tNASDAQ\tTechnology\tConsumer Electronics\ttrue\n' +
  '0700.HK\tTencent\tHK\tHKD\tHKEX\tCommunication Services\tInternet Content\ttrue';

/**
 * Lightweight TSV/CSV parser. Splits on the first delimiter found across the
 * input — tabs win if any line has one, otherwise commas. Quote handling is
 * intentionally minimal (no embedded newlines); spreadsheets typically export
 * one record per line, so the rare case isn't worth the complexity.
 */
function parseRows(text: string): StockFormInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const delim = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const cells = lines.map((l) => l.split(delim).map((c) => c.trim()));

  // Header detection: if the first row's first cell looks like the word
  // "symbol", drop it; otherwise treat as data with COLUMNS-aligned positions.
  let rows: string[][];
  const first = cells[0]?.[0]?.toLowerCase() ?? '';
  if (first === 'symbol' || first === 'ticker') {
    rows = cells.slice(1);
  } else {
    rows = cells;
  }

  return rows.map((cols) => {
    const pad = [...cols, ...Array(COLUMNS.length).fill('')] as string[];
    const symbol = (pad[0] ?? '').toUpperCase();
    const market = (pad[2] ?? '').toUpperCase();
    const isActiveRaw = (pad[7] ?? '').toLowerCase();
    return {
      symbol,
      name: pad[1] ?? '',
      market: market === 'HK' ? 'HK' : 'US',
      currency: (pad[3] ?? 'USD').toUpperCase(),
      exchange: pad[4] || null,
      sector: pad[5] || null,
      industry: pad[6] || null,
      isActive: ['1', 'true', 'yes', 'y', 't'].includes(isActiveRaw),
    } satisfies StockFormInput;
  });
}

export function BulkImportDialog({ open, onClose }: BulkImportDialogProps) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkImportResult | null>(null);

  if (!open) return null;

  function reset() {
    setText('');
    setResult(null);
  }

  function onSubmit() {
    const rows = parseRows(text);
    if (rows.length === 0) {
      setResult({ ok: false, upserted: 0, errors: [], error: 'No rows found in input.' });
      return;
    }
    startTransition(async () => {
      const res = await bulkImportStocksAction(rows);
      setResult(res);
      if (res.ok && res.upserted > 0) router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-import-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-bg-elevated p-5 shadow-xl">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="bulk-import-title" className="text-lg font-semibold text-fg">
            Bulk import stocks
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-muted hover:text-fg"
          >
            ✕
          </button>
        </header>

        <section className="mb-3 space-y-2 rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
          <p>
            Paste rows below — one stock per line, tab- or comma-separated. The
            header row is optional.
          </p>
          <p>
            Columns in order:{' '}
            <code className="rounded bg-bg-muted px-1 py-0.5 text-fg">
              symbol, name, market, currency, exchange, sector, industry, isActive
            </code>
            . <code className="text-fg">market</code> must be{' '}
            <code className="text-fg">US</code> or <code className="text-fg">HK</code>;{' '}
            <code className="text-fg">isActive</code> accepts{' '}
            <code className="text-fg">true/false/1/0</code>.
          </p>
          <details className="text-fg-subtle">
            <summary className="cursor-pointer hover:text-fg">Sample (TSV)</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-bg-muted p-2 text-2xs">
              {SAMPLE_TSV}
            </pre>
          </details>
        </section>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={'AAPL\tApple Inc.\tUS\tUSD\tNASDAQ\tTechnology\tConsumer Electronics\ttrue\n0700.HK\tTencent\tHK\tHKD\tHKEX\t...\ttrue'}
          className={cn(
            'w-full rounded-md border border-border bg-bg p-2 font-mono text-xs text-fg shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        />

        {result && <ResultSummary result={result} />}

        <footer className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={pending}
          >
            {result && result.ok ? 'Done' : 'Cancel'}
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={pending || text.trim().length === 0}
          >
            {pending ? 'Importing…' : 'Import'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function ResultSummary({ result }: { result: BulkImportResult }) {
  if (result.error) {
    return (
      <p className="mt-3 rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">
        {result.error}
      </p>
    );
  }
  const totalErrors = result.errors.length;
  return (
    <div
      className={cn(
        'mt-3 space-y-2 rounded-md border px-3 py-2 text-xs',
        totalErrors === 0
          ? 'border-positive/40 bg-positive/10 text-positive'
          : 'border-amber/40 bg-amber/10 text-amber',
      )}
    >
      <p>
        Upserted {result.upserted} row{result.upserted === 1 ? '' : 's'}
        {totalErrors > 0 && `, skipped ${totalErrors} with errors`}.
      </p>
      {totalErrors > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded bg-bg/50 p-2 font-mono text-2xs text-fg">
          {result.errors.slice(0, 50).map((e) => (
            <li key={`${e.row}-${e.reason}`}>
              row {e.row}
              {e.symbol ? ` (${e.symbol})` : ''}: {e.reason}
            </li>
          ))}
          {totalErrors > 50 && <li>… and {totalErrors - 50} more</li>}
        </ul>
      )}
    </div>
  );
}
