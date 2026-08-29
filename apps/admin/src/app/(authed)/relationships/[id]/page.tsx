import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@eyesinvest/ui';
import { getRelationshipDetail } from '@/lib/news/admin-queries';
import { RelationshipReviewForm } from '@/components/RelationshipReviewForm';

interface RelationshipReviewPageProps {
  params: Promise<{ id: string }>;
}

export default async function RelationshipReviewPage({ params }: RelationshipReviewPageProps) {
  const { id } = await params;
  const edge = await getRelationshipDetail(id);
  if (!edge) notFound();

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/relationships" className="text-xs text-fg-muted hover:text-fg">
          ← Back to relationships
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          Review edge
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          <span className="font-mono">{edge.source.symbol}</span>
          {' '}
          <span className="text-fg-subtle">→</span>
          {' '}
          <span className="font-mono">{edge.target.symbol}</span>
          {' · '}
          {edge.relationshipType}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <aside className="space-y-4 lg:col-span-2">
          <section className="rounded-md border border-border bg-bg-elevated p-5">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">Source</h3>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-base font-semibold text-fg">
                {edge.source.symbol}
              </span>
              <Badge variant={edge.source.market === 'US' ? 'info' : 'warn'}>
                {edge.source.market}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-fg-muted">{edge.source.name}</p>
          </section>

          <section className="rounded-md border border-border bg-bg-elevated p-5">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">Target</h3>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-base font-semibold text-fg">
                {edge.target.symbol}
              </span>
              <Badge variant={edge.target.market === 'US' ? 'info' : 'warn'}>
                {edge.target.market}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-fg-muted">{edge.target.name}</p>
          </section>

          {edge.evidenceNewsId && (
            <section className="rounded-md border border-border bg-bg-elevated p-5 text-xs text-fg-muted">
              <h3 className="text-xs uppercase tracking-wide text-fg-subtle">Evidence</h3>
              <p className="mt-2">
                First suggested by{' '}
                <Link href={`/news`} className="text-accent hover:opacity-80">
                  article {edge.evidenceNewsId.slice(0, 8)}…
                </Link>
              </p>
            </section>
          )}
        </aside>

        <section className="lg:col-span-3">
          <RelationshipReviewForm initial={edge} />
        </section>
      </div>
    </div>
  );
}