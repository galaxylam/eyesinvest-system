/**
 * Supported UI locales. The default is English. zh-HK is Traditional
 * Chinese (used for Hong Kong); zh-CN is Simplified Chinese.
 */
export const LOCALES = ['en', 'zh-HK', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-HK': '繁體中文',
  'zh-CN': '简体中文',
};
