import { cookies } from 'next/headers';

export type Theme = 'dark' | 'light';

const THEME_COOKIE = 'ey_theme';
const DEFAULT_THEME: Theme = 'dark';

/**
 * Read theme from cookies on the server. Used by root layout to set the
 * initial `<html className>` before client hydration, eliminating flash.
 */
export async function getThemeFromCookies(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/**
 * Theme cookie name — exposed so client components can set it.
 */
export const THEME_COOKIE_NAME = THEME_COOKIE;
