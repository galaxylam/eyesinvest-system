import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'EyesInvest Admin',
  description: 'Local admin portal for the EyesInvest platform.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
