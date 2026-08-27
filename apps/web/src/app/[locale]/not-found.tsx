import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { routing, type AppLocale } from '@/i18n/routing';

/**
 * Locale-scoped 404. Per the Next.js + next-intl convention, a `not-found.tsx`
 * inside `[locale]` is rendered *outside* the sibling `layout.tsx` (so the
 * locale layout's `<html>` / `<body>` don't apply). The root
 * `app/layout.tsx` is also a pass-through, so this file must include its
 * own document tags — otherwise Next.js throws
 * "missing root layout tags: <html>, <body>" on any unmatched URL.
 *
 * `params` is empty here (Next.js doesn't pass the locale segment when the
 * URL didn't match a route), so we render a neutral `<html>` and pull the
 * locale from the routing config's first entry as a best-effort default.
 */
export default async function NotFound() {
  const t = await getTranslations('common');
  const locale: AppLocale = routing.locales[0];

  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-bg text-fg antialiased">
        <div className="mx-auto flex max-w-screen-md flex-col items-center px-4 py-24 text-center">
          <p className="tabular text-xs text-fg-subtle">404</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
            {t('notFound')}
          </h1>
          <Link
            href={`/${locale}`}
            className="focus-ring mt-6 inline-flex items-center rounded-md border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-muted"
          >
            {t('goHome')}
          </Link>
        </div>
      </body>
    </html>
  );
}