// Paperclip-style button that opens the native OS file picker.
// On iOS/Android with `capture="environment"`, this offers Camera / Library.

import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { cn } from '../lib/cn.js';

export default function AttachButton({ disabled, onFiles }) {
  const inputRef = useRef(null);

  function onChange(e) {
    const list = Array.from(e.target.files || []);
    if (list.length) onFiles(list);
    e.target.value = '';
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach photo"
        className={cn(
          'min-h-tap min-w-tap inline-flex items-center justify-center rounded-xl',
          'border border-border bg-card text-muted-foreground',
          'transition-all duration-base ease-out-soft',
          'hover:border-accent/40 hover:text-accent hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        <Paperclip size={18} strokeWidth={2} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={onChange}
        className="hidden"
      />
    </>
  );
}
