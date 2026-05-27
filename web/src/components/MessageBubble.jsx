// Delta — chat message bubble (v2 design).
// Role styling per the design system:
//   user       right-aligned, accent-tinted card
//   assistant  left-aligned, plain card with subtle shadow
//   system     centered muted line (status notices)

import { Badge } from './ui/index.js';
import { cn } from '../lib/cn.js';

function WOBadge({ wo }) {
  return (
    <Badge tone="accent" className="mr-1.5 mt-1.5">
      <span className="font-mono">WO-{wo.short_id}</span>
      <span aria-hidden className="opacity-50">·</span>
      <span>{wo.asset_unit_number}</span>
      <span aria-hidden className="opacity-50">·</span>
      <span>pending</span>
    </Badge>
  );
}

export default function MessageBubble({ role, text, workOrders, error }) {
  if (role === 'system') {
    return (
      <div className="text-center text-xs text-muted-foreground py-1.5 px-4">
        {text}
      </div>
    );
  }

  const isUser = role === 'user';
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] sm:max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed',
          isUser
            ? 'bg-accent text-accent-foreground rounded-br-sm'
            : 'bg-card border border-border shadow-sm text-foreground rounded-bl-sm',
          error && 'border-danger text-danger',
        )}
      >
        {text}
        {workOrders && workOrders.length > 0 && (
          <div className="mt-2 -mb-0.5">
            {workOrders.map((wo) => (
              <WOBadge key={wo.id} wo={wo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
