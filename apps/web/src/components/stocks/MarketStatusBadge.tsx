'use client';

import { useTranslations } from 'next-intl';
import type { MarketStatus } from '@eyesinvest/types';

interface MarketStatusBadgeProps {
  status: MarketStatus;
  className?: string;
}

const DOT_COLOR: Record<MarketStatus, string> = {
  open: 'bg-emerald-400',
  closed: 'bg-fg-subtle',
  pre: 'bg-amber-400',
  post: 'bg-amber-400',
};

/**
 * Pill with a colored dot + label indicating whether the market session is
 * open, closed, pre-market, or post-market.
 */
export function MarketStatusBadge({ status, className = '' }: MarketStatusBadgeProps) {
  const t = useTranslations('stock');
  const key = `marketStatus${status.charAt(0).toUpperCase() + status.slice(1)}` as
    | 'marketStatusOpen'
    | 'marketStatusClosed'
    | 'marketStatusPre'
    | 'marketStatusPost';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-muted px-2 py-0.5 text-xs text-fg-muted ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[status]}`} aria-hidden="true" />
      {t(key)}
    </span>
  );
}
