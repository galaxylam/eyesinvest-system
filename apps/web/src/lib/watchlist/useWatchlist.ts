'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Local-storage-backed watchlist of stock symbols. Pure client state — no
 * server round-trip, no auth, no schema. The watchlist page and dashboard
 * card both render this hook's `symbols` list; both subscribe to the same
 * custom event so a star click on the stock header updates the page
 * elsewhere in the same tab within one frame.
 */

const STORAGE_KEY = 'eyesinvest:watchlist';
const SYNC_EVENT = 'eyesinvest:watchlist-change';

/** Defensive read — never throws, tolerates malformed payloads. */
function readStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
  } catch {
    return [];
  }
}

function writeStorage(next: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  // Same-tab listeners don't get the `storage` event — fire a custom one.
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

export interface UseWatchlist {
  /** Symbols in the watchlist (uppercase). Empty before `hydrated`. */
  symbols: string[];
  /** False on the first render (SSR + pre-hydration) — gate UI on this. */
  hydrated: boolean;
  has: (symbol: string) => boolean;
  add: (symbol: string) => void;
  remove: (symbol: string) => void;
  toggle: (symbol: string) => void;
  clear: () => void;
}

export function useWatchlist(): UseWatchlist {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSymbols(readStorage());
    setHydrated(true);

    const refresh = () => setSymbols(readStorage());
    // Cross-tab sync.
    window.addEventListener('storage', refresh);
    // Same-tab sync (custom event fired by writeStorage).
    window.addEventListener(SYNC_EVENT, refresh as EventListener);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(SYNC_EVENT, refresh as EventListener);
    };
  }, []);

  const add = useCallback((symbol: string) => {
    const sym = symbol.toUpperCase();
    const current = readStorage();
    if (current.includes(sym)) return;
    writeStorage([...current, sym]);
  }, []);

  const remove = useCallback((symbol: string) => {
    const sym = symbol.toUpperCase();
    writeStorage(readStorage().filter((s) => s !== sym));
  }, []);

  const toggle = useCallback(
    (symbol: string) => {
      const sym = symbol.toUpperCase();
      const current = readStorage();
      writeStorage(current.includes(sym) ? current.filter((s) => s !== sym) : [...current, sym]);
    },
    [],
  );

  const clear = useCallback(() => writeStorage([]), []);

  const has = useCallback(
    (symbol: string) => symbols.includes(symbol.toUpperCase()),
    [symbols],
  );

  return { symbols, hydrated, has, add, remove, toggle, clear };
}