/**
 * Date / time formatting helpers. Market-aware timezone formatting will be
 * added in Phase 2 once market metadata is wired up.
 */

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${formatDate(d)} ${formatTime(d)}`;
}

/** Human-readable "x minutes ago" relative time. */
export function formatRelative(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * Compact "MMM D" / "M/D" label for sub-chart x-axes. Locale-aware: en-GB
 * yields "5 Mar 2024", en-US yields "Mar 5, 2024", zh-HK yields "3月5日".
 * If `includeYear` is true and the date is in a different year than now,
 * appends the year for clarity on the 3Y view.
 */
export function formatShortDate(
  date: Date | string,
  opts: { locale?: string; includeYear?: boolean } = {},
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const locale = opts.locale;
  const sameYear =
    !opts.includeYear || d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}
