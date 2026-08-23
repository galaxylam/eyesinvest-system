import Link from 'next/link';
import { listAdminStocks } from '@/lib/stocks/admin-queries';
import { DataTable } from '@/components/DataTable';

export default async function StocksPage() {
  const { rows, source } = await listAdminStocks();

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Stock universe</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Master list of stocks tracked by the platform.{' '}
            <span className="text-fg-subtle">Source: {source === 'supabase' ? 'Supabase' : 'Mock (dev)'}</span>
          </p>
        </div>
        <Link
          href="/stocks/new"
          className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:opacity-90"
        >
          + New stock
        </Link>
      </div>

      <DataTable rows={rows} />
    </div>
  );
}
