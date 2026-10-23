'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
 * couple of times with a widening delay. The retry counter is component
 * state rather than a ref, because a refresh that comes back still
 * degraded would leave the props unchanged — a ref would keep the effect
 * from firing a second time.
 */
const MAX_ATTEMPTS = 3;

export function ScreenerAutoRetry({ degraded }: { degraded: boolean }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!degraded) {
      // Live data came back — reset the counter so a later failure starts over.
      setAttempt(0);
      return;
    }
    if (attempt >= MAX_ATTEMPTS) return;
    const delay = 800 * (attempt + 1);
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      router.refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [degraded, attempt, router]);

  return null;
}
