import { Suspense } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { MARKET_INDICES } from '@eyesinvest/types';
import { getIndexQuotes, getTopMoversWithChange } from '@/lib/stocks/queries';
import { SignedNumber } from '@/components/stocks/SignedNumber';
import { formatSignedPercent } from '@/lib/format/quote';
import { DashboardWatchlistCard } from '@/components/watchlist/DashboardWatchlistCard';

interface DashboardProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage({ params }: DashboardProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {t('title')}
        </h1>
        <p className="tabular text-xs text-fg-subtle">{t('lastUpdated')}: —</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<CardSkeleton title={t('watchlist')} />}>
          <DashboardWatchlistCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton title={t('topMovers')} />}>
          <TopMoversCard locale={locale} />
        </Suspense>
        <Suspense fallback={<CardSkeleton title={t('marketSummary')} />}>
          <MarketSummaryCard />
        </Suspense>
      </div>

      <section className="mt-8 rounded-lg border border-border bg-bg-elevated p-6">
        <h2 className="text-sm font-semibold text-fg">{t('phaseNoteTitle')}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t('phaseNoteBody')}</p>
      </section>
    </div>
  );
}

function CardSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="h-4 w-24 animate-pulse rounded bg-bg-muted" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-bg-muted" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-bg-muted" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-bg-muted" />
      </div>
      <span className="sr-only">{title}</span>
    </div>
  );
}

async function TopMoversCard({ locale }: { locale: string }) {
  const t = await getTranslations('dashboard');
  const { data, source } = await getTopMoversWithChange({ limit: 5 });
  return (
    <Card
      title={t('topMovers')}
      subtitle={t('topMoversSubtitle')}
    >
      <ul className="space-y-1.5 text-sm">
        {data.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <Link
              href={`/${locale}/stocks/${encodeURIComponent(s.symbol)}`}
              className="tabular font-mono text-xs text-fg hover:text-accent"
            >
              {s.symbol}
            </Link>
            <span className="flex-1 truncate text-xs text-fg-muted">{s.name}</span>
            <SignedNumber value={s.changePercent} className="text-xs">
              {formatSignedPercent(s.changePercent, locale)}
            </SignedNumber>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-2xs text-fg-subtle">
        {source === 'supabase' ? `Source: Supabase (ey_v_top_movers)` : 'Source: mock fallback'}
      </p>
    </Card>
  );
}

async function MarketSummaryCard() {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const { data, source } = await getIndexQuotes();

  const spx = data.find((q) => q.code === 'SPX') ?? null;
  const hsi = data.find((q) => q.code === 'HSI') ?? null;

  const fmtIndex = (last: number, decimals = 2): string => {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(last);
  };

  return (
    <Card title={t('marketSummary')} subtitle={t('marketSummaryLiveSubtitle')}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-2xs uppercase tracking-wide text-fg-subtle">
            {MARKET_INDICES.SPX[`name${localeNameSuffix(locale)}` as keyof typeof MARKET_INDICES.SPX]}
          </dt>
          <dd className="tabular mt-0.5 text-sm font-medium text-fg">
            {spx ? fmtIndex(spx.last) : '—'}
          </dd>
          <dd className="tabular mt-0.5">
            {spx ? (
              <SignedNumber value={spx.changePercent} className="text-2xs">
                {formatSignedPercent(spx.changePercent, locale)}
              </SignedNumber>
            ) : (
              <span className="text-2xs text-fg-subtle">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wide text-fg-subtle">
            {MARKET_INDICES.HSI[`name${localeNameSuffix(locale)}` as keyof typeof MARKET_INDICES.HSI]}
          </dt>
          <dd className="tabular mt-0.5 text-sm font-medium text-fg">
            {hsi ? fmtIndex(hsi.last, 0) : '—'}
          </dd>
          <dd className="tabular mt-0.5">
            {hsi ? (
              <SignedNumber value={hsi.changePercent} className="text-2xs">
                {formatSignedPercent(hsi.changePercent, locale)}
              </SignedNumber>
            ) : (
              <span className="text-2xs text-fg-subtle">—</span>
            )}
          </dd>
        </div>
        <SummaryItem label={t('usAdv')} value="—" />
        <SummaryItem label={t('hkAdv')} value="—" />
      </dl>
      <p className="mt-3 text-2xs text-fg-subtle">
        {source === 'supabase' ? 'Source: Supabase (ey_index_quote)' : 'Source: mock fallback'}
      </p>
    </Card>
  );
}

/** 'en' → 'En', 'zh-HK' → 'ZhHk', 'zh-CN' → 'ZhCn'. Matches MARKET_INDICES name* keys. */
function localeNameSuffix(locale: string): string {
  if (locale.startsWith('zh-HK')) return 'ZhHk';
  if (locale.startsWith('zh-CN')) return 'ZhCn';
  return 'En';
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {subtitle && <span className="text-2xs text-fg-subtle">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}
