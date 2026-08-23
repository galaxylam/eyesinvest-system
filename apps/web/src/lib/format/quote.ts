/**
 * Phase 2 market-data formatters. Backed by Intl.NumberFormat so the locale
 * drives digit grouping and decimal separators; the `currency` argument
 * drives the symbol. Uses `currencyDisplay: 'narrowSymbol'` so USD prints
 * as `$1.23` rather than `US$1.23`.
 */

const SUPPORTED_CURRENCIES = new Set(['USD', 'HKD', 'CNY', 'JPY']);

function safeLocale(locale: string): string {
  // next-intl locales we ship are 'en', 'zh-HK', 'zh-CN' — all valid BCP-47.
  return locale || 'en';
}

function safeCurrency(code: string): string {
  return SUPPORTED_CURRENCIES.has(code) ? code : 'USD';
}

const PRICE_CACHE = new Map<string, Intl.NumberFormat>();
function priceFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let fmt = PRICE_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(safeLocale(locale), {
      style: 'currency',
      currency: safeCurrency(currency),
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    PRICE_CACHE.set(key, fmt);
  }
  return fmt;
}

export function formatPrice(value: number, currency: string, locale = 'en'): string {
  return priceFormatter(locale, currency).format(value);
}

/**
 * Signed currency amount. Zero prints as plain `formatPrice(0)` (no `+`).
 * `null`/`undefined` → '—'.
 */
export function formatSignedChange(
  value: number | null | undefined,
  currency: string,
  locale = 'en',
): string {
  if (value == null || Number.isNaN(value)) return '—';
  const base = priceFormatter(locale, currency);
  if (value === 0) return base.format(0);
  return `${value > 0 ? '+' : ''}${base.format(value)}`;
}

const PERCENT_CACHE = new Map<string, Intl.NumberFormat>();
function percentFormatter(locale: string): Intl.NumberFormat {
  let fmt = PERCENT_CACHE.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(safeLocale(locale), {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: 'exceptZero',
    });
    PERCENT_CACHE.set(locale, fmt);
  }
  return fmt;
}

/**
 * Render a percent change. Accepts the percent as already-scaled (e.g. 2.34
 * for +2.34%) — converts to a fraction internally.
 */
export function formatSignedPercent(value: number | null | undefined, locale = 'en'): string {
  if (value == null || Number.isNaN(value)) return '—';
  return percentFormatter(locale).format(value / 100);
}

const COMPACT_CACHE = new Map<string, Intl.NumberFormat>();
function compactFormatter(locale: string): Intl.NumberFormat {
  let fmt = COMPACT_CACHE.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(safeLocale(locale), {
      notation: 'compact',
      maximumFractionDigits: 2,
    });
    COMPACT_CACHE.set(locale, fmt);
  }
  return fmt;
}

/** Compact volume: 1,234,567 → "1.23M". */
export function formatVolume(value: number | null | undefined, locale = 'en'): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value === 0) return compactFormatter(locale).format(0);
  return compactFormatter(locale).format(value);
}

/** Format a market-cap dollar amount as a compact currency figure. */
export function formatMarketCap(value: number | null | undefined, locale = 'en'): string {
  if (value == null || Number.isNaN(value)) return '—';
  const fmt = new Intl.NumberFormat(safeLocale(locale), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 2,
  });
  return fmt.format(value);
}

/** '2026-08-22' → 'as of 2026-08-22' (locale kept simple — YYYY-MM-DD is universal). */
export function formatAsOf(isoDate: string): string {
  return `as of ${isoDate}`;
}

/** Direction for a numeric change. 'flat' for zero / null. */
export function direction(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (value == null || Number.isNaN(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}
