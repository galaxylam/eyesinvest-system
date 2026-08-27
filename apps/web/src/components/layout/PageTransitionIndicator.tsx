'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Small inline spinner that lives in the header next to the nav. Lights up
 * during every Next.js route transition.
 *
 * Two detection paths:
 *  1. **Click / popstate listener** — catches navigation *start*. Clicking
 *     an internal `<Link>` or hitting browser back/forward flips `pending`
 *     to true immediately, before the new RSC payload even begins
 *     streaming. App Router has no native "navigation start" hook, so we
 *     attach a capture-phase document listener that walks up to the
 *     nearest `<a href>` and resolves it against `location`. This is the
 *     same approach `nprogress` / `next-progress` use.
 *  2. **usePathname / useSearchParams effect** — fallback for
 *     programmatic navigation (`router.push`, `router.replace`, the
 *     search bar, the screener filter swap, etc.) where no click event
 *     fires. Fires at the end of the transition, but it's the best
 *     signal we have for those code paths.
 *
 * The settle window is intentionally generous (800ms) so the spinner
 * stays visible across the typical page-transition window — any shorter
 * and it tends to disappear before the user notices it.
 */
export function PageTransitionIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const firstPathnameRender = useRef(true);

  // Pathname / searchParams fallback for programmatic navigation.
  useEffect(() => {
    if (firstPathnameRender.current) {
      firstPathnameRender.current = false;
      return;
    }
    setPending(true);
    const timer = setTimeout(() => setPending(false), 800);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  // Click + popstate listener — fires at navigation START.
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    function flash() {
      setPending(true);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setPending(false), 800);
    }

    function isInternalNavigation(anchor: HTMLAnchorElement): boolean {
      if (anchor.target && anchor.target !== '' && anchor.target !== '_self') return false;
      if (anchor.hasAttribute('download')) return false;
      // modifier-keys + non-primary mouse buttons should not trigger (browser
      // handles them — open-in-new-tab etc).
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return false;
      }
      if (url.origin !== window.location.origin) return false;
      // Same URL → treat as no-op (still flash because usePathname will
      // also fire and reset pending, so worst case is a brief blink).
      return true;
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (a && isInternalNavigation(a)) flash();
    }

    function onPopState() {
      flash();
    }

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  return (
    <span
      role="status"
      aria-live="polite"
      aria-busy={pending || undefined}
      aria-hidden={!pending}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={
          'h-3.5 w-3.5 animate-spin text-accent transition-opacity duration-200 ' +
          (pending ? 'opacity-100' : 'opacity-0')
        }
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
    </span>
  );
}