import type { Market } from './market';
import type { MarketStatus } from './quote';

/**
 * Per-market trading session definition. Half-days (Christmas Eve, Lunar
 * New Year Eve) are not yet modelled — they're deferred to Phase 3+.
 */
export interface MarketSession {
  market: Market;
  /** IANA timezone name, e.g. 'America/New_York'. */
  timezone: string;
  /** 'HH:mm' in the market's local timezone. */
  open: string;
  /** 'HH:mm' in the market's local timezone. */
  close: string;
  /** ISO weekday numbers (0=Sun..6=Sat) on which the market trades. */
  tradingDays: number[];
}

export const MARKET_SESSIONS: Record<Market, MarketSession> = {
  US: {
    market: 'US',
    timezone: 'America/New_York',
    open: '09:30',
    close: '16:00',
    tradingDays: [1, 2, 3, 4, 5],
  },
  HK: {
    market: 'HK',
    timezone: 'Asia/Hong_Kong',
    open: '09:30',
    close: '16:00',
    tradingDays: [1, 2, 3, 4, 5],
  },
};

/**
 * Compute the current session status for `market` at `now` (defaults to the
 * current wall-clock time in the server's runtime). Pre-market / post-market
 * windows aren't modelled yet — anything within the trading day is 'open',
 * otherwise 'closed'.
 */
export function getMarketStatus(market: Market, now: Date = new Date()): MarketStatus {
  const session = MARKET_SESSIONS[market];

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: session.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[weekdayStr] ?? -1;

  if (!session.tradingDays.includes(weekday)) return 'closed';

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const nowMinutes = hour * 60 + minute;

  const [openHStr, openMStr] = session.open.split(':');
  const [closeHStr, closeMStr] = session.close.split(':');
  const openH = Number(openHStr ?? '0');
  const openM = Number(openMStr ?? '0');
  const closeH = Number(closeHStr ?? '0');
  const closeM = Number(closeMStr ?? '0');
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (nowMinutes < openMinutes) return 'closed';
  if (nowMinutes >= closeMinutes) return 'closed';
  return 'open';
}
