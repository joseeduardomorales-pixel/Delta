// Vertical message thread. Auto-scrolls to bottom on new messages.

import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function MessageList({ messages, pending }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending]);

  if (messages.length === 0 && !pending) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center text-matrix-fg-muted text-sm max-w-sm">
          <p className="text-matrix-green mb-2">Delta is listening.</p>
          <p className="text-xs">
            Tell it what you did, or ask about an asset.
            <br />
            E.g. <span className="text-matrix-fg-dim">"Oil change on CC07 today"</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
      {messages.map((m, i) => (
        <MessageBubble
          key={i}
          role={m.role}
          text={m.text}
          workOrders={m.workOrders}
          error={m.error}
        />
      ))}
      {pending && (
        <div className="flex justify-start">
          <div className="px-3 py-2 text-xs text-matrix-fg-dim animate-pulse">
            Delta is thinking…
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
