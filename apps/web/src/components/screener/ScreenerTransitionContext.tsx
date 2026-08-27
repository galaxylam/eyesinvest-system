'use client';

import { createContext, useContext, useTransition, type ReactNode } from 'react';

interface ScreenerTransitionContextValue {
  /** True while a filter-driven `router.replace` is in flight. */
  pending: boolean;
  /** Wraps the URL update so React shows the new content without blocking
   *  the existing UI (matches React 19's transition-aware Suspense behavior). */
  startTransition: (callback: () => void) => void;
}

const ScreenerTransitionContext = createContext<ScreenerTransitionContextValue | null>(null);

/**
 * Single source of truth for the screener's pending state. Both the filter
 * bar (`ScreenerFilters`) and the table wrapper (`ScreenerTableShell`)
 * read from this context so the spinner in the bar stays in sync with the
 * dimming overlay on the table — they both flip on the same transition.
 *
 * Owns the `useTransition` hook so the pending state isn't duplicated across
 * components (each `useTransition()` creates an independent pending flag).
 */
export function ScreenerTransitionProvider({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  return (
    <ScreenerTransitionContext.Provider value={{ pending, startTransition }}>
      {children}
    </ScreenerTransitionContext.Provider>
  );
}

export function useScreenerTransition(): ScreenerTransitionContextValue {
  const ctx = useContext(ScreenerTransitionContext);
  if (!ctx) {
    throw new Error('useScreenerTransition must be used inside <ScreenerTransitionProvider>');
  }
  return ctx;
}