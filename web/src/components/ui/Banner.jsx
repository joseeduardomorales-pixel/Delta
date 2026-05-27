// Delta — Banner primitive (v2).
// Top-of-page / top-of-section alert. Semantic tones map to the
// tinted bg + colored border + leading icon.

import { X, AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const TONE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
  info: Info,
};

const TONE_CLASS = {
  success: 'bg-success-bg border-success/40 text-success',
  warning: 'bg-warning-bg border-warning/40 text-warning',
  danger: 'bg-danger-bg border-danger/40 text-danger',
  info: 'bg-info-bg border-info/40 text-info',
};

export function Banner({ tone = 'info', title, children, onDismiss, className }) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && (
          <p className={cn('leading-snug', title && 'mt-0.5 text-foreground/80')}>
            {children}
          </p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 -m-1 p-1 rounded-md text-foreground/40 hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
