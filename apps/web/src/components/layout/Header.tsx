import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LangSwitcher } from './LangSwitcher';
import { MobileMenu } from './MobileMenu';
import { ThemeToggle } from './ThemeToggle';
import { PageTransitionIndicator } from './PageTransitionIndicator';
import { SearchBar } from '@/components/search/SearchBar';

interface HeaderProps {
  locale: string;
}

export async function Header({ locale }: HeaderProps) {
  const t = await getTranslations('nav');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
        {/* Mobile menu (hamburger) — leftmost on small screens, hidden on md+ */}
        <MobileMenu
          links={[
            { href: `/${locale}/dashboard`, label: t('dashboard') },
            { href: `/${locale}/watchlist`, label: t('watchlist') },
            { href: `/${locale}/screener`, label: t('screener') },
            { href: `/${locale}/news`, label: t('news') },
          ]}
        />

        {/* Primary nav (desktop only) */}
        <nav className="hidden items-center gap-1 text-sm text-fg-muted md:flex">
          <NavLink href={`/${locale}/dashboard`}>{t('dashboard')}</NavLink>
          <NavLink href={`/${locale}/watchlist`}>{t('watchlist')}</NavLink>
          <NavLink href={`/${locale}/screener`}>{t('screener')}</NavLink>
          <NavLink href={`/${locale}/news`}>{t('news')}</NavLink>
        </nav>

        {/* Page-transition spinner — sits beside the desktop nav. Sized
            with a fixed 20px box so it doesn't shift the surrounding
            layout when fading in / out. Hidden on mobile (no nav links
            to sit beside). */}
        <div className="hidden md:flex">
          <PageTransitionIndicator />
        </div>

        {/* Search */}
        <div className="flex-1 sm:max-w-2xl">
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
