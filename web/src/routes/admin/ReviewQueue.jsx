// /admin/work-orders/pending — admin review queue.
//
// Redesigned: the reviewer's job is to spot anomalies fast. Today this
// page surfaces them; the previous version buried them under N rows of
// identical-looking passes. The new layout:
//
//   - WO header carries the summary line ("57 items: 52 pass · 5 fail")
//   - Failing / skipped items render expanded with a danger left-edge
//     border and FAIL/SKIP badge
//   - Passing items collapse behind a single "N passing — tap to expand"
//     strip. Reviewer reads 5 rows, not 57
//   - Triple ad-hoc/inspection/pending badging is gone. The WO header
//     conveys "what kind of WO," and per-row status is the icon + color
//   - Single primary action: Approve. Reject opens a note modal. Edit
//     (asset / summary) is now a small pencil icon in the WO header,
//     not a button competing with Approve

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Check,
  Edit3,
  X,
  ImageOff,
  Inbox,
  ExternalLink,
  Loader2,
  Gauge,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { API_URL } from '../../lib/supabase.js';
import {
  Header,
  Card,
  Badge,
  SectionLabel,
  Banner,
  Button,
  Input,
  Textarea,
  Modal,
  useToast,
} from '../../components/ui/index.js';
import { cn } from '../../lib/cn.js';
import { woLabel } from '../../lib/numbers.js';

const easeOut = [0.16, 1, 0.3, 1];

// ──────────────────────────────────────────────────────────────────────────
//  Pure helpers
// ──────────────────────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtMeter(meter) {
  if (!meter) return null;
  const u = meter.unit === 'miles' ? 'mi' : 'hr';
  return `${meter.value.toLocaleString()} ${u}`;
}

// "[Inspection fail] Air tank — drain valves functional" → strip prefix.
const INSPECTION_FAIL_PREFIX_RE = /^\s*\[\s*inspection\s+fail\s*\]\s*/i;
function cleanTitle(title) {
  if (!title) return '';
  return title.replace(INSPECTION_FAIL_PREFIX_RE, '');
}

// raw_input: "inspection_item:<uuid>" — implementation detail. Hide it.
const RAW_INPUT_NOISE_RE = /^inspection_item:[0-9a-f-]{36}$/i;
function visibleRawInput(raw) {
  if (!raw) return null;
  if (RAW_INPUT_NOISE_RE.test(raw.trim())) return null;
  return raw;
}

// Decide whether a row warrants the admin's attention.
// "Attention" = inspection failure OR skipped item OR pending-on-a-completed-WO.
// Everything else (done + pass/no-result) is a "passing" row that collapses.
function classifyItem(it) {
  const isInspectionFail =
    it.inspection_result === 'fail' || it.inspection_result === 'no';
  if (isInspectionFail) return 'fail';
  if (it.status === 'skipped') return 'skipped';
  if (it.status === 'pending') return 'pending';
  return 'pass';
}

function summarize(items) {
  const totals = { total: items.length, pass: 0, fail: 0, skipped: 0, pending: 0 };
  for (const it of items) {
    const k = classifyItem(it);
    totals[k] += 1;
  }
  return totals;
}

// ──────────────────────────────────────────────────────────────────────────
//  Item row (the per-WO line item)
// ──────────────────────────────────────────────────────────────────────────

function ItemRow({ item }) {
  const cls = classifyItem(item);
  const title = cleanTitle(item.title);
  const raw = visibleRawInput(item.raw_input);

  // Visual treatment by class. Failing/skipped items get the danger or
  // muted left border + colored icon to scream "look here" at peripheral
  // vision. Pass/done rows (when expanded) are subdued.
  const borderClass = {
    fail: 'border-l-4 border-l-danger',
    skipped: 'border-l-4 border-l-muted-foreground/40',
    pending: 'border-l-4 border-l-warning',
    pass: 'border-l-4 border-l-success/60',
  }[cls];

  const icon = {
    fail: <XCircle size={16} className="text-danger" />,
    skipped: <X size={16} className="text-muted-foreground" />,
    pending: <AlertCircle size={16} className="text-warning" />,
    pass: <CheckCircle2 size={16} className="text-success" />,
  }[cls];

  const sideBadge = {
    fail: <Badge tone="danger">FAIL</Badge>,
    skipped: <Badge tone="neutral">skipped</Badge>,
    pending: <Badge tone="warning">pending</Badge>,
    pass: null,
  }[cls];

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-md bg-card p-3',
        'border border-border/60',
        borderClass,
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground leading-snug">
            {title}
          </p>
          {sideBadge}
        </div>
        {item.description && (
          <p className="mt-1 text-xs text-foreground/75 leading-relaxed">
            {item.description}
          </p>
        )}
        {raw && raw !== item.description && (
          <p className="mt-1 text-xs text-muted-foreground italic leading-relaxed">
            "{raw}"
          </p>
        )}
        {item.notes && (
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-foreground/70">Notes:</span> {item.notes}
          </p>
        )}
        {item.skipped_reason && item.skipped_reason !== 'no reason given' && (
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-foreground/70">Skipped:</span>{' '}
            {item.skipped_reason}
          </p>
        )}
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  WO card
// ──────────────────────────────────────────────────────────────────────────

function PendingWO({ wo, onApprove, onReject, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [expandPasses, setExpandPasses] = useState(false);
  const [form, setForm] = useState({
    summary: wo.summary || '',
    asset_unit_number: wo.asset_unit_number || '',
  });

  const meter = fmtMeter(wo.opening_meter);
  const totals = useMemo(() => summarize(wo.items || []), [wo.items]);

  // Split items into "needs attention" (fail/skipped/pending) and "passes".
  // Pre-sort attention items by failure severity so FAIL lands first.
  const itemsByClass = useMemo(() => {
    const acc = { fail: [], skipped: [], pending: [], pass: [] };
    for (const it of wo.items || []) acc[classifyItem(it)].push(it);
    return acc;
  }, [wo.items]);

  const attentionItems = [
    ...itemsByClass.fail,
    ...itemsByClass.skipped,
    ...itemsByClass.pending,
  ];
  const passItems = itemsByClass.pass;

  async function saveAndApprove() {
    await onSave(wo.id, form);
    await onApprove(wo.id);
    setEditing(false);
  }

  return (
    <Card className="p-5">
      {/* ── WO HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Badge tone="warning">pending review</Badge>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono">{woLabel(wo)}</span>
            <span className="mx-1.5">·</span>
            {wo.user?.full_name || '?'}
            <span className="mx-1.5 text-muted-foreground/60">
              ({wo.user?.role})
            </span>
          </span>
          {meter && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Gauge size={11} /> {meter}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {relativeTime(wo.completed_at || wo.started_at)}
        </span>
      </div>

      {!editing ? (
        <div className="mb-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-display text-xl tracking-tight">
              {wo.asset_unit_number}
            </h3>
            <Link
              to={`/assets/${encodeURIComponent(wo.asset_unit_number)}`}
              className="text-xs text-accent hover:underline inline-flex items-center gap-0.5"
            >
              View kardex <ExternalLink size={11} />
            </Link>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              aria-label="Edit asset / summary"
            >
              <Edit3 size={12} /> Edit
            </button>
          </div>
          {wo.summary && (
            <p className="mt-1 text-sm text-foreground/80">{wo.summary}</p>
          )}
          {/* Summary line: the spine of the new design */}
          <p className="mt-2 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {totals.total} {totals.total === 1 ? 'item' : 'items'}
            </span>
            {totals.pass > 0 && (
              <>
                {' · '}
                <span className="text-success">{totals.pass} pass</span>
              </>
            )}
            {totals.fail > 0 && (
              <>
                {' · '}
                <span className="text-danger font-semibold">
                  {totals.fail} fail
                </span>
              </>
            )}
            {totals.skipped > 0 && (
              <>
                {' · '}
                <span>{totals.skipped} skipped</span>
              </>
            )}
            {totals.pending > 0 && (
              <>
                {' · '}
                <span className="text-warning">{totals.pending} pending</span>
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Input
              label="Asset"
              value={form.asset_unit_number}
              onChange={(e) =>
                setForm({
                  ...form,
                  asset_unit_number: e.target.value.toUpperCase(),
                })
              }
            />
            <Input
              label="Summary"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="Optional one-liner across all items."
            />
          </div>
        </div>
      )}

      {/* ── ITEMS: attention first, then collapsed passes ────────────── */}
      {totals.total === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No items on this WO.
        </p>
      ) : (
        <>
          {attentionItems.length > 0 && (
            <ul className="space-y-2">
              {attentionItems.map((it) => (
                <ItemRow key={it.id} item={it} />
              ))}
            </ul>
          )}

          {passItems.length > 0 && (
            <div className={cn(attentionItems.length > 0 && 'mt-3')}>
              <button
                type="button"
                onClick={() => setExpandPasses((v) => !v)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 rounded-md px-3 py-2',
                  'border border-border bg-muted/30 text-sm text-foreground/80',
                  'hover:bg-muted/50 transition-colors',
                )}
                aria-expanded={expandPasses}
              >
                <span className="inline-flex items-center gap-2">
                  {expandPasses ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span>
                    {passItems.length} passing{' '}
                    {passItems.length === 1 ? 'item' : 'items'}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {expandPasses ? 'hide' : 'tap to expand'}
                </span>
              </button>
              {expandPasses && (
                <ul className="mt-2 space-y-2">
                  {passItems.map((it) => (
                    <ItemRow key={it.id} item={it} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* ── PHOTOS ───────────────────────────────────────────────────── */}
      {wo.action_photos?.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {wo.action_photos.map((p) =>
            p.url ? (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="relative group shrink-0 h-24 w-24 rounded-lg overflow-hidden border border-border hover:border-accent/50 transition-colors"
              >
                <img
                  src={p.url}
                  alt={p.caption || ''}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <span className="absolute bottom-1 right-1 rounded bg-foreground/70 text-background p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={11} />
                </span>
              </a>
            ) : (
              <div
                key={p.id}
                className="shrink-0 h-24 w-24 rounded-lg border border-border bg-muted flex items-center justify-center text-muted-foreground"
              >
                <ImageOff size={20} />
              </div>
            ),
          )}
        </div>
      )}

      {/* ── ACTIONS ──────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2 justify-end">
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={saveAndApprove} loading={busy}>
              Save & approve
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="danger"
              size="sm"
              onClick={() => onReject(wo)}
              disabled={busy}
            >
              <X size={14} />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(wo.id)}
              loading={busy}
              disabled={busy}
            >
              <Check size={14} />
              Approve
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Reject modal
// ──────────────────────────────────────────────────────────────────────────

function RejectModal({ open, wo, onClose, onConfirm, busy }) {
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) setNotes('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      destructive
      title={`Reject ${wo ? woLabel(wo) : ''}`}
      description="The tech will see your note. Be specific — what's wrong and what they should do."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(wo.id, notes.trim())}
            loading={busy}
            disabled={busy || !notes.trim()}
          >
            Reject work order
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="e.g. Wrong truck — should be CC04, not CC03. Please re-log."
        autoFocus
      />
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Page
// ──────────────────────────────────────────────────────────────────────────

export default function ReviewQueue() {
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/admin/work-orders/pending`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRows(data.work_orders || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id) {
    setBusyId(id);
    try {
      const r = await fetch(
        `${API_URL}/api/admin/work-orders/${id}/approve`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRows((curr) => curr.filter((w) => w.id !== id));
      pushToast({
        tone: 'success',
        title: 'Approved',
        text: `${woLabel(data.work_order) || id.slice(0, 8)} · ${data.work_order.asset_unit_number}`,
      });
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Approve failed', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id, notes) {
    setBusyId(id);
    try {
      const r = await fetch(`${API_URL}/api/admin/work-orders/${id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notes }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRows((curr) => curr.filter((w) => w.id !== id));
      pushToast({ tone: 'warning', title: 'Rejected', text: `WO-${id.slice(0, 8)}` });
      setRejecting(null);
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Reject failed', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdits(id, fields) {
    const r = await fetch(`${API_URL}/api/admin/work-orders/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(fields),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    pushToast({ tone: 'info', title: 'Saved edits', ttl: 1500 });
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={
          rows && rows.length > 0
            ? `Review queue · ${rows.length} pending`
            : 'Review queue'
        }
        sticky
      />
      <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="mb-6"
        >
          <SectionLabel tone="warning" pulse>
            Pending Review
          </SectionLabel>
          <h1 className="mt-4 font-display text-3xl md:text-4xl tracking-tight leading-tight">
            Review <span className="text-gradient">work orders</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Each WO is a tech session on an asset with one or more items.
            Failing and skipped items are surfaced at the top of each card;
            passing items collapse so you can scan a 57-item inspection in
            seconds.
          </p>
        </motion.div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        )}

        {err && (
          <Banner tone="danger" title="Couldn't load the queue">
            {err}
          </Banner>
        )}

        {!loading && !err && rows && rows.length === 0 && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success">
              <Inbox size={22} />
            </div>
            <p className="font-display text-2xl tracking-tight">All clear.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No work orders waiting for review.
            </p>
          </Card>
        )}

        {!loading && rows && rows.length > 0 && (
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {rows.map((wo) => (
                <motion.div
                  key={wo.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.35, ease: easeOut }}
                >
                  <PendingWO
                    wo={wo}
                    busy={busyId === wo.id}
                    onApprove={approve}
                    onReject={(w) => setRejecting(w)}
                    onSave={saveEdits}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <RejectModal
        open={Boolean(rejecting)}
        wo={rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={reject}
        busy={Boolean(busyId)}
      />
    </div>
  );
}
