export type Messages = typeof import('../locales/en.json');

/**
 * Deeply-nested key path for the canonical English message catalog.
 * Used to derive `MessageKeys` for typed `useTranslations()` calls.
 */
export type MessageKeys<T = Messages> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? `${K}.${MessageKeys<T[K]>}`
    : K;
}[keyof T & string];

export type LocaleMessages = Record<string, Messages>;
