/**
 * Number / currency formatters. Tabular numerals are applied at the CSS
 * layer; here we focus on sign prefixes, abbreviation, and locale-aware
 * currency display.
 */

const SIGN_PREFIX_RE = /^-/;

export function formatPercent(value: number, opts: { digits?: number; signed?: boolean } = {}): string {
  const { digits = 2, signed = true } = opts;
  const formatted = Math.abs(value).toFixed(digits);
  if (!signed) return `${formatted}%`;
  if (value > 0) return `+${formatted}%`;
  if (value < 0) return `-${formatted}%`;
  return `${formatted}%`;
}

export function formatDecimal(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** Format a decimal as a signed number with consistent sign prefix. */
export function formatSigned(value: number, digits = 2): string {
  if (value > 0) return `+${value.toFixed(digits)}`;
  if (value < 0) return value.toFixed(digits); // already has minus
  return value.toFixed(digits);
}

/** Compact abbreviation: 1,234,567 -> 1.23M; 1.5B; 980k. */
export function formatCompact(value: number, digits = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}k`;
  return `${sign}${abs.toFixed(digits)}`;
}

/** Format a price with the appropriate currency symbol. */
export function formatPrice(value: number, currency: string): string {
  const symbol = currencySymbol(currency);
  return `${symbol}${value.toFixed(2)}`;
}

export function currencySymbol(code: string): string {
  switch (code) {
    case 'USD':
      return 'US$';
    case 'HKD':
      return 'HK$';
    case 'CNY':
      return '¥';
    case 'JPY':
      return '¥';
    default:
      return `${code} `;
  }
}

/**
 * Strip a leading minus from a signed string so we can display a colored
 * arrow next to it.
 */
export function stripSign(value: string): string {
  return value.replace(SIGN_PREFIX_RE, '');
}

/** Direction: 'up' | 'down' | 'flat'. */
export function direction(value: number): 'up' | 'down' | 'flat' {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}
