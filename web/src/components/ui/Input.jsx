// Delta — Input / Textarea / Select primitive (v2).
// Single shared shell; Label sits above; helper/error text sits below.

import { forwardRef, useId } from 'react';
import { cn } from '../../lib/cn.js';

const shell = [
  'w-full rounded-lg bg-card text-foreground',
  'border border-border placeholder:text-muted-foreground/60',
  'px-3 py-2.5',
  'transition-colors duration-fast',
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
  'disabled:opacity-50 disabled:cursor-not-allowed',
];

const errorShell = 'border-danger focus:border-danger focus:ring-danger/30';

function Label({ htmlFor, children, optional }) {
  if (!children) return null;
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-muted-foreground mb-1.5"
    >
      {children}
      {optional && <span className="ml-1 text-muted-foreground/60">(optional)</span>}
    </label>
  );
}

function HelperText({ text, error }) {
  if (!text) return null;
  return (
    <p className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-muted-foreground')}>
      {text}
    </p>
  );
}

export const Input = forwardRef(function Input(
  { className, label, optional, error, helper, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div>
      <Label htmlFor={inputId} optional={optional}>
        {label}
      </Label>
      <input
        id={inputId}
        ref={ref}
        className={cn(shell, error && errorShell, 'h-11 min-h-tap text-sm', className)}
        {...props}
      />
      <HelperText text={error || helper} error={Boolean(error)} />
    </div>
  );
});

export const Textarea = forwardRef(function Textarea(
  { className, label, optional, error, helper, id, rows = 3, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div>
      <Label htmlFor={inputId} optional={optional}>
        {label}
      </Label>
      <textarea
        id={inputId}
        ref={ref}
        rows={rows}
        className={cn(shell, error && errorShell, 'text-sm leading-relaxed resize-y', className)}
        {...props}
      />
      <HelperText text={error || helper} error={Boolean(error)} />
    </div>
  );
});

export const Select = forwardRef(function Select(
  { className, label, optional, error, helper, id, children, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div>
      <Label htmlFor={inputId} optional={optional}>
        {label}
      </Label>
      <div className="relative">
        <select
          id={inputId}
          ref={ref}
          className={cn(
            shell,
            error && errorShell,
            'h-11 min-h-tap text-sm appearance-none pr-9',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          ▾
        </span>
      </div>
      <HelperText text={error || helper} error={Boolean(error)} />
    </div>
  );
});
