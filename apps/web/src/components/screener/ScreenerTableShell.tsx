'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useScreenerTransition } from './ScreenerTransitionContext';

/**
 * Wraps `<ScreenerTable>` and shows a translucent overlay + centered spinner
 * whenever the screener is mid-transition (a filter change triggered a server
 * re-render that's still in flight). The table itself stays visible underneath
 * so layout doesn't jump; the overlay just signals "still updating" without
 * flashing to a blank state.
 */
export function ScreenerTableShell({ children }: { children: ReactNode }) {
  const { pending } = useScreenerTransition();
  const t = useTranslations('screener');

  return (
    <div className="relative">
      {children}

      {pending && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-bg/70 backdrop-blur-[1px]"
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-fg shadow-sm">
            <Spinner />
            <span>{t('loading')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-accent"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}