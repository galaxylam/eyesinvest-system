'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { useTransition, type ChangeEvent } from 'react';
import { LOCALES } from '@eyesinvest/types';

const LABELS: Record<string, string> = {
  en: 'English',
  'zh-HK': '繁體中文',
  'zh-CN': '简体中文',
};

/**
 * Compact language switcher. Updates the URL prefix, then refreshes the
 * route. Cookie persistence for next-intl happens automatically via the
 * middleware when the prefix changes.
 */
export function LangSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    // Strip the existing locale segment and prepend the new one.
    const segments = pathname.split('/').filter(Boolean);
    if (LOCALES.includes(segments[0] as (typeof LOCALES)[number])) {
      segments.shift();
    }
    const nextPath = `/${next}${segments.length ? '/' + segments.join('/') : ''}`;
    startTransition(() => {
      router.replace(nextPath);
      router.refresh();
    });
  }

  return (
    <label className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <span className="sr-only">Language</span>
      <select
        value={locale}
        onChange={onChange}
        disabled={isPending}
        aria-label="Language"
        className="focus-ring h-9 cursor-pointer rounded-md border border-border bg-bg-elevated px-2 text-sm text-fg transition-colors hover:bg-bg-muted disabled:opacity-50"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LABELS[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  );
}
