// Vertical chat thread. Auto-scrolls to bottom on new messages.
// Restrained motion per v2 design (no decorative entrance animations
// on the chat surface).

import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';
import { SectionLabel } from './ui/index.js';

export default function MessageList({ messages, pending }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending]);

  if (messages.length === 0 && !pending) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <SectionLabel tone="accent" pulse>
            Listening
          </SectionLabel>
          <p className="mt-4 text-base font-display tracking-tight">
            Tell <span className="text-gradient">Delta</span> what you did,
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            or ask about an asset.
          </p>
          <p className="mt-4 text-xs text-muted-foreground/70">
            e.g. <span className="font-mono text-foreground/70">"Oil change on CC07 today"</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2.5">
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
          <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-muted text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-xs font-mono uppercase tracking-widest">thinking</span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
