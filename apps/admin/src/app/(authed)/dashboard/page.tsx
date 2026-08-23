import { listAdminStocks } from '@/lib/stocks/admin-queries';

export default async function AdminDashboardPage() {
  const { rows, source } = await listAdminStocks();
  const usCount = rows.filter((r) => r.market === 'US').length;
  const hkCount = rows.filter((r) => r.market === 'HK').length;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Admin dashboard</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Phase 1 foundation. Real-time analytics, worker status, and AI review
          queues arrive in later phases.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total stocks" value={rows.length} />
        <Stat label="US stocks" value={usCount} />
        <Stat label="HK stocks" value={hkCount} />
        <Stat label="Data source" value={source === 'supabase' ? 'Supabase' : 'Mock (dev)'} />
      </div>

      <section className="mt-8 rounded-lg border border-border bg-bg-elevated p-6">
        <h2 className="text-sm font-semibold text-fg">Quick links</h2>
        <ul className="mt-3 space-y-2 text-sm text-fg-muted">
          <li>
            <a href="/stocks" className="text-accent hover:underline">
              Manage stock universe →
            </a>
          </li>
          <li>
            <a href="/stocks/new" className="text-accent hover:underline">
              Add a new stock →
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-4">
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold text-fg">{value}</p>
    </div>
  );
}
