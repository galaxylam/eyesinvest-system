import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * next-intl v3 request config. The middleware has already validated the
 * locale against `routing.locales`, but we double-check here so direct
 * RSC loads (e.g. via server actions) stay safe.
 *
 * Messages live in `apps/web/messages/` so next-intl's runtime resolver
 * (which doesn't traverse the workspace package's `exports` wildcard
 * reliably) can find them. The canonical copy in `packages/i18n/locales/`
 * is the source of truth — `messages/` is regenerated from it via the
 * "sync locales" snippet in apps/web/README.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // next-intl 3.22+ requires awaiting the request-scoped locale promise
  // rather than reading the `locale` field synchronously. Falls back to
  // the configured default when no locale is in scope (e.g. for a
  // /not-found render outside the locale segment).
  const requested = await requestLocale;
  const safeLocale = (
    routing.locales as readonly string[]
  ).includes(requested ?? '')
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  const messages = (await import(`../../messages/${safeLocale}.json`)).default;

  return {
    locale: safeLocale,
    messages,
  };
});
