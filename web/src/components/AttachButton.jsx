// Paperclip-style button that opens the native OS file picker.
// On iOS/Android with `capture="environment"`, this offers Camera / Library.
// Files are passed up to the parent via onFiles(File[]).

import { useRef } from 'react';
import { Paperclip } from 'lucide-react';

export default function AttachButton({ disabled, onFiles }) {
  const inputRef = useRef(null);

  function onChange(e) {
    const list = Array.from(e.target.files || []);
    if (list.length) onFiles(list);
    // Reset so picking the same file twice still fires onChange.
    e.target.value = '';
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach photo"
        className="min-h-tap min-w-tap inline-flex items-center justify-center rounded-md border border-matrix-green-line text-matrix-fg-dim hover:text-matrix-green hover:border-matrix-green disabled:opacity-40 disabled:cursor-not-allowed transition-base"
      >
        <Paperclip size={18} strokeWidth={1.5} />
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
