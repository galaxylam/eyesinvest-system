import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@eyesinvest/ui';
import { getNewsMappingDetail } from '@/lib/news/admin-queries';
import { NewsReviewForm } from '@/components/NewsReviewForm';

interface ReviewPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Single news mapping review — article preview on the left, AI + edit
 * form on the right. Admin can approve / reject / skip; approved rows
 * become canonical and visible to the public app via RLS.
 */
export default async function NewsReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;
  const mapping = await getNewsMappingDetail(id);
  if (!mapping) notFound();

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/news" className="text-xs text-fg-muted hover:text-fg">
          ← Back to queue
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          Review mapping
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Article → <span className="font-mono">{mapping.stock.symbol}</span> impact analysis
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Article preview */}
        <aside className="space-y-4 lg:col-span-2">
          <section className="rounded-md border border-border bg-bg-elevated p-5">
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <Badge variant="info">{mapping.article.sourceName}</Badge>
              {mapping.article.publishedAt && (
                <span>{new Date(mapping.article.publishedAt).toLocaleString()}</span>
              )}
            </div>
            <h2 className="mt-3 text-base font-semibold text-fg">
              {mapping.article.title}
            </h2>
            {mapping.article.summary && (
              <p className="mt-2 text-sm text-fg-muted">{mapping.article.summary}</p>
            )}
            <a
              href={mapping.article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block break-all text-xs text-accent hover:opacity-80"
            >
              {mapping.article.sourceUrl}
            </a>
          </section>

          <section className="rounded-md border border-border bg-bg-elevated p-5">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">Stock</h3>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-base font-semibold text-fg">
                {mapping.stock.symbol}
              </span>
              <Badge variant={mapping.stock.market === 'US' ? 'info' : 'warn'}>
                {mapping.stock.market}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-fg-muted">{mapping.stock.name}</p>
          </section>
        </aside>

        {/* Review form */}
        <section className="lg:col-span-3">
          <NewsReviewForm initial={mapping} />
        </section>
      </div>
    </div>
  );
}