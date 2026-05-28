// Report Issue — focused modal for fast issue submission.
// Skips the chat / Claude entirely; posts directly to /api/issues.
//
// Post-redesign: issues live in their own table. They are NOT work orders;
// a tech later opens a WO on the asset and picks the issue from the
// pending list as one of the items.
//
// Props:
//   open, onClose
//   lockedAsset?   if provided, asset_unit_number is fixed (no picker)
//   onSubmitted?   called with the created issue

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { uploadPhotos } from '../lib/upload.js';
import {
  Modal,
  ModalActions,
  Button,
  Input,
  Textarea,
  Banner,
  Badge,
  useToast,
} from './ui/index.js';
import PhotoPreview from './PhotoPreview.jsx';
import AttachButton from './AttachButton.jsx';

export default function ReportIssueModal({
  open,
  onClose,
  lockedAsset,
  onSubmitted,
}) {
  const { session } = useAuth();
  const { push: pushToast } = useToast();

  const [assetUnit, setAssetUnit] = useState(lockedAsset || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]); // { localId, file, previewUrl, status, staging_path? }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const nextId = useRef(1);

  useEffect(() => {
    if (open) {
      setAssetUnit(lockedAsset || '');
      setTitle('');
      setDescription('');
      setPhotos([]);
      setErr(null);
    } else {
      // clean up object URLs
      for (const p of photos) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        const { uploads } = await uploadPhotos({
          files: [p.file],
          accessToken: session.access_token,
        });
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

  function removePhoto(localId) {
    setPhotos((curr) => {
      const p = curr.find((x) => x.localId === localId);
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return curr.filter((x) => x.localId !== localId);
    });
  }

  async function submit() {
    setErr(null);
    if (!assetUnit.trim()) return setErr('asset_required');
    if (!title.trim()) return setErr('title_required');
    const stagingPhotos = photos.filter((p) => p.status === 'uploaded' && p.staging_path);
    if (photos.some((p) => p.status === 'uploading')) {
      return setErr('wait_for_photos');
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          asset_unit_number: assetUnit.trim().toUpperCase(),
          title: title.trim(),
          description: description.trim() || null,
          raw_input: description.trim() || title.trim(),
          attachments: stagingPhotos.map((p) => ({ staging_path: p.staging_path })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      pushToast({
        tone: 'success',
        title: 'Issue logged',
        text: `${data.issue.label || `ISS-${data.issue.short_id}`} on ${data.issue.asset_unit_number}`,
      });
      onSubmitted?.(data.issue);
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const hasUploading = photos.some((p) => p.status === 'uploading');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report an issue"
      description="Fast path — no chat, no AI. Goes into the pending list for the next tech who opens a WO on this asset."
      maxWidth="lg"
      footer={
        <ModalActions onCancel={onClose}>
          <Button
            onClick={submit}
            loading={busy}
            disabled={busy || hasUploading || !assetUnit.trim() || !title.trim()}
          >
            <AlertCircle size={16} /> Log issue
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        {lockedAsset ? (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Asset</div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <Badge tone="accent">{lockedAsset}</Badge>
              <span className="text-xs text-muted-foreground">locked from this page</span>
            </div>
          </div>
        ) : (
          <Input
            label="Asset"
            placeholder="CC07 · T05 · BF1701"
            value={assetUnit}
            onChange={(e) => setAssetUnit(e.target.value.toUpperCase())}
            helper="Unit number — what's on the truck or trailer."
            autoFocus
          />
        )}

        <Input
          label="What's the problem?"
          placeholder="e.g. Reefer not cooling"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={Boolean(lockedAsset)}
        />

        <Textarea
          label="Details"
          optional
          placeholder="Anything that'd help whoever picks this up — when you noticed, what you tried, etc."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            Photos <span className="text-muted-foreground/70">(optional, up to 5)</span>
          </div>
          <div className="flex items-center gap-2">
            <AttachButton
              disabled={busy || photos.length >= 5}
              onFiles={onFiles}
            />
            <span className="text-xs text-muted-foreground">
              {photos.length > 0
                ? `${photos.length} attached`
                : 'Tap to take a photo or pick from library'}
            </span>
          </div>
          {photos.length > 0 && (
            <div className="mt-2">
              <PhotoPreview photos={photos} onRemove={removePhoto} />
            </div>
          )}
        </div>

        {err && (
          <Banner tone="danger" title="Can't submit">
            {err === 'asset_required'
              ? 'Pick an asset.'
              : err === 'title_required'
                ? 'Add a short title (e.g. "Reefer not cooling").'
                : err === 'wait_for_photos'
                  ? 'Wait for photo upload to finish.'
                  : err}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
