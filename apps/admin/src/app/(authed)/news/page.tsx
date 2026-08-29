import { listNewsMappingsByStatus } from '@/lib/news/admin-queries';
import { NewsMappingQueueTable } from '@/components/NewsMappingQueueTable';

/**
 * News review queue — the admin's primary surface for curating the AI's
 * suggestions. Loads all status values in parallel so the tab counts
 * are accurate and tab-switching is instant (no re-fetch).
 */
export default async function NewsPage() {
  const [
    { rows: pending, source: srcPending },
    { rows: approved },
    { rows: rejected },
  ] = await Promise.all([
    listNewsMappingsByStatus('pending'),
    listNewsMappingsByStatus('approved'),
    listNewsMappingsByStatus('rejected'),
  ]);

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          News review queue
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Curate AI-suggested article↔stock impact mappings. Approved rows
          surface on the public app; rejected / pending are admin-only via RLS.{' '}
          <span className="text-fg-subtle">Source: {srcPending === 'supabase' ? 'Supabase' : 'Mock (dev)'}</span>
        </p>
      </div>
      <NewsMappingQueueTable
        pending={pending}
        approved={approved}
        rejected={rejected}
      />
    </div>
  );
}