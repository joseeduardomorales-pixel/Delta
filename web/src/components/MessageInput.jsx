// Mobile-first text input + attach + send.
// Restrained per v2 — no decorative motion. Photos upload optimistically.

import { useRef, useState } from 'react';
import AttachButton from './AttachButton.jsx';
import PhotoPreview from './PhotoPreview.jsx';
import { uploadPhotos } from '../lib/upload.js';
import { Button } from './ui/index.js';
import { cn } from '../lib/cn.js';

export default function MessageInput({ onSend, disabled, accessToken }) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
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
          curr.map((x) => (x.localId === p.localId ? { ...x, status: 'failed' } : x)),
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
    <div className="border-t border-border bg-card">
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
            placeholder="Type or dictate…"
            rows={1}
            disabled={disabled}
            className={cn(
              'flex-1 resize-none rounded-xl bg-card text-foreground',
              'border border-border placeholder:text-muted-foreground/60',
              'px-3 py-3 text-base min-h-tap',
              'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
              'disabled:opacity-50',
            )}
            aria-label="Message"
          />
          <Button
            type="button"
            size="md"
            onClick={submit}
            disabled={disabled || hasUploadingPhoto || (!text.trim() && photos.length === 0)}
            aria-label="Send"
          >
            Send
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/80 text-center sm:text-right">
          {hasUploadingPhoto
            ? 'Photo uploading…'
            : '⌘/Ctrl + Enter to send · attach up to 5 photos'}
        </p>
      </div>
    </div>
  );
}
