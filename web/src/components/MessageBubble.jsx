// A single chat message. Role determines style and side.
//  - user:      right-aligned, green border
//  - assistant: left-aligned, green text on near-black bg
//  - system:    centered, muted (status notices, undo hints)

import clsx from 'clsx';

function WOBadge({ wo }) {
  return (
    <span className="inline-block px-2 py-0.5 mr-2 mb-1 text-[10px] uppercase tracking-wider border border-matrix-green-line text-matrix-green rounded">
      WO-{wo.short_id} · {wo.asset_unit_number} · pending review
    </span>
  );
}

export default function MessageBubble({ role, text, workOrders, error }) {
  if (role === 'system') {
    return (
      <div className="text-center text-xs text-matrix-fg-muted py-2 px-4">
        {text}
      </div>
    );
  }

  const isUser = role === 'user';
  return (
    <div className={clsx('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
          isUser
            ? 'bg-matrix-green-faint text-matrix-fg border border-matrix-green-line'
            : 'bg-black text-matrix-green border border-matrix-green-line shadow-matrix-glow',
          error && 'border-matrix-red text-matrix-red',
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
