// /work-orders/:woId/inspect/:inspectionId — checklist walker.
//
// Tech walks the asset and marks each item OK / Issue / N/A.
//   OK     → result='pass' (or 'yes' for yes/no items where the good answer is yes)
//   Issue  → opens a modal that REQUIRES a description AND at least one photo
//             (max 4). On submit, the server records the fail, auto-creates
//             an open issue on the asset, and attaches the photos to the WO.
//   N/A    → result='na'; only available on pass/fail items.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Check,
  X,
  Minus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ImageOff,
  Camera,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { uploadPhotos } from '../lib/upload.js';
import {
  Header,
  Card,
  Badge,
  SectionLabel,
  Banner,
  Button,
  Textarea,
  Input,
  Modal,
  useToast,
} from '../components/ui/index.js';
import { cn } from '../lib/cn.js';
import { woLabel, inspectionLabel } from '../lib/numbers.js';

const easeOut = [0.16, 1, 0.3, 1];
const MAX_PHOTOS = 4;

// ── Issue (fail) modal ──────────────────────────────────────────────────────
// Description AND at least one photo (max 4) are both REQUIRED before submit.
// When re-opened on an already-failed item, pre-fills with existing notes +
// shows existing photos with a remove button. Server applies the diff.
function IssueModal({ open, item, onClose, onConfirm, busy, accessToken }) {
  const tpl = item?.template_item || {};
  const isMeasurement = tpl.kind === 'measurement';
  const isYesNo = tpl.kind === 'yes_no';

  const [notes, setNotes] = useState('');
  const [measurement, setMeasurement] = useState('');
  // Existing photos (server-side, with `id` + `url`). Marked
  // `pending_remove: true` when the user clicks X — submit sends those ids
  // in remove_photo_ids and removes them locally after success.
  const [existingPhotos, setExistingPhotos] = useState([]);
  // New photos staged in this modal session.
  const [newPhotos, setNewPhotos] = useState([]);
  const [submitErr, setSubmitErr] = useState(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (open && item) {
      setNotes(item.notes || '');
      setMeasurement(item.measurement_value ?? '');
      setExistingPhotos((item.photos || []).map((p) => ({ ...p, pending_remove: false })));
      setNewPhotos([]);
      setSubmitErr(null);
    } else if (!open) {
      // Cleanup any leftover object URLs.
      for (const p of newPhotos) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const visibleExisting = existingPhotos.filter((p) => !p.pending_remove);
  const totalCount = visibleExisting.length + newPhotos.filter((p) => p.status !== 'failed').length;

  async function onFiles(files) {
    const remaining = MAX_PHOTOS - totalCount;
    if (remaining <= 0) return;
    const next = Array.from(files)
      .slice(0, remaining)
      .map((f) => ({
        localId: String(nextId.current++),
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: 'uploading',
      }));
    setNewPhotos((curr) => [...curr, ...next]);
    for (const p of next) {
      try {
        const { uploads } = await uploadPhotos({ files: [p.file], accessToken });
        const u = uploads[0];
        if (!u) throw new Error('upload rejected');
        setNewPhotos((curr) =>
          curr.map((x) =>
            x.localId === p.localId
              ? { ...x, status: 'uploaded', staging_path: u.staging_path }
              : x,
          ),
        );
      } catch {
        setNewPhotos((curr) =>
          curr.map((x) =>
            x.localId === p.localId ? { ...x, status: 'failed' } : x,
          ),
        );
      }
    }
  }

  function removeNewPhoto(localId) {
    setNewPhotos((curr) => {
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

  function undoRemoval(id) {
    setExistingPhotos((curr) =>
      curr.map((p) => (p.id === id ? { ...p, pending_remove: false } : p)),
    );
  }

  const uploadedNewCount = newPhotos.filter((p) => p.status === 'uploaded').length;
  const anyUploading = newPhotos.some((p) => p.status === 'uploading');
  const descOk = notes.trim().length >= 3;
  const photosOk = visibleExisting.length + uploadedNewCount >= 1;
  const canSubmit = descOk && photosOk && !anyUploading && !busy;

  async function submit() {
    setSubmitErr(null);
    if (!canSubmit) return;
    const result = isYesNo ? 'no' : 'fail';
    const payload = {
      inspection_result: result,
      notes: notes.trim(),
      attachments: newPhotos
        .filter((p) => p.status === 'uploaded' && p.staging_path)
        .map((p) => ({ staging_path: p.staging_path })),
      remove_photo_ids: existingPhotos
        .filter((p) => p.pending_remove)
        .map((p) => p.id),
    };
    if (isMeasurement && measurement !== '') {
      const n = Number(measurement);
      if (Number.isFinite(n)) payload.measurement_value = n;
    }
    try {
      await onConfirm(item.id, payload);
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
        {/* The item being failed — read-only context */}
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Item
          </p>
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

        {/* Photo grid: existing + new + add slot, capped at 4 visible */}
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
            {/* Existing photos already saved on the item */}
            {existingPhotos.map((p) => (
              <div
                key={`e-${p.id}`}
                className={cn(
                  'relative aspect-square rounded-lg overflow-hidden border',
                  p.pending_remove ? 'border-danger/60 opacity-50' : 'border-success/50',
                )}
              >
                {p.url ? (
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground">
                    <ImageOff size={20} />
                  </div>
                )}
                {p.pending_remove ? (
                  <button
                    type="button"
                    onClick={() => undoRemoval(p.id)}
                    className="absolute inset-0 flex items-center justify-center bg-danger/70 text-white text-[10px] uppercase tracking-wider hover:bg-danger/85"
                  >
                    will be removed · tap to undo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => markExistingForRemoval(p.id)}
                    className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background hover:bg-foreground"
                    aria-label="Remove photo"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {/* New photos staged in this modal session */}
            {newPhotos.map((p) => (
              <div
                key={`n-${p.localId}`}
                className={cn(
                  'relative aspect-square rounded-lg overflow-hidden border',
                  p.status === 'uploaded' && 'border-success/50',
                  p.status === 'uploading' && 'border-border',
                  p.status === 'failed' && 'border-danger/60',
                )}
              >
                {p.previewUrl ? (
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground">
                    <ImageOff size={20} />
                  </div>
                )}
                {p.status === 'uploading' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
                    <Loader2 size={18} className="animate-spin text-white" />
                  </div>
                )}
                {p.status === 'failed' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-danger/70 text-white text-[10px] uppercase tracking-wider">
                    failed
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeNewPhoto(p.localId)}
                  className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background hover:bg-foreground"
                  aria-label="Remove photo"
                >
                  <X size={12} />
                </button>
              </div>
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
                <span className="text-[10px] uppercase tracking-wider">
                  Add photo
                </span>
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

// ── One row per inspection item ─────────────────────────────────────────────
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
  const skipped = result === 'na';

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3.5 transition-colors',
        passed && 'border-success/40 bg-success-bg/30',
        failed && 'border-danger/40 bg-danger-bg/30',
        skipped && 'border-border bg-muted/30 opacity-70',
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
            <p className="mt-1.5 text-xs text-muted-foreground italic">
              "{item.notes}"
            </p>
          )}
          {item.measurement_value != null && (
            <p className="mt-1 text-xs text-foreground">
              Value: {item.measurement_value}
              {tpl.measurement_unit ? ` ${tpl.measurement_unit}` : ''}
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
}

function BigButton({ tone, active, children, ...props }) {
  const toneClasses = {
    success: active
      ? 'bg-success text-white border-success shadow-sm'
      : 'border-border text-success hover:bg-success-bg hover:border-success/40',
    danger: active
      ? 'bg-danger text-white border-danger shadow-sm'
      : 'border-border text-danger hover:bg-danger-bg hover:border-danger/40',
    neutral: active
      ? 'bg-muted-foreground text-background border-muted-foreground shadow-sm'
      : 'border-border text-muted-foreground hover:bg-muted hover:border-muted-foreground/40',
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

// ── Page ──────────────────────────────────────────────────────────────────
export default function InspectionRunner() {
  const { woId, inspectionId } = useParams();
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyItemId, setBusyItemId] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [issueFor, setIssueFor] = useState(null); // item currently being failed

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/inspections/${inspectionId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [inspectionId, session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  async function mark(itemId, payload) {
    setBusyItemId(itemId);
    try {
      const r = await fetch(
        `${API_URL}/api/inspections/${inspectionId}/items/${itemId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      const resp = await r.json();
      if (!r.ok) {
        throw new Error(resp.message || resp.error || `HTTP ${r.status}`);
      }
      // No per-issue toast — the progress bar count and the
      // "N issues logged on this asset" badge in the footer already
      // communicate this. Toasts stack up and cover items while the
      // tech is walking the trailer.
      // Patch local state with the updated item.
      setData((d) => {
        if (!d) return d;
        return {
          ...d,
          sections: d.sections.map((s) => ({
            ...s,
            items: s.items.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    inspection_result: resp.item.inspection_result,
                    status: resp.item.status,
                    completed_at: resp.item.completed_at,
                    notes: resp.item.notes ?? i.notes,
                  }
                : i,
            ),
          })),
        };
      });
      // Close the issue modal if it was open for this item.
      setIssueFor((cur) => (cur?.id === itemId ? null : cur));
      // If this was an issue submission (added/removed photos or notes),
      // refresh from the server so the next edit sees the new photo state.
      const involvedPhotos =
        Array.isArray(payload.attachments) || Array.isArray(payload.remove_photo_ids);
      if (involvedPhotos) {
        // Fire-and-forget — current state already shows the right buttons,
        // we just want fresh photo URLs for the next edit.
        load();
      }
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Save failed', text: e.message });
      throw e;
    } finally {
      setBusyItemId(null);
    }
  }

  // Progress + counts
  const counts = useMemo(() => {
    if (!data) return { total: 0, done: 0, pass: 0, fail: 0, na: 0 };
    let total = 0,
      done = 0,
      pass = 0,
      fail = 0,
      na = 0;
    for (const s of data.sections) {
      for (const i of s.items) {
        total += 1;
        if (i.inspection_result) done += 1;
        const tpl = i.template_item || {};
        if (tpl.kind === 'yes_no') {
          if (tpl.good_answer && i.inspection_result && i.inspection_result !== tpl.good_answer)
            fail += 1;
          else if (tpl.good_answer && i.inspection_result === tpl.good_answer) pass += 1;
        } else {
          if (i.inspection_result === 'pass') pass += 1;
          if (i.inspection_result === 'fail') fail += 1;
          if (i.inspection_result === 'na') na += 1;
        }
      }
    }
    return { total, done, pass, fail, na };
  }, [data]);

  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const allDone = counts.total > 0 && counts.done === counts.total;
  const isCompleted = data?.inspection?.completed_at;

  async function finalize() {
    setFinalizing(true);
    try {
      const r = await fetch(`${API_URL}/api/inspections/${inspectionId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: 'Inspection complete',
        text: `${resp.counts?.pass || 0} OK · ${(resp.counts?.fail || 0) + (resp.counts?.no || 0)} issues`,
      });
      const unit = data?.inspection?.work_order?.asset_unit_number;
      if (unit) navigate(`/assets/${encodeURIComponent(unit)}`);
      else navigate('/');
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Could not finalize', text: e.message });
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={
          data
            ? `Inspecting ${data.inspection.work_order?.asset_unit_number || '?'}`
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

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        )}
        {err && (
          <Banner tone="danger" title="Couldn't load inspection">
            {err}
          </Banner>
        )}

        {!loading && !err && data && (
          <>
            {/* Sticky progress bar */}
            <div className="sticky top-14 md:top-16 -mx-4 md:mx-0 px-4 md:px-5 py-3 mb-6 z-30 bg-background/95 backdrop-blur border-b border-border md:border md:rounded-xl md:bg-card md:shadow-sm">
              <div className="flex items-center justify-between text-xs mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-foreground">
                    <span className="font-semibold">{counts.done}</span>/{counts.total} done
                  </span>
                  <span className="text-success">{counts.pass} OK</span>
                  <span className="text-danger">{counts.fail} issues</span>
                </div>
                <span className="text-muted-foreground font-mono">{pct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    counts.fail > 0 ? 'bg-warning' : 'bg-success',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Sections — each gets a clear, larger heading with its own item count */}
            <div className="space-y-10">
              {data.sections.map((sec) => {
                const sectionDone = sec.items.filter((i) => i.inspection_result).length;
                const sectionFail = sec.items.filter(
                  (i) =>
                    i.inspection_result === 'fail' ||
                    (i.template_item?.kind === 'yes_no' &&
                      i.template_item?.good_answer &&
                      i.inspection_result &&
                      i.inspection_result !== i.template_item.good_answer),
                ).length;
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
                    <div className="space-y-2.5">
                      {sec.items.map((it) => (
                        <ItemRow
                          key={it.id}
                          item={it}
                          busy={busyItemId === it.id}
                          onMark={mark}
                          onOpenIssue={(item) => setIssueFor(item)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* Footer — finalize */}
            <div className="mt-10 mb-12">
              <Card className="p-5">
                {isCompleted ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-success" />
                    Inspection completed{' '}
                    {new Date(data.inspection.completed_at).toLocaleString()}
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                      <h2 className="font-display text-xl">Sign & submit</h2>
                      {counts.fail > 0 && (
                        <Badge tone="warning">
                          {counts.fail} issue{counts.fail === 1 ? '' : 's'} logged on this asset
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Submitting signs the inspection with a timestamp. Any
                      issues are already open on{' '}
                      <span className="font-mono">
                        {data.inspection.work_order?.asset_unit_number}
                      </span>{' '}
                      and visible to the next tech.
                    </p>
                    {!allDone && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-warning">
                        <AlertTriangle size={14} />
                        {counts.total - counts.done} item
                        {counts.total - counts.done === 1 ? '' : 's'} still pending.
                      </div>
                    )}
                    <div className="mt-4 flex justify-end">
                      <Button
                        onClick={finalize}
                        loading={finalizing}
                        disabled={!allDone || finalizing}
                      >
                        <ClipboardCheck size={16} />
                        Sign & submit inspection
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </div>
          </>
        )}
      </main>

      <IssueModal
        open={Boolean(issueFor)}
        item={issueFor}
        onClose={() => setIssueFor(null)}
        onConfirm={mark}
        busy={busyItemId === issueFor?.id}
        accessToken={session.access_token}
      />
    </div>
  );
}
