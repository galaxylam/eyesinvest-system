import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

interface HomeProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: HomeProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-10 sm:px-6 lg:py-16">
      <section className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-elevated px-3 py-1 text-xs uppercase tracking-wide text-fg-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            {t('phaseBadge')}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            {t('heroTitle')}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
            {t('heroSubtitle')}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/${locale}/dashboard`}
              className="focus-ring inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:opacity-90"
            >
              {t('ctaDashboard')}
            </Link>
            <Link
              href={`/${locale}/search`}
              className="focus-ring inline-flex items-center rounded-md border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-muted"
            >
              {t('ctaSearch')}
            </Link>
          </div>
        </div>

        <aside className="lg:col-span-5">
          <div className="rounded-lg border border-border bg-bg-elevated p-5">
            <h2 className="text-sm font-semibold text-fg">{t('phaseTitle')}</h2>
            <p className="mt-1 text-xs text-fg-subtle">{t('phaseSubtitle')}</p>
            <ul className="mt-4 space-y-2 text-sm text-fg-muted">
              <Feature text={t('phaseBullet1')} />
              <Feature text={t('phaseBullet2')} />
              <Feature text={t('phaseBullet3')} />
              <Feature text={t('phaseBullet4')} />
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <CheckIcon />
      <span>{text}</span>
    </li>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
