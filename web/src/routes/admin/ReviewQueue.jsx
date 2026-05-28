// /admin/work-orders/pending — admin review queue.
//
// Post-redesign: a WO is a session with multiple items. The reviewer sees:
//   - WO header (asset, tech, opening meter, summary)
//   - All items (title, type, source, status, notes, skipped reason)
//   - Photos
//   - Approve / Reject. Editing the summary is the only WO-level fix; per-
//     item fixes will come in a later iteration.

import { useEffect, useState, useCallback } from 'react';
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
  Clock,
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

const easeOut = [0.16, 1, 0.3, 1];

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

function ItemStatusIcon({ status }) {
  if (status === 'done') return <CheckCircle2 size={14} className="text-success" />;
  if (status === 'skipped') return <XCircle size={14} className="text-muted-foreground" />;
  return <Clock size={14} className="text-warning" />;
}

function SourceBadge({ source }) {
  if (source === 'issue') return <Badge tone="warning">issue</Badge>;
  if (source === 'pm_schedule') return <Badge tone="accent">PM</Badge>;
  if (source === 'campaign_assignment') return <Badge tone="accent">campaign</Badge>;
  return <Badge tone="neutral">ad-hoc</Badge>;
}

// ---------- Per-row card --------------------------------------------------
function PendingWO({ wo, onApprove, onReject, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    summary: wo.summary || '',
    asset_unit_number: wo.asset_unit_number || '',
  });

  async function saveAndApprove() {
    await onSave(wo.id, form);
    await onApprove(wo.id);
    setEditing(false);
  }

  const meter = fmtMeter(wo.opening_meter);

  return (
    <Card className="p-5">
      {/* Header: tech + time + meter */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Badge tone="warning">pending review</Badge>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono">WO-{wo.id.slice(0, 8)}</span>
            <span className="mx-1.5">·</span>
            {wo.user?.full_name || '?'}
            <span className="mx-1.5 text-muted-foreground/60">({wo.user?.role})</span>
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

      {/* Asset + summary (or edit form) */}
      {!editing ? (
        <>
          <div className="flex items-baseline gap-3 mb-1">
            <h3 className="font-display text-xl tracking-tight">
              {wo.asset_unit_number}
            </h3>
            {wo.summary && (
              <span className="text-foreground/80 text-sm">— {wo.summary}</span>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3 mb-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Input
              label="Asset"
              value={form.asset_unit_number}
              onChange={(e) =>
                setForm({ ...form, asset_unit_number: e.target.value.toUpperCase() })
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

      {/* Items */}
      {wo.items?.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {wo.items.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-2 text-sm text-foreground/90 rounded-md border border-border/60 bg-muted/30 p-3"
            >
              <span className="mt-0.5">
                <ItemStatusIcon status={it.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{it.title}</span>
                  <SourceBadge source={it.source} />
                  <Badge tone="neutral">{it.type}</Badge>
                  <Badge tone="neutral">{it.status}</Badge>
                </div>
                {it.description && (
                  <p className="mt-1 text-xs text-foreground/75">{it.description}</p>
                )}
                {it.raw_input && it.raw_input !== it.description && (
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    "{it.raw_input}"
                  </p>
                )}
                {it.notes && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    notes: {it.notes}
                  </p>
                )}
                {it.skipped_reason && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    skipped: {it.skipped_reason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground italic">
          No items on this WO.
        </p>
      )}

      {/* Photos */}
      {wo.action_photos?.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
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

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2 justify-end">
        {editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveAndApprove} loading={busy}>
              Save & approve
            </Button>
          </>
        ) : (
          <>
            <Link
              to={`/assets/${encodeURIComponent(wo.asset_unit_number)}`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors mr-2 inline-flex items-center gap-1"
            >
              <ExternalLink size={12} />
              View {wo.asset_unit_number}
            </Link>
            <Button variant="danger" size="sm" onClick={() => onReject(wo)} disabled={busy}>
              <X size={14} />
              Reject
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              <Edit3 size={14} />
              Fix
            </Button>
            <Button size="sm" onClick={() => onApprove(wo.id)} loading={busy} disabled={busy}>
              <Check size={14} />
              Approve
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- Reject Modal --------------------------------------------------
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
      title={`Reject WO-${wo?.id?.slice(0, 8) || ''}`}
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

// ---------- Page ---------------------------------------------------------
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
      const r = await fetch(`${API_URL}/api/admin/work-orders/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRows((curr) => curr.filter((w) => w.id !== id));
      pushToast({
        tone: 'success',
        title: 'Approved',
        text: `WO-${id.slice(0, 8)} · ${data.work_order.asset_unit_number}`,
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
            Approve once the items look right. Reject with a note when the
            tech needs to redo something.
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
