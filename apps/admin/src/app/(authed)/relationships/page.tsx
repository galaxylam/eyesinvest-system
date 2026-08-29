import { listAllRelationships, listPendingRelationships } from '@/lib/news/admin-queries';
import { RelationshipQueueTable } from '@/components/RelationshipQueueTable';

/**
 * Knowledge-graph review queue — the AI's stock↔stock edges
 * (supplier / competitor / customer / partner / parent_subsidiary).
 * Same tab pattern as /news: Pending / Approved / Rejected / All.
 */
export default async function RelationshipsPage() {
  const [
    { rows: pending, source: srcPending },
    { rows: approved },
    { rows: rejected },
  ] = await Promise.all([
    listPendingRelationships(),
    listAllRelationships('approved'),
    listAllRelationships('rejected'),
  ]);

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          Knowledge graph — relationships
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          AI-suggested stock↔stock edges (supplier, competitor, customer,
          partner, parent_subsidiary). Approved edges are visible to the
          public app; rejected / pending are admin-only.{' '}
          <span className="text-fg-subtle">Source: {srcPending === 'supabase' ? 'Supabase' : 'Mock (dev)'}</span>
        </p>
      </div>
      <RelationshipQueueTable
        pending={pending}
        approved={approved}
        rejected={rejected}
      />
    </div>
  );
}