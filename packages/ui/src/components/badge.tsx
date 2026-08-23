import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular',
  {
    variants: {
      variant: {
        default: 'border-border bg-bg-muted text-fg-muted',
        positive: 'border-transparent bg-positive/15 text-positive',
        negative: 'border-transparent bg-negative/15 text-negative',
        warn: 'border-transparent bg-warn/15 text-warn',
        info: 'border-transparent bg-info/15 text-info',
        outline: 'border-border bg-transparent text-fg-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
