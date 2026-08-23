import './../globals.css';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing, type AppLocale } from '@/i18n/routing';
import { getThemeFromCookies } from '@/lib/theme';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as AppLocale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();
  const theme = await getThemeFromCookies();

  return (
    <html lang={locale} className={theme === 'light' ? 'light' : 'dark'}>
      <body className="min-h-screen bg-bg text-fg antialiased">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider initialTheme={theme}>
            <QueryProvider>
              <div className="flex min-h-screen flex-col">
                <Header locale={locale} />
                <main className="flex-1">{children}</main>
                <Footer />
              </div>
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
