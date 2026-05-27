// Delta — Button primitive (v2 design system).
// See docs/design-system-v2.md §4.
//
// Variants × sizes × states, composed with cva + cn(). Caller can
// pass `className` to override anything — twMerge resolves conflicts.

import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const button = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'font-sans font-medium whitespace-nowrap',
    'rounded-xl border border-transparent',
    'transition-all duration-base ease-out-soft',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
    'active:scale-[0.98]',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-gradient-accent text-accent-foreground shadow-sm',
          'hover:shadow-accent hover:-translate-y-0.5 hover:brightness-110',
        ],
        secondary: [
          'bg-card text-foreground border-border shadow-sm',
          'hover:border-accent/40 hover:shadow-md',
        ],
        ghost: [
          'bg-transparent text-muted-foreground',
          'hover:bg-muted hover:text-foreground',
        ],
        danger: [
          'bg-card text-danger border-danger/40 shadow-sm',
          'hover:bg-danger hover:text-white hover:border-danger',
        ],
      },
      size: {
        sm: 'h-9 px-3 text-[11px] uppercase tracking-widest',
        md: 'h-11 px-4 text-sm min-h-tap',
        lg: 'h-14 px-6 text-base min-h-tap',
        icon: 'h-11 w-11 p-0 min-h-tap min-w-tap',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

const Button = forwardRef(function Button(
  { className, variant, size, loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
});

export { Button, button as buttonVariants };
