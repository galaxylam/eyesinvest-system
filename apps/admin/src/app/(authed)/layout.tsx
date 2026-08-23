import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Admin shell — Phase 1 ships without login: the admin app is bound to
 * localhost:3001 and intended for local development use only. A real
 * `ey_admin_users` table + session-based auth lands in a later phase.
 *
 * The (authed) route group is kept so we can re-introduce a guard later
 * without touching the page tree.
 */
interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-bg-elevated md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight text-fg">Admin</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3 text-sm">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/stocks">Stocks</NavLink>
          <NavLink href="/settings">Settings</NavLink>
        </nav>
        <div className="border-t border-border p-3 text-xs text-fg-muted">
          <p>Local dev — no auth</p>
          <p className="mt-1 text-fg-subtle">Bind to 127.0.0.1 only</p>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
    >
      {children}
    </Link>
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-5 w-5 text-accent"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 22 L10 14 L15 18 L22 9 L29 14" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="9" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}