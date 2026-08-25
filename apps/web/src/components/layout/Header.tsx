import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LangSwitcher } from './LangSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { SearchBar } from '@/components/search/SearchBar';

interface HeaderProps {
  locale: string;
}

export async function Header({ locale }: HeaderProps) {
  const t = await getTranslations('nav');
  const tCommon = await getTranslations('common');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
        {/* Brand */}
        <Link
          href={`/${locale}`}
          className="focus-ring flex items-center gap-2 rounded-md px-1 py-1 text-fg"
        >
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">
            {tCommon('brand')}
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="hidden items-center gap-1 text-sm text-fg-muted md:flex">
          <NavLink href={`/${locale}/dashboard`}>{t('dashboard')}</NavLink>
          <NavLink href={`/${locale}/watchlist`}>{t('watchlist')}</NavLink>
          <NavLink href={`/${locale}/screener`}>{t('screener')}</NavLink>
          <NavLink href={`/${locale}/heatmap`}>{t('heatmap')}</NavLink>
          <NavLink href={`/${locale}/rankings`}>{t('rankings')}</NavLink>
          <NavLink href={`/${locale}/news`}>{t('news')}</NavLink>
          <NavLink href={`/${locale}/ai`}>{t('ai')}</NavLink>
        </nav>

        {/* Search */}
        <div className="flex-1 max-w-md">
          <SearchBar locale={locale} />
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-2">
          <LangSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring rounded-md px-2.5 py-1.5 transition-colors hover:bg-bg-muted hover:text-fg"
    >
      {children}
    </Link>
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-6 w-6 text-accent"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        d="M3 22 L10 14 L15 18 L22 9 L29 14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22" cy="9" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="3" cy="22" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
