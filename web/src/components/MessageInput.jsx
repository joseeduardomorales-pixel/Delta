// Mobile-first text input + attach + send. The native OS keyboard
// provides the mic for dictation — no in-app transcription. Photos
// upload optimistically (preview shown immediately, upload kicks off
// in background, dot indicator turns green when done).

import { useRef, useState } from 'react';
import AttachButton from './AttachButton.jsx';
import PhotoPreview from './PhotoPreview.jsx';
import { uploadPhotos } from '../lib/upload.js';

export default function MessageInput({ onSend, disabled, accessToken }) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]); // [{localId, name, file, previewUrl, status, staging_path?}]
  const taRef = useRef(null);
  const nextId = useRef(1);

  function adjustHeight() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  async function onFiles(files) {
    const next = files.slice(0, 5 - photos.length).map((f) => ({
      localId: String(nextId.current++),
      name: f.name,
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: 'uploading',
    }));
    setPhotos((curr) => [...curr, ...next]);

    // Kick off upload immediately (optimistic UI).
    for (const p of next) {
      try {
        const { uploads } = await uploadPhotos({ files: [p.file], accessToken });
        const u = uploads[0];
        if (!u) throw new Error('upload rejected');
        setPhotos((curr) =>
          curr.map((x) =>
            x.localId === p.localId
              ? { ...x, status: 'uploaded', staging_path: u.staging_path }
              : x,
          ),
        );
      } catch {
        setPhotos((curr) =>
          curr.map((x) =>
            x.localId === p.localId ? { ...x, status: 'failed' } : x,
          ),
        );
      }
    }
  }

  function onRemovePhoto(localId) {
    setPhotos((curr) => {
      const p = curr.find((x) => x.localId === localId);
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return curr.filter((x) => x.localId !== localId);
    });
  }

  async function submit() {
    const value = text.trim();
    if ((!value && photos.length === 0) || disabled) return;

    const attachments = photos
      .filter((p) => p.status === 'uploaded' && p.staging_path)
      .map((p) => ({ staging_path: p.staging_path }));

    setText('');
    // Free the object URLs for previews we're about to drop.
    for (const p of photos) {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    }
    setPhotos([]);
    requestAnimationFrame(adjustHeight);
    await onSend({ text: value, attachments });
  }

  function onKey(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  const hasUploadingPhoto = photos.some((p) => p.status === 'uploading');

  return (
    <div className="border-t border-matrix-green-line bg-matrix-black">
      <PhotoPreview photos={photos} onRemove={onRemovePhoto} />
      <div className="px-3 py-3">
        <div className="flex items-end gap-2">
          <AttachButton disabled={disabled || photos.length >= 5} onFiles={onFiles} />
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
            disabled={disabled || hasUploadingPhoto || (!text.trim() && photos.length === 0)}
            className="min-h-tap min-w-tap px-4 rounded-md border border-matrix-green text-matrix-green hover:shadow-matrix-glow disabled:opacity-40 disabled:cursor-not-allowed text-sm uppercase tracking-widest transition-base"
            aria-label="Send"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-matrix-fg-muted text-center sm:text-right">
          {hasUploadingPhoto
            ? 'Photo uploading…'
            : '⌘/Ctrl + Enter to send · attach up to 5 photos'}
        </p>
      </div>
    </div>
  );
}
