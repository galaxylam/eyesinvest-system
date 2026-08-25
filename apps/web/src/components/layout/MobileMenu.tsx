'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

interface MobileMenuProps {
  /** Same routes shown in the desktop nav, in display order. */
  links: Array<{ href: string; label: string }>;
}

/**
 * Mobile-only hamburger toggle. Renders a button on small screens (md:hidden)
 * which opens a dropdown panel below the header listing the primary nav links.
 * Closes on:
 *   - clicking outside the panel
 *   - pressing Escape
 *   - navigation (route change)
 */
export function MobileMenu({ links }: MobileMenuProps) {
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close on route change — the panel was opened on the previous URL.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on click outside + Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative md:hidden">
      <button
        type="button"
        aria-label={open ? tCommon('cancel') : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg-elevated text-fg-muted hover:text-fg"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open && (
        <div
          id="mobile-menu-panel"
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-bg-elevated p-1 shadow-lg"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              className="block rounded px-3 py-2 text-sm text-fg hover:bg-bg-muted"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
