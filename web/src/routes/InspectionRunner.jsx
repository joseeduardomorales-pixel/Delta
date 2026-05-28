// /work-orders/:woId/inspect/:inspectionId — paginated, offline-first runner.
//
// Three pages match the physical walk of a reefer trailer inspection:
//   1. Reefer Unit  — sections "OUTSIDE…", "INSIDE…", "PM INFORMATION…"
//                      + a Last PM Date/Hours form at the top of section 3.
//   2. Trailer       — sections "AIR…" through "SAFETY…".
//   3. Final         — the 3 yes/no questions + Sign & submit.
//
// IndexedDB is the source of truth; every tap writes to the local store and
// the UI renders from there. A sync engine drains queued actions in the
// background — see web/src/lib/syncEngine.js.

import { useEffect, useState, useMemo, useRef, memo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Check,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ImageOff,
  Camera,
  WifiOff,
  RotateCw,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL, supabase } from '../lib/supabase.js';
import {
  Header,
  Card,
  Badge,
  Banner,
  Button,
  Textarea,
  Input,
  Modal,
  useToast,
} from '../components/ui/index.js';
import { cn } from '../lib/cn.js';
import { woLabel, inspectionLabel } from '../lib/numbers.js';
import { useInspectionData } from '../lib/useInspectionData.js';
import { useSyncEngine } from '../lib/useSyncEngine.js';
import {
  enqueueAction,
  addPhoto,
  deletePhoto,
  getPhotosForItem,
} from '../lib/inspectionStore.js';

const easeOut = [0.16, 1, 0.3, 1];
const MAX_PHOTOS = 4;

// Page partitioning by section_sequence on the seeded reefer template.
//   Page 1: sections 1, 2, 3   (Reefer Unit)
//   Page 2: sections 4-9       (Trailer)
//   Page 3: section 10         (Final Assessment)
const PAGES = [
  { id: 'reefer', label: 'Reefer unit', sectionSeqs: [1, 2, 3] },
  { id: 'trailer', label: 'Trailer', sectionSeqs: [4, 5, 6, 7, 8, 9] },
  { id: 'final', label: 'Final', sectionSeqs: [10] },
];

function partitionSections(sections) {
  const buckets = PAGES.map(() => []);
  for (const sec of sections || []) {
    const seq = sec.items?.[0]?.template_item?.section_sequence;
    const pageIdx = PAGES.findIndex((p) => p.sectionSeqs.includes(seq));
    if (pageIdx >= 0) buckets[pageIdx].push(sec);
  }
  // Sort each bucket by section_sequence to keep deterministic order.
  for (const b of buckets) {
    b.sort(
      (a, b2) =>
        (a.items?.[0]?.template_item?.section_sequence || 0) -
        (b2.items?.[0]?.template_item?.section_sequence || 0),
    );
  }
  return buckets;
}

async function resolveAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
}

// ── Issue (fail) modal ──────────────────────────────────────────────────────
function IssueModal({ open, item, inspectionId, onClose, onConfirm, busy }) {
  const tpl = item?.template_item || {};
  const isMeasurement = tpl.kind === 'measurement';
  const isYesNo = tpl.kind === 'yes_no';

  const [notes, setNotes] = useState('');
  const [measurement, setMeasurement] = useState('');
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [localPhotos, setLocalPhotos] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [submitErr, setSubmitErr] = useState(null);
  const nextId = useRef(1);

  useEffect(() => {
    let alive = true;
    if (open && item) {
      setNotes(item.notes || '');
      setMeasurement(item.measurement_value ?? '');
      const server = (item.photos || []).filter((p) => !p.local);
      setExistingPhotos(server.map((p) => ({ ...p, pending_remove: false })));
      getPhotosForItem(inspectionId, item.id).then((photos) => {
        if (!alive) return;
        setLocalPhotos(
          photos.map((p) => ({
            id: p.id,
            blob: p.blob,
            url: URL.createObjectURL(p.blob),
            status: p.status,
            pending_remove: false,
          })),
        );
      });
      setNewFiles([]);
      setSubmitErr(null);
    } else if (!open) {
      for (const p of newFiles) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, inspectionId]);

  const visibleExisting = existingPhotos.filter((p) => !p.pending_remove);
  const visibleLocal = localPhotos.filter((p) => !p.pending_remove);
  const totalCount = visibleExisting.length + visibleLocal.length + newFiles.length;

  function onFiles(files) {
    const remaining = MAX_PHOTOS - totalCount;
    if (remaining <= 0) return;
    const next = Array.from(files)
      .slice(0, remaining)
      .map((f) => ({
        localId: String(nextId.current++),
        file: f,
        previewUrl: URL.createObjectURL(f),
      }));
    setNewFiles((curr) => [...curr, ...next]);
  }
  function removeNewFile(localId) {
    setNewFiles((curr) => {
      const p = curr.find((x) => x.localId === localId);
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return curr.filter((x) => x.localId !== localId);
    });
  }
  function markExistingForRemoval(id) {
    setExistingPhotos((curr) =>
      curr.map((p) => (p.id === id ? { ...p, pending_remove: true } : p)),
    );
  }
  function undoExistingRemoval(id) {
    setExistingPhotos((curr) =>
      curr.map((p) => (p.id === id ? { ...p, pending_remove: false } : p)),
    );
  }
  function markLocalForRemoval(id) {
    setLocalPhotos((curr) =>
      curr.map((p) => (p.id === id ? { ...p, pending_remove: true } : p)),
    );
  }
  function undoLocalRemoval(id) {
    setLocalPhotos((curr) =>
      curr.map((p) => (p.id === id ? { ...p, pending_remove: false } : p)),
    );
  }

  const descOk = notes.trim().length >= 3;
  const photosOk = visibleExisting.length + visibleLocal.length + newFiles.length >= 1;
  const canSubmit = descOk && photosOk && !busy;

  async function submit() {
    setSubmitErr(null);
    if (!canSubmit) return;
    const result = isYesNo ? 'no' : 'fail';
    const payload = {
      inspection_result: result,
      notes: notes.trim(),
      remove_photo_ids: existingPhotos
        .filter((p) => p.pending_remove)
        .map((p) => p.id),
    };
    if (isMeasurement && measurement !== '') {
      const n = Number(measurement);
      if (Number.isFinite(n)) payload.measurement_value = n;
    }
    try {
      const toDelete = localPhotos.filter((p) => p.pending_remove);
      for (const p of toDelete) await deletePhoto(p.id);
      await onConfirm(item.id, {
        payload,
        newFileBlobs: newFiles.map((f) => f.file),
        keepLocalPhotoIds: localPhotos
          .filter((p) => !p.pending_remove)
          .map((p) => p.id),
      });
    } catch (e) {
      setSubmitErr(e.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      destructive
      maxWidth="lg"
      title="Report an issue"
      description="An open issue will be created on this asset and the next tech will see it. A description and at least one photo are required."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!canSubmit}>
            <X size={16} /> Record issue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Item</p>
          <p className="mt-0.5 text-sm font-medium text-foreground leading-snug">
            {item?.title}
          </p>
        </div>
        {isMeasurement && (
          <Input
            label={`Measured value${tpl.measurement_unit ? ` (${tpl.measurement_unit})` : ''}`}
            type="number"
            value={measurement}
            onChange={(e) => setMeasurement(e.target.value)}
          />
        )}
        <Textarea
          label="What's wrong?"
          required
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Crack on right corner of display, intermittent flicker, missing bolt on left bracket"
          autoFocus
          helper={
            notes.trim().length < 3
              ? 'Add a short description — at least 3 characters.'
              : null
          }
        />
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs font-medium text-muted-foreground">
              Photos <span className="text-danger">(required, at least 1)</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {totalCount}/{MAX_PHOTOS}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {existingPhotos.map((p) => (
              <PhotoTile
                key={`e-${p.id}`}
                src={p.url}
                pendingRemove={p.pending_remove}
                onRemove={() => markExistingForRemoval(p.id)}
                onUndoRemove={() => undoExistingRemoval(p.id)}
                tone="success"
              />
            ))}
            {localPhotos.map((p) => (
              <PhotoTile
                key={`l-${p.id}`}
                src={p.url}
                pendingRemove={p.pending_remove}
                onRemove={() => markLocalForRemoval(p.id)}
                onUndoRemove={() => undoLocalRemoval(p.id)}
                tone={p.status === 'failed' ? 'danger' : 'warning'}
                badge={
                  p.status === 'queued'
                    ? 'queued'
                    : p.status === 'uploading'
                      ? 'uploading'
                      : p.status === 'failed'
                        ? 'failed'
                        : null
                }
              />
            ))}
            {newFiles.map((p) => (
              <PhotoTile
                key={`n-${p.localId}`}
                src={p.previewUrl}
                onRemove={() => removeNewFile(p.localId)}
                tone="accent"
              />
            ))}
            {totalCount < MAX_PHOTOS && (
              <label
                className={cn(
                  'aspect-square rounded-lg border-2 border-dashed border-border',
                  'flex flex-col items-center justify-center gap-1',
                  'text-muted-foreground hover:border-accent/50 hover:text-accent',
                  'cursor-pointer transition-colors',
                )}
              >
                <Camera size={20} />
                <span className="text-[10px] uppercase tracking-wider">Add photo</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (files.length) onFiles(files);
                  }}
                />
              </label>
            )}
          </div>
          {!photosOk && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Take a photo with the camera or pick one from the library.
            </p>
          )}
        </div>
        {submitErr && (
          <Banner tone="danger" title="Couldn't save issue">
            {submitErr}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

function PhotoTile({ src, onRemove, onUndoRemove, pendingRemove, tone, badge }) {
  const toneBorder = {
    success: 'border-success/50',
    warning: 'border-warning/50',
    danger: 'border-danger/60',
    accent: 'border-accent/50',
  }[tone || 'accent'];
  return (
    <div
      className={cn(
        'relative aspect-square rounded-lg overflow-hidden border',
        toneBorder,
        pendingRemove && 'opacity-40',
      )}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground">
          <ImageOff size={20} />
        </div>
      )}
      {badge && (
        <span className="absolute bottom-1 left-1 rounded bg-foreground/70 text-background text-[9px] uppercase tracking-wider px-1.5 py-0.5">
          {badge}
        </span>
      )}
      {pendingRemove ? (
        <button
          type="button"
          onClick={onUndoRemove}
          className="absolute inset-0 flex items-center justify-center bg-danger/70 text-white text-[10px] uppercase tracking-wider hover:bg-danger/85"
        >
          will be removed · tap to undo
        </button>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background hover:bg-foreground"
          aria-label="Remove photo"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ── One row per inspection item (memoized so unchanged items skip render) ───
const ItemRow = memo(
  function ItemRow({ item, onMark, onOpenIssue, busy }) {
    const tpl = item.template_item || {};
    const isYesNo = tpl.kind === 'yes_no';
    const result = item.inspection_result;

    const failed =
      result === 'fail' ||
      result === 'no' ||
      (isYesNo && tpl.good_answer && result && result !== tpl.good_answer);
    const passed =
      result === 'pass' ||
      (isYesNo && tpl.good_answer && result === tpl.good_answer);

    return (
      <div
        className={cn(
          'rounded-lg border px-4 py-3.5 transition-colors',
          passed && 'border-success/40 bg-success-bg/30',
          failed && 'border-danger/40 bg-danger-bg/30',
          !result && 'border-border bg-card',
        )}
      >
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] sm:text-base text-foreground leading-snug">
              {item.title}
            </p>
            {tpl.measurement_unit && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Measurement: {tpl.measurement_unit}
                {tpl.measurement_min != null && ` · min ${tpl.measurement_min}`}
                {tpl.measurement_max != null && ` · max ${tpl.measurement_max}`}
              </p>
            )}
            {item.notes && (
              <p className="mt-1.5 text-xs text-muted-foreground italic">"{item.notes}"</p>
            )}
            {item.measurement_value != null && (
              <p className="mt-1 text-xs text-foreground">
                Value: {item.measurement_value}
                {tpl.measurement_unit ? ` ${tpl.measurement_unit}` : ''}
              </p>
            )}
            {item._pending_sync === 'needs_attention' && (
              <p className="mt-1 text-xs text-danger flex items-center gap-1">
                <AlertTriangle size={11} /> Needs attention — re-tap to retry.
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isYesNo ? (
              <>
                <BigButton
                  tone="success"
                  active={result === 'yes'}
                  onClick={() => onMark(item.id, { inspection_result: 'yes' })}
                  disabled={busy}
                  aria-label="Yes"
                >
                  <Check size={18} strokeWidth={3} />
                  <span className="ml-1 text-[11px] font-bold">YES</span>
                </BigButton>
                <BigButton
                  tone="danger"
                  active={result === 'no'}
                  onClick={() => onOpenIssue(item)}
                  disabled={busy}
                  aria-label="No — report issue"
                >
                  <X size={18} strokeWidth={3} />
                  <span className="ml-1 text-[11px] font-bold">NO</span>
                </BigButton>
              </>
            ) : (
              <>
                <BigButton
                  tone="success"
                  active={passed}
                  onClick={() => onMark(item.id, { inspection_result: 'pass' })}
                  disabled={busy}
                  aria-label="OK"
                  title="OK"
                >
                  <Check size={18} strokeWidth={3} />
                  <span className="ml-1 text-[11px] font-bold">OK</span>
                </BigButton>
                <BigButton
                  tone="danger"
                  active={failed}
                  onClick={() => onOpenIssue(item)}
                  disabled={busy}
                  aria-label="Issue"
                  title="Issue"
                >
                  <X size={18} strokeWidth={3} />
                  <span className="ml-1 text-[11px] font-bold">ISSUE</span>
                </BigButton>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Shallow compare the bits that affect rendering.
    const a = prev.item, b = next.item;
    if (prev.busy !== next.busy) return false;
    if (a === b) return true;
    return (
      a.id === b.id &&
      a.inspection_result === b.inspection_result &&
      a.notes === b.notes &&
      a.measurement_value === b.measurement_value &&
      a._pending_sync === b._pending_sync
    );
  },
);

function BigButton({ tone, active, children, ...props }) {
  const toneClasses = {
    success: active
      ? 'bg-success text-white border-success shadow-sm'
      : 'border-border text-success hover:bg-success-bg hover:border-success/40',
    danger: active
      ? 'bg-danger text-white border-danger shadow-sm'
      : 'border-border text-danger hover:bg-danger-bg hover:border-danger/40',
  };
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center',
        'min-w-[3.25rem] sm:min-w-[3.75rem] h-11 sm:h-12 px-2 sm:px-2.5',
        'rounded-lg border-2',
        'transition-all duration-base ease-out-soft',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'active:scale-[0.96]',
        toneClasses[tone],
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ── PM info form — top of section 3 on page 1 ──────────────────────────────
function PmInfoForm({ inspectionId, initialDate, initialHours }) {
  const [date, setDate] = useState(initialDate || '');
  const [hours, setHours] = useState(initialHours ?? '');
  // Debounce — don't queue an action on every keystroke.
  useEffect(() => {
    setDate(initialDate || '');
    setHours(initialHours ?? '');
  }, [initialDate, initialHours]);

  const tRef = useRef(null);
  function schedule(newDate, newHours) {
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => {
      enqueueAction({
        kind: 'update_pm_info',
        inspection_id: inspectionId,
        payload: {
          last_pm_date: newDate || null,
          last_pm_hours: newHours === '' ? null : Number(newHours),
        },
      });
    }, 500);
  }

  return (
    <div className="mb-4 rounded-lg border border-accent/30 bg-accent-bg/40 p-4">
      <p className="text-[10px] uppercase tracking-widest text-accent font-semibold mb-3">
        PM information (last service)
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Input
          label="Last PM date"
          type="date"
          value={date}
          onChange={(e) => {
            const v = e.target.value;
            setDate(v);
            schedule(v, hours);
          }}
        />
        <Input
          label="Last PM hours"
          type="number"
          inputMode="numeric"
          value={hours}
          onChange={(e) => {
            const v = e.target.value;
            setHours(v);
            schedule(date, v);
          }}
          placeholder="e.g. 17,200"
        />
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function InspectionRunner() {
  const { woId, inspectionId } = useParams();
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const navigate = useNavigate();
  const [issueFor, setIssueFor] = useState(null);
  const [issueBusy, setIssueBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  const { data, loading, error } = useInspectionData({
    inspectionId,
    accessToken: session.access_token,
    apiUrl: API_URL,
  });
  const { counts, online } = useSyncEngine({
    inspectionId,
    apiUrl: API_URL,
    getAccessToken: resolveAccessToken,
  });

  async function mark(itemId, payload) {
    await enqueueAction({
      kind: 'mark_item',
      inspection_id: inspectionId,
      item_id: itemId,
      payload,
    });
  }

  async function submitIssue(itemId, { payload, newFileBlobs, keepLocalPhotoIds }) {
    setIssueBusy(true);
    try {
      const newPhotoIds = [];
      for (const blob of newFileBlobs) {
        const p = await addPhoto({
          inspection_id: inspectionId,
          item_id: itemId,
          blob,
          mime: blob.type,
        });
        newPhotoIds.push(p.id);
      }
      await enqueueAction({
        kind: 'mark_item',
        inspection_id: inspectionId,
        item_id: itemId,
        payload,
        photo_ids: [...keepLocalPhotoIds, ...newPhotoIds],
      });
      setIssueFor(null);
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Couldn’t save', text: e.message });
      throw e;
    } finally {
      setIssueBusy(false);
    }
  }

  // Partition into 3 pages. Computed once per data change.
  const pages = useMemo(
    () => partitionSections(data?.sections || []),
    [data?.sections],
  );

  // Overall progress (across all pages).
  const overall = useMemo(() => {
    if (!data) return { total: 0, done: 0, pass: 0, fail: 0 };
    let total = 0, done = 0, pass = 0, fail = 0;
    for (const s of data.sections || []) {
      for (const i of s.items) {
        total += 1;
        if (i.inspection_result) done += 1;
        const tpl = i.template_item || {};
        if (tpl.kind === 'yes_no') {
          if (tpl.good_answer && i.inspection_result && i.inspection_result !== tpl.good_answer) fail += 1;
          else if (tpl.good_answer && i.inspection_result === tpl.good_answer) pass += 1;
        } else {
          if (i.inspection_result === 'pass') pass += 1;
          if (i.inspection_result === 'fail') fail += 1;
        }
      }
    }
    return { total, done, pass, fail };
  }, [data]);

  // Per-page counters for the tab pills.
  const pageDone = useMemo(() => {
    return pages.map((sections) => {
      let total = 0, done = 0, fail = 0;
      for (const s of sections) {
        for (const i of s.items) {
          total += 1;
          if (i.inspection_result) done += 1;
          const tpl = i.template_item || {};
          if (tpl.kind === 'yes_no') {
            if (tpl.good_answer && i.inspection_result && i.inspection_result !== tpl.good_answer) fail += 1;
          } else if (i.inspection_result === 'fail') {
            fail += 1;
          }
        }
      }
      return { total, done, fail };
    });
  }, [pages]);

  const pct = overall.total ? Math.round((overall.done / overall.total) * 100) : 0;
  const allDone = overall.total > 0 && overall.done === overall.total;
  const isCompleted = data?.inspection?.completed_at;
  const hasIssuesNeedingAttention = counts.needs_attention > 0;

  async function finalize() {
    setFinalizing(true);
    try {
      await enqueueAction({
        kind: 'finalize',
        inspection_id: inspectionId,
        payload: {},
      });
      pushToast({
        tone: 'success',
        title: 'Inspection complete',
        text: `${overall.pass} OK · ${overall.fail} issues — syncing to admin.`,
      });
      const unit = data?.inspection?.work_order?.asset_unit_number;
      navigate(unit ? `/assets/${encodeURIComponent(unit)}` : '/');
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Could not finalize', text: e.message });
    } finally {
      setFinalizing(false);
    }
  }

  const currentPage = pages[pageIdx] || [];
  const currentPageMeta = PAGES[pageIdx];
  const showPmForm = currentPageMeta?.id === 'reefer';

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={
          data?.inspection?.work_order
            ? `Inspecting ${data.inspection.work_order.asset_unit_number}`
            : 'Inspection'
        }
        sticky
      />
      <main className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="mb-6"
        >
          <Link
            to={
              data?.inspection?.work_order?.asset_unit_number
                ? `/assets/${encodeURIComponent(data.inspection.work_order.asset_unit_number)}`
                : '/work-orders'
            }
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={14} />
            <span className="uppercase tracking-widest">
              Back to {data?.inspection?.work_order?.asset_unit_number || 'work orders'}
            </span>
          </Link>
          <h1 className="mt-2 font-display text-3xl md:text-4xl tracking-tight leading-tight">
            {data?.inspection?.template?.name || 'Inspection'}
          </h1>
          {data?.inspection?.work_order && (
            <p className="mt-2 text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-foreground">
                {data.inspection.work_order.asset_unit_number}
              </span>
              <span>·</span>
              <span className="font-mono">
                {woLabel(data.inspection.work_order, {
                  handle: data.inspection.work_order.user?.handle,
                })}
              </span>
              <span>·</span>
              <span className="font-mono">{inspectionLabel(data.inspection)}</span>
            </p>
          )}
        </motion.div>

        {loading && !data && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        )}
        {error && !data && (
          <Banner tone="danger" title="Couldn't load inspection">
            {error}
          </Banner>
        )}

        {data && (
          <>
            {/* Offline / needs_attention banner */}
            {(!online || hasIssuesNeedingAttention) && (
              <div
                className={cn(
                  'sticky top-14 md:top-16 -mx-4 md:mx-0 px-4 md:px-5 py-2.5 mb-2 z-40',
                  'flex items-center justify-between gap-3 flex-wrap',
                  !online
                    ? 'bg-warning-bg text-warning border-y border-warning/30'
                    : 'bg-danger-bg text-danger border-y border-danger/30',
                  'md:rounded-xl md:border',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {!online ? (
                    <>
                      <WifiOff size={16} />
                      Offline — {counts.pending_total} change
                      {counts.pending_total === 1 ? '' : 's'} queued.
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={16} />
                      {counts.needs_attention} item
                      {counts.needs_attention === 1 ? '' : 's'} need attention.
                    </>
                  )}
                </div>
                {online && counts.needs_attention === 0 && counts.pending_total > 0 && (
                  <span className="text-xs flex items-center gap-1">
                    <RotateCw size={12} className="animate-spin" />
                    {counts.pending_total} syncing
                  </span>
                )}
              </div>
            )}

            {/* Progress bar — overall across all pages */}
            <div className="sticky top-14 md:top-16 -mx-4 md:mx-0 px-4 md:px-5 py-3 mb-4 z-30 bg-background/95 backdrop-blur border-b border-border md:border md:rounded-xl md:bg-card md:shadow-sm">
              <div className="flex items-center justify-between text-xs mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-foreground">
                    <span className="font-semibold">{overall.done}</span>/{overall.total} done
                  </span>
                  <span className="text-success">{overall.pass} OK</span>
                  <span className="text-danger">{overall.fail} issues</span>
                </div>
                <span className="text-muted-foreground font-mono">{pct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    overall.fail > 0 ? 'bg-warning' : 'bg-success',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Page tabs */}
            <div className="mb-5 flex items-center gap-1 border-b border-border overflow-x-auto">
              {PAGES.map((p, idx) => {
                const counts = pageDone[idx] || { total: 0, done: 0, fail: 0 };
                return (
                  <button
                    key={p.id}
                    onClick={() => setPageIdx(idx)}
                    className={cn(
                      'relative px-4 py-2 text-sm transition-colors whitespace-nowrap',
                      pageIdx === idx
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                      {idx + 1}
                    </span>
                    {p.label}
                    <span className="ml-2 text-[11px] text-muted-foreground/70 font-mono">
                      {counts.done}/{counts.total}
                      {counts.fail > 0 && (
                        <span className="ml-1 text-danger">· {counts.fail}!</span>
                      )}
                    </span>
                    {pageIdx === idx && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Current page sections */}
            <div className="space-y-10">
              {currentPage.map((sec, idx) => {
                const sectionDone = sec.items.filter((i) => i.inspection_result).length;
                const sectionFail = sec.items.filter(
                  (i) =>
                    i.inspection_result === 'fail' ||
                    (i.template_item?.kind === 'yes_no' &&
                      i.template_item?.good_answer &&
                      i.inspection_result &&
                      i.inspection_result !== i.template_item.good_answer),
                ).length;
                // Show the PM info form right above section "PM INFORMATION…".
                const sectionSeq = sec.items?.[0]?.template_item?.section_sequence;
                const isPmSection = sectionSeq === 3;
                return (
                  <section key={sec.section}>
                    <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border pb-2">
                      <h2 className="font-display text-xl md:text-2xl tracking-tight">
                        {sec.section}
                      </h2>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {sectionDone}/{sec.items.length}
                        {sectionFail > 0 && (
                          <span className="ml-2 text-danger font-medium">
                            {sectionFail} issue{sectionFail === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    </div>
                    {isPmSection && showPmForm && (
                      <PmInfoForm
                        inspectionId={inspectionId}
                        initialDate={data.inspection.last_pm_date || ''}
                        initialHours={data.inspection.last_pm_hours ?? ''}
                      />
                    )}
                    <div className="space-y-2.5">
                      {sec.items.map((it) => (
                        <ItemRow
                          key={it.id}
                          item={it}
                          onMark={mark}
                          onOpenIssue={(item) => setIssueFor(item)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* Page nav — Previous / Next at bottom, plus Sign & submit on final */}
            <div className="mt-8 mb-12 flex items-center justify-between gap-3 flex-wrap">
              <Button
                variant="ghost"
                onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                disabled={pageIdx === 0}
              >
                <ChevronLeft size={16} /> Previous
              </Button>
              {pageIdx < PAGES.length - 1 ? (
                <Button onClick={() => setPageIdx((i) => Math.min(PAGES.length - 1, i + 1))}>
                  Next <ChevronRight size={16} />
                </Button>
              ) : isCompleted ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-success" />
                  Completed {new Date(data.inspection.completed_at).toLocaleString()}
                </div>
              ) : (
                <Button
                  onClick={finalize}
                  loading={finalizing}
                  disabled={!allDone || finalizing}
                >
                  <ClipboardCheck size={16} />
                  Sign & submit inspection
                </Button>
              )}
            </div>

            {/* Sign & submit context — only shows on the final page when not yet done */}
            {pageIdx === PAGES.length - 1 && !isCompleted && (
              <Card className="p-5 mb-12">
                <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                  <h2 className="font-display text-xl">Sign & submit</h2>
                  {overall.fail > 0 && (
                    <Badge tone="warning">
                      {overall.fail} issue{overall.fail === 1 ? '' : 's'} logged on this asset
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Submitting signs the inspection with a timestamp. Items sync to
                  admin in the background — works offline too.
                </p>
                {!allDone && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-warning">
                    <AlertTriangle size={14} />
                    {overall.total - overall.done} item
                    {overall.total - overall.done === 1 ? '' : 's'} still pending across all pages.
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </main>

      <IssueModal
        open={Boolean(issueFor)}
        item={issueFor}
        inspectionId={inspectionId}
        onClose={() => setIssueFor(null)}
        onConfirm={submitIssue}
        busy={issueBusy}
      />
    </div>
  );
}
