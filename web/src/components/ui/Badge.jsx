// Delta — Badge / StatusPill primitive (v2).
// Pill shape, semantic color variants, optional icon, optional pulse dot.

import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

const badge = cva(
  [
    'inline-flex items-center gap-1.5',
    'px-2.5 py-0.5 rounded-full',
    'text-[11px] font-medium whitespace-nowrap',
    'border',
  ],
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground border-border',
        accent: 'bg-accent-bg text-accent border-accent/30',
        success: 'bg-success-bg text-success border-success/30',
        warning: 'bg-warning-bg text-warning border-warning/30',
        danger: 'bg-danger-bg text-danger border-danger/30',
        info: 'bg-info-bg text-info border-info/30',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({ className, tone, children, ...props }) {
  return (
    <span className={cn(badge({ tone }), className)} {...props}>
      {children}
    </span>
  );
}

const TONE_DOT = {
  neutral: 'bg-muted-foreground',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** The signature SectionLabel — uppercase mono with optional pulsing dot. */
export function SectionLabel({ tone = 'accent', pulse = false, children, className }) {
  const dotColor = TONE_DOT[tone] || TONE_DOT.accent;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1',
        tone === 'accent' && 'border border-accent/30 bg-accent-bg',
        tone === 'neutral' && 'border border-border bg-muted',
        tone === 'success' && 'border border-success/30 bg-success-bg',
        tone === 'warning' && 'border border-warning/30 bg-warning-bg',
        tone === 'danger' && 'border border-danger/30 bg-danger-bg',
        tone === 'info' && 'border border-info/30 bg-info-bg',
        className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          dotColor,
          pulse && 'animate-pulse-dot',
        )}
      />
      <span
        className={cn(
          'font-mono text-[10px] uppercase tracking-[0.15em]',
          tone === 'accent' && 'text-accent',
          tone === 'neutral' && 'text-muted-foreground',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'info' && 'text-info',
        )}
      >
        {children}
      </span>
    </div>
  );
}
