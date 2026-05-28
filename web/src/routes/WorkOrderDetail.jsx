// /work-orders/:woId — operator surface for a single work order.
//
// Shows the WO's items grouped (Pending / Done / Inspections collapsed),
// lets the tech pick up open issues and due PMs as new items, mark each
// one done or skipped, and close the WO. Closing with pending items
// reverts their linked issues back to 'open' so another tech can pick
// them up later.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Plus,
  Check,
  X,
  AlertCircle,
  ClipboardCheck,
  Loader2,
  Gauge,
  CheckCircle2,
  Wrench,
  SkipForward,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import {
  Header,
  Card,
  Badge,
  Banner,
  Button,
  Textarea,
  Input,
  Modal,
  ModalActions,
  useToast,
  SectionLabel,
} from '../components/ui/index.js';
import { cn } from '../lib/cn.js';
import { woLabel, issueLabel } from '../lib/numbers.js';

const easeOut = [0.16, 1, 0.3, 1];

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function SourceBadge({ source }) {
  if (source === 'issue') return <Badge tone="warning">issue</Badge>;
  if (source === 'pm_schedule') return <Badge tone="accent">PM</Badge>;
  if (source === 'campaign_assignment') return <Badge tone="accent">campaign</Badge>;
  if (source === 'inspection_template') return <Badge tone="accent">inspection</Badge>;
  return <Badge tone="neutral">ad-hoc</Badge>;
}

// ── Add Issue modal (multi-select) ─────────────────────────────────────────
// Tech checks one or more open issues, then taps Add (N) to link them all
// at once. "Add all" is a one-tap shortcut for the whole list. Each issue
// is POSTed as a separate line item by the parent.
function AddIssueModal({ open, assetUnit, accessToken, onClose, onPicked, busy }) {
  const [issues, setIssues] = useState(null);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    setIssues(null);
    setErr(null);
    setSelected(new Set());
    fetch(
      `${API_URL}/api/issues?asset_unit_number=${encodeURIComponent(assetUnit)}&status=open,acknowledged`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setIssues(d.issues || []))
      .catch((e) => setErr(e.message || `HTTP ${e.status}`));
  }, [open, assetUnit, accessToken]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelected() {
    if (!issues) return;
    const picked = issues.filter((i) => selected.has(i.id));
    if (picked.length === 0) return;
    onPicked(picked);
  }

  function addAll() {
    if (!issues || issues.length === 0) return;
    onPicked(issues);
  }

  const count = selected.size;
  const hasIssues = issues && issues.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add open issues to this WO"
      description={`Pick one or more open issues on ${assetUnit}. Each one becomes a line item and auto-resolves when marked done.`}
      footer={
        <ModalActions onCancel={onClose}>
          {hasIssues && (
            <>
              <Button
                variant="secondary"
                onClick={addAll}
                disabled={busy}
              >
                <Plus size={14} /> Add all ({issues.length})
              </Button>
              <Button
                variant="primary"
                onClick={addSelected}
                disabled={busy || count === 0}
              >
                <Check size={14} /> Add{count > 0 ? ` (${count})` : ''}
              </Button>
            </>
          )}
        </ModalActions>
      }
    >
      {!issues && !err && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}
      {err && <Banner tone="danger" title="Couldn't load issues">{err}</Banner>}
      {issues && issues.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No open issues on {assetUnit}.
        </p>
      )}
      {hasIssues && (
        <ul className="space-y-2">
          {issues.map((i) => {
            const isChecked = selected.has(i.id);
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => toggle(i.id)}
                  disabled={busy}
                  aria-pressed={isChecked}
                  className={cn(
                    'w-full text-left rounded-lg border px-4 py-3 transition-colors',
                    'disabled:opacity-50 flex items-start gap-3',
                    isChecked
                      ? 'border-accent bg-accent-bg'
                      : 'border-border bg-card hover:border-accent/40',
                  )}
                >
                  {/* Checkbox indicator — large tap target, visible state */}
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 h-5 w-5 rounded border flex items-center justify-center',
                      isChecked
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-border bg-background',
                    )}
                    aria-hidden="true"
                  >
                    {isChecked && <Check size={14} strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {issueLabel(i)}
                      </span>
                      <span className="font-medium text-sm">{i.title}</span>
                    </div>
                    {i.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {i.description}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ── Add PM modal ───────────────────────────────────────────────────────────
function AddPmModal({ open, assetUnit, accessToken, onClose, onPicked, busy }) {
  const [pms, setPms] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setPms(null);
    setErr(null);
    fetch(
      `${API_URL}/api/work-orders/pending-for/${encodeURIComponent(assetUnit)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setPms(d.pm_schedules_all || d.pm_schedules || []))
      .catch((e) => setErr(e.message || `HTTP ${e.status}`));
  }, [open, assetUnit, accessToken]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a PM to this WO"
      description={`Active PM schedules on ${assetUnit}. Picking one snaps its last-completed when you mark the item done.`}
      footer={<ModalActions onCancel={onClose} hideConfirm />}
    >
      {!pms && !err && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}
      {err && <Banner tone="danger" title="Couldn't load PMs">{err}</Banner>}
      {pms && pms.length === 0 && (
        <p className="text-sm text-muted-foreground">No PMs on {assetUnit}.</p>
      )}
      {pms && pms.length > 0 && (
        <ul className="space-y-2">
          {pms.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPicked(p)}
                disabled={busy}
                className={cn(
                  'w-full text-left rounded-lg border border-border bg-card px-4 py-3',
                  'hover:border-accent/40 transition-colors disabled:opacity-50',
                )}
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-sm">{p.name}</span>
                  {p.due && (
                    <Badge
                      tone={
                        p.due === 'overdue'
                          ? 'danger'
                          : p.due === 'due_soon'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {p.due.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.cadence_type === 'miles' && `Every ${p.interval_miles?.toLocaleString()} mi`}
                  {p.cadence_type === 'hours' && `Every ${p.interval_hours?.toLocaleString()} hr`}
                  {p.cadence_type === 'months' && `Every ${p.interval_months} month${p.interval_months === 1 ? '' : 's'}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ── Add ad-hoc modal ────────────────────────────────────────────────────────
function AddAdHocModal({ open, onClose, onSubmit, busy }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('repair');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setTitle('');
      setType('repair');
      setDescription('');
    }
  }, [open]);

  const canSubmit = title.trim().length >= 3;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add ad-hoc work"
      description="Use this for one-off work not tied to an issue, PM, or campaign."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                title: title.trim(),
                type,
                description: description.trim() || null,
              })
            }
            disabled={!canSubmit || busy}
            loading={busy}
          >
            <Plus size={16} /> Add item
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Short title"
          placeholder="e.g. Tighten loose mirror"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Type
          </label>
          <div className="flex gap-2 flex-wrap">
            {['repair', 'pm', 'inspection', 'other'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors capitalize',
                  type === t
                    ? 'border-accent/60 bg-accent/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <Textarea
          label="Notes"
          optional
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Modal>
  );
}

// ── Close confirmation ────────────────────────────────────────────────────
function CloseConfirmModal({
  open,
  onClose,
  onConfirm,
  busy,
  pendingItems,
  doneItems,
}) {
  const [summary, setSummary] = useState('');
  useEffect(() => {
    if (open) setSummary('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Close work order"
      description="Summarize what was done in this WO. Any pending items are released back so they can be added to a future WO."
      destructive={pendingItems.length > 0}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={pendingItems.length > 0 ? 'danger' : 'primary'}
            onClick={() => onConfirm(summary.trim())}
            loading={busy}
          >
            <CheckCircle2 size={16} /> Close WO
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="Summary"
          optional
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="e.g. Fixed cruise control, oil change, brakes within spec."
        />
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm space-y-1">
          <p>
            <span className="font-mono text-muted-foreground">DONE</span>{' '}
            <span className="font-semibold">{doneItems.length}</span> item
            {doneItems.length === 1 ? '' : 's'}
          </p>
          <p>
            <span className="font-mono text-muted-foreground">PENDING</span>{' '}
            <span className="font-semibold">{pendingItems.length}</span> item
            {pendingItems.length === 1 ? '' : 's'}{' '}
            {pendingItems.length > 0 && (
              <span className="text-warning">
                — will revert to open and need a future WO
              </span>
            )}
          </p>
        </div>
        {pendingItems.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Show pending items
            </summary>
            <ul className="mt-2 space-y-1.5 pl-3 border-l border-border">
              {pendingItems.map((it) => (
                <li key={it.id} className="text-foreground/80">
                  <span className="font-medium">{it.title}</span>
                  {it.source === 'issue' && (
                    <span className="ml-2 text-warning">→ issue re-opens</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function WorkOrderDetail() {
  const { woId } = useParams();
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const navigate = useNavigate();

  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(null); // 'issue' | 'pm' | 'adhoc' | 'close'
  const [pickerBusy, setPickerBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/work-orders/${woId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setWo(data.work_order);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [woId, session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => wo?.items || [], [wo]);
  const inspectionItems = items.filter((i) => i.source === 'inspection_template');
  const otherItems = items.filter((i) => i.source !== 'inspection_template');
  const pending = otherItems.filter((i) => i.status === 'pending');
  const done = otherItems.filter((i) => i.status === 'done');
  const skipped = otherItems.filter((i) => i.status === 'skipped');

  // One summary line per inspection template referenced.
  const inspectionSummaries = useMemo(() => {
    const map = new Map();
    for (const it of inspectionItems) {
      const k = it.inspection_template_id || 'unknown';
      const cur = map.get(k) || { total: 0, done: 0, fail: 0 };
      cur.total += 1;
      if (it.status === 'done') cur.done += 1;
      if (it.inspection_result === 'fail' || it.inspection_result === 'no') cur.fail += 1;
      map.set(k, cur);
    }
    return [...map.values()];
  }, [inspectionItems]);

  async function addItem({ source, source_id, type, title, description }) {
    setPickerBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/work-orders/${woId}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ source, source_id, type, title, description }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({ tone: 'success', title: 'Item added' });
      setPickerOpen(null);
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Add failed', text: e.message });
    } finally {
      setPickerBusy(false);
    }
  }

  // Bulk-add a batch of issues as line items. Posts one at a time so a
  // mid-batch failure tells us exactly which issue blew up; on first
  // failure we stop, refresh state, and toast which one failed.
  async function addIssues(issues) {
    if (!issues || issues.length === 0) return;
    setPickerBusy(true);
    let added = 0;
    try {
      for (const iss of issues) {
        const r = await fetch(`${API_URL}/api/work-orders/${woId}/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            source: 'issue',
            source_id: iss.id,
            type: 'repair',
            title: iss.title,
            description: iss.description || null,
          }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(
            `${iss.title}: ${body.error || `HTTP ${r.status}`}`,
          );
        }
        added += 1;
      }
      pushToast({
        tone: 'success',
        title: added === 1 ? 'Issue added' : `${added} issues added`,
      });
      setPickerOpen(null);
    } catch (e) {
      pushToast({
        tone: 'danger',
        title:
          added > 0
            ? `Stopped after ${added} added — next one failed`
            : 'Add failed',
        text: e.message,
      });
    } finally {
      await load();
      setPickerBusy(false);
    }
  }

  async function patchItem(itemId, body) {
    setBusyId(itemId);
    try {
      const r = await fetch(
        `${API_URL}/api/work-orders/${woId}/items/${itemId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // Tell the tech when a skip released a linked issue back to the
      // open queue — otherwise it silently disappears.
      if (body.status === 'skipped' && data.reverted_issue_id) {
        pushToast({
          tone: 'info',
          title: 'Issue released',
          text: 'Returned to Open issues so another WO can pick it up.',
        });
      }
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Save failed', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function closeWo(summary) {
    setPickerBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/work-orders/${woId}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ summary }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: 'Closed',
        text:
          data.skipped_item_count > 0
            ? `${data.skipped_item_count} pending item${data.skipped_item_count === 1 ? '' : 's'} released back to open.`
            : 'WO closed. Pending review by admin.',
      });
      const unit = wo?.asset_unit_number;
      navigate(unit ? `/assets/${encodeURIComponent(unit)}` : '/');
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Close failed', text: e.message });
    } finally {
      setPickerBusy(false);
    }
  }

  const status = wo?.status;
  const isClosable = status === 'open' || status === 'in_progress';

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={wo ? `${woLabel(wo, { handle: wo.user?.handle })} · ${wo.asset_unit_number}` : 'Work order'}
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
            to={wo ? `/assets/${encodeURIComponent(wo.asset_unit_number)}` : '/work-orders'}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={14} />
            <span className="uppercase tracking-widest">
              Back to {wo?.asset_unit_number || 'work orders'}
            </span>
          </Link>
          <h1 className="mt-2 font-display text-3xl md:text-4xl tracking-tight leading-tight">
            {wo ? woLabel(wo, { handle: wo.user?.handle }) : 'Work order'}
          </h1>
          {wo && (
            <p className="mt-2 text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-foreground">{wo.asset_unit_number}</span>
              <span>·</span>
              <span>{wo.user?.full_name || '?'}</span>
              <span>·</span>
              <span>{relTime(wo.started_at)}</span>
              {wo.opening_meter && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Gauge size={12} />
                    {wo.opening_meter.value.toLocaleString()}{' '}
                    {wo.opening_meter.unit === 'hours' ? 'hr' : 'mi'}
                  </span>
                </>
              )}
              <span>·</span>
              <Badge
                tone={
                  status === 'completed'
                    ? 'success'
                    : status === 'voided'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {status?.replace('_', ' ')}
              </Badge>
            </p>
          )}
        </motion.div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {err && <Banner tone="danger" title="Couldn't load WO">{err}</Banner>}

        {wo && (
          <>
            {/* Inspection summary (collapsed; runner is the place to interact) */}
            {inspectionSummaries.length > 0 && (
              <section className="mb-8">
                <SectionLabel tone="accent">
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardCheck size={12} /> Inspection
                  </span>
                </SectionLabel>
                <div className="mt-3 space-y-2">
                  {inspectionSummaries.map((s, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 text-sm rounded-md border border-border/60 bg-muted/30 px-3 py-2"
                    >
                      <SourceBadge source="inspection_template" />
                      <span className="text-foreground/85">
                        {s.done}/{s.total} done
                        {s.fail > 0 && <span className="text-danger"> · {s.fail} fail</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Pending */}
            <section className="mb-8">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <SectionLabel tone="warning">
                  <span className="inline-flex items-center gap-1.5">
                    <Wrench size={12} /> Pending
                  </span>
                </SectionLabel>
                <span className="text-xs text-muted-foreground">{pending.length}</span>
              </div>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing pending.</p>
              ) : (
                <div className="space-y-2.5">
                  {pending.map((it) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      onDone={(notes) =>
                        patchItem(it.id, { status: 'done', notes })
                      }
                      onSkip={(reason) =>
                        patchItem(it.id, { status: 'skipped', skipped_reason: reason })
                      }
                      busy={busyId === it.id}
                    />
                  ))}
                </div>
              )}

              {/* Add work — only when WO is still active */}
              {isClosable && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => setPickerOpen('issue')}>
                    <Plus size={14} /> Add issue
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setPickerOpen('pm')}>
                    <Plus size={14} /> Add PM
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setPickerOpen('adhoc')}>
                    <Plus size={14} /> Add ad-hoc
                  </Button>
                </div>
              )}
            </section>

            {/* Done */}
            {done.length > 0 && (
              <section className="mb-8">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <SectionLabel tone="success">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> Done
                    </span>
                  </SectionLabel>
                  <span className="text-xs text-muted-foreground">{done.length}</span>
                </div>
                <div className="space-y-2">
                  {done.map((it) => (
                    <DoneRow key={it.id} item={it} />
                  ))}
                </div>
              </section>
            )}

            {/* Skipped */}
            {skipped.length > 0 && (
              <section className="mb-8">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <SectionLabel tone="neutral">
                    <span className="inline-flex items-center gap-1.5">
                      <SkipForward size={12} /> Skipped
                    </span>
                  </SectionLabel>
                  <span className="text-xs text-muted-foreground">{skipped.length}</span>
                </div>
                <div className="space-y-2">
                  {skipped.map((it) => (
                    <DoneRow key={it.id} item={it} />
                  ))}
                </div>
              </section>
            )}

            {/* Close */}
            {isClosable && (
              <div className="mt-10 mb-12 flex justify-end">
                <Button onClick={() => setPickerOpen('close')}>
                  <CheckCircle2 size={16} /> Close work order
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <AddIssueModal
        open={pickerOpen === 'issue'}
        assetUnit={wo?.asset_unit_number || ''}
        accessToken={session.access_token}
        onClose={() => setPickerOpen(null)}
        onPicked={addIssues}
        busy={pickerBusy}
      />
      <AddPmModal
        open={pickerOpen === 'pm'}
        assetUnit={wo?.asset_unit_number || ''}
        accessToken={session.access_token}
        onClose={() => setPickerOpen(null)}
        onPicked={(pm) =>
          addItem({
            source: 'pm_schedule',
            source_id: pm.id,
            type: 'pm',
            title: pm.name,
          })
        }
        busy={pickerBusy}
      />
      <AddAdHocModal
        open={pickerOpen === 'adhoc'}
        onClose={() => setPickerOpen(null)}
        onSubmit={(form) => addItem({ source: 'ad_hoc', ...form })}
        busy={pickerBusy}
      />
      <CloseConfirmModal
        open={pickerOpen === 'close'}
        onClose={() => setPickerOpen(null)}
        onConfirm={closeWo}
        busy={pickerBusy}
        pendingItems={pending}
        doneItems={done}
      />
    </div>
  );
}

// ── Item rows ──────────────────────────────────────────────────────────────
function ItemRow({ item, onDone, onSkip, busy }) {
  const [showSkipForm, setShowSkipForm] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-medium text-foreground">{item.title}</p>
            <SourceBadge source={item.source} />
            <Badge tone="neutral">{item.type}</Badge>
          </div>
          {item.description && (
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            onClick={() => onDone(null)}
            loading={busy}
            disabled={busy}
          >
            <Check size={14} /> Done
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSkipForm((v) => !v)}
            disabled={busy}
          >
            <SkipForward size={14} /> Skip
          </Button>
        </div>
      </div>
      {showSkipForm && (
        <div className="mt-3 flex items-center gap-2">
          <Input
            placeholder="Why skip?"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              onSkip(skipReason.trim() || 'no reason given');
              setShowSkipForm(false);
              setSkipReason('');
            }}
            disabled={busy}
          >
            Skip
          </Button>
        </div>
      )}
    </Card>
  );
}

function DoneRow({ item }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        {item.status === 'done' ? (
          <CheckCircle2 size={14} className="text-success" />
        ) : (
          <SkipForward size={14} className="text-muted-foreground" />
        )}
        <span className="text-sm text-foreground">{item.title}</span>
        <SourceBadge source={item.source} />
      </div>
      {item.notes && (
        <p className="mt-1 text-xs text-muted-foreground italic">"{item.notes}"</p>
      )}
      {item.skipped_reason && (
        <p className="mt-1 text-xs text-muted-foreground">
          Skipped: {item.skipped_reason}
        </p>
      )}
    </div>
  );
}
