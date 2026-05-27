// Mobile-first text input + send button. The native OS keyboard
// provides the mic for dictation — no in-app transcription.
// Cmd/Ctrl+Enter (and bare Enter on desktop) sends. On mobile we keep
// Enter as newline so users can compose multi-line dictations.

import { useRef, useState } from 'react';

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('');
  const taRef = useRef(null);

  function adjustHeight() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  async function submit() {
    const value = text.trim();
    if (!value || disabled) return;
    setText('');
    requestAnimationFrame(adjustHeight);
    await onSend(value);
  }

  function onKey(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-matrix-green-line bg-matrix-black px-3 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            adjustHeight();
          }}
          onKeyDown={onKey}
          placeholder="Tap to type or dictate…"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent border border-matrix-green-line focus:border-matrix-green outline-none rounded-md px-3 py-3 text-base text-matrix-green placeholder-matrix-fg-muted min-h-tap disabled:opacity-50"
          aria-label="Message"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="min-h-tap min-w-tap px-4 rounded-md border border-matrix-green text-matrix-green hover:shadow-matrix-glow disabled:opacity-40 disabled:cursor-not-allowed text-sm uppercase tracking-widest transition-base"
          aria-label="Send"
        >
          Send
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-matrix-fg-muted text-center sm:text-right">
        ⌘/Ctrl + Enter to send
      </p>
    </div>
  );
}
