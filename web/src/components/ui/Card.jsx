// Delta — Card primitive (v2).
// Standard cards sit at shadow-sm; interactive cards lift on hover.
// FeatureCard uses the gradient-border trick from the design system.

import { cn } from '../../lib/cn.js';

export function Card({ className, interactive = false, as: As = 'div', ...props }) {
  return (
    <As
      className={cn(
        'rounded-xl bg-card border border-border shadow-sm',
        interactive && [
          'transition-all duration-base ease-out-soft',
          'hover:shadow-md hover:-translate-y-0.5',
          'focus-within:shadow-md',
        ],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('p-5 pb-3', className)} {...props} />;
}

export function CardBody({ className, ...props }) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 px-5 py-4 border-t border-border',
        className,
      )}
      {...props}
    />
  );
}

/** Featured / highlighted card — 2px gradient border around a white interior. */
export function FeatureCard({ className, innerClassName, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-gradient-accent-diagonal p-[2px]',
        'shadow-accent',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'rounded-[calc(0.75rem-2px)] bg-card h-full w-full',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
