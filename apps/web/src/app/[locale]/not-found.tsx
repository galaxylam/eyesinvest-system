import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <div className="mx-auto flex max-w-screen-md flex-col items-center px-4 py-24 text-center">
      <p className="tabular text-xs text-fg-subtle">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
        {t('notFound')}
      </h1>
      <Link
        href="/en"
        className="focus-ring mt-6 inline-flex items-center rounded-md border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-muted"
      >
        {t('goHome')}
      </Link>
    </div>
  );
}
