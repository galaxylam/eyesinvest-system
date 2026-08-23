import clsx from 'clsx';
import { direction } from '@/lib/format/quote';

interface SignedNumberProps {
  value: number | null | undefined;
  children: React.ReactNode;
  className?: string;
  /** Use 'subtle' when the number is secondary (e.g. a small caption). */
  tone?: 'normal' | 'subtle';
}

const COLOR: Record<ReturnType<typeof direction>, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-fg-muted',
};

/**
 * Wraps a pre-formatted number string and applies an up/down/flat color
 * based on the underlying signed value. Use it after `formatSignedChange`
 * or `formatSignedPercent`.
 */
export function SignedNumber({ value, children, className, tone = 'normal' }: SignedNumberProps) {
  const dir = direction(value);
  return (
    <span
      className={clsx(
        'tabular font-mono',
        COLOR[dir],
        tone === 'subtle' && 'text-xs',
        className,
      )}
    >
      {children}
    </span>
  );
}
