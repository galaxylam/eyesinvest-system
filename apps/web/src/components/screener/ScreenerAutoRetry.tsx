'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Auto-runs the screener query when the server had to fall back to mock
 * data because the live query failed.
 *
 * Why this exists: the screener is a server component, so the rows arrive
 * with the HTML. When the live Supabase query transiently failed (the
 * hosted project enforces a Postgres `statement_timeout`), the page came
 * back with the "demo data" banner and the user had to press Search to
 * get the real rows — the very first visit to a shared URL showed the
 * wrong thing.
 *
 * This component re-runs the same server render (`router.refresh()`) a
 * couple of times with a widening delay. It stops as soon as the server
 * returns live data, and it gives up after a few attempts so a genuinely
 * broken feed can't loop forever.
 */
export function ScreenerAutoRetry({ degraded }: { degraded: boolean }) {
  const router = useRouter();
  const attempts = useRef(0);

  useEffect(() => {
    if (!degraded) {
      // Live data came back — reset the counter so a later failure starts over.
      attempts.current = 0;
      return;
    }
    if (attempts.current >= 3) return;
    const delay = 800 * (attempts.current + 1);
    const timer = setTimeout(() => {
      attempts.current += 1;
      router.refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [degraded, router]);

  return null;
}
