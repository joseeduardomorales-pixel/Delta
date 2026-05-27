// Thumbnail strip shown above the input. Each photo shows upload
// progress (uploading | uploaded | failed) and an X to remove it
// before send.

import { X } from 'lucide-react';
import clsx from 'clsx';

function StatusDot({ status }) {
  if (status === 'uploaded')
    return <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-matrix-green" />;
  if (status === 'uploading')
    return (
      <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-matrix-amber animate-pulse" />
    );
  if (status === 'failed')
    return <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-matrix-red" />;
  return null;
}

export default function PhotoPreview({ photos, onRemove }) {
  if (!photos.length) return null;
  return (
    <div className="flex gap-2 px-3 pt-2 overflow-x-auto">
      {photos.map((p) => (
        <div
          key={p.localId}
          className={clsx(
            'relative shrink-0 w-16 h-16 rounded-md overflow-hidden border',
            p.status === 'failed' ? 'border-matrix-red' : 'border-matrix-green-line',
          )}
        >
          <img
            src={p.previewUrl}
            alt={p.name}
            className="w-full h-full object-cover"
          />
          <StatusDot status={p.status} />
          <button
            type="button"
            onClick={() => onRemove(p.localId)}
            aria-label="Remove photo"
            className="absolute top-0.5 right-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full bg-black/70 text-matrix-fg hover:text-matrix-red"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
