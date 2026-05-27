// Thumbnail strip shown above the input. Each photo shows upload
// progress (uploading | uploaded | failed) and an X to remove it
// before send.

import { X } from 'lucide-react';
import { cn } from '../lib/cn.js';

function StatusDot({ status }) {
  const map = {
    uploaded: 'bg-success',
    uploading: 'bg-warning animate-pulse-dot',
    failed: 'bg-danger',
  };
  if (!map[status]) return null;
  return <span className={cn('absolute bottom-1 right-1 h-2 w-2 rounded-full', map[status])} />;
}

export default function PhotoPreview({ photos, onRemove }) {
  if (!photos.length) return null;
  return (
    <div className="flex gap-2 px-3 pt-2 overflow-x-auto">
      {photos.map((p) => (
        <div
          key={p.localId}
          className={cn(
            'relative shrink-0 h-16 w-16 rounded-lg overflow-hidden border bg-card',
            p.status === 'failed' ? 'border-danger' : 'border-border',
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
            className="absolute top-0.5 right-0.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-foreground/70 text-background hover:bg-danger transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
