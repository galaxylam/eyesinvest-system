import './globals.css';
import type { ReactNode } from 'react';

/**
 * Minimal pass-through root layout. The actual `<html>` and `<body>` tags
 * live in `app/[locale]/layout.tsx` because next-intl requires the locale
 * segment to wrap the document.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}

export const metadata = {
  title: 'EyesInvest — Investment Intelligence',
  description:
    'Professional investment-analysis platform for US and Hong Kong equities. Quantitative analytics, market intelligence, interactive charts.',
};
