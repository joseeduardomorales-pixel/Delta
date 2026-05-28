// /admin/campaigns — CRUD for shop-wide campaigns.
//
// A campaign is a directive like "Brake & tire inspection on all trucks
// this week". When it goes active, the server materializes one
// campaign_assignments row per matching asset. As techs open WOs and
// add campaign items, assignments are completed.
//
// Filter shapes accepted by the API:
//   { "all": true }
//   { "type": "truck" | "trailer" | "reefer" }
//   { "unit_numbers": ["CC01","CC02"] }

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Megaphone,
  Trash2,
  Loader2,
  Inbox,
  Pencil,
  Play,
  CheckCircle2,
  X,
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
  Select,
  Modal,
  ModalActions,
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

function StatusPill({ status }) {
  const map = {
    draft: 'neutral',
    active: 'success',
    closed: 'neutral',
  };
  return <Badge tone={map[status] || 'neutral'}>{status}</Badge>;
}

function describeFilter(f) {
  if (!f || Object.keys(f).length === 0) return 'no filter';
  if (f.all) return 'all active assets';
  if (f.type) return `all ${f.type}s`;
  if (Array.isArray(f.unit_numbers)) {
    return `units: ${f.unit_numbers.join(', ')}`;
  }
  return JSON.stringify(f);
}

// ---- New / Edit modal ----------------------------------------------------
function CampaignForm({ open, onClose, onSubmit, busy, initial }) {
  const editing = Boolean(initial?.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'type' | 'units'
  const [filterType, setFilterType] = useState('truck');
  const [unitNumbers, setUnitNumbers] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [activate, setActivate] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name || '');
      setDescription(initial.description || '');
      const f = initial.asset_filter || {};
      if (f.all) setFilterMode('all');
      else if (f.type) {
        setFilterMode('type');
        setFilterType(f.type);
      } else if (Array.isArray(f.unit_numbers)) {
        setFilterMode('units');
        setUnitNumbers(f.unit_numbers.join(', '));
      } else setFilterMode('all');
      setStartsAt(initial.starts_at?.slice(0, 10) || '');
      setEndsAt(initial.ends_at?.slice(0, 10) || '');
      setActivate(initial.status === 'active');
    } else {
      setName('');
      setDescription('');
      setFilterMode('all');
      setFilterType('truck');
      setUnitNumbers('');
      setStartsAt('');
      setEndsAt('');
      setActivate(true);
    }
    setErr(null);
  }, [open, initial]);

  function buildFilter() {
    if (filterMode === 'all') return { all: true };
    if (filterMode === 'type') return { type: filterType };
    if (filterMode === 'units') {
      const list = unitNumbers
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      return { unit_numbers: list };
    }
    return { all: true };
  }

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr('Name is required.');
    const filter = buildFilter();
    if (filterMode === 'units' && filter.unit_numbers.length === 0) {
      return setErr('Add at least one unit number.');
    }
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        asset_filter: filter,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        activate: editing ? undefined : activate,
        // For edit, pass status as a separate field if user wants to activate now.
        status: editing && activate && initial?.status !== 'active' ? 'active' : undefined,
      });
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit campaign' : 'New campaign'}
      description={
        editing
          ? 'Update the campaign. Activating it materializes assignments for any newly-matching assets.'
          : 'Create a shop-wide directive. When you activate it, one assignment is created per matching asset.'
      }
      maxWidth="lg"
      footer={
        <ModalActions onCancel={onClose}>
          <Button
            onClick={submit}
            loading={busy}
            disabled={busy || !name.trim()}
          >
            {editing ? 'Save' : 'Create'}
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Brake & tire inspection week"
          autoFocus
        />
        <Textarea
          label="Description"
          optional
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What the tech should check / do."
        />

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            Which assets?
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={
                'rounded-lg border px-3 py-2 text-sm transition-colors ' +
                (filterMode === 'all'
                  ? 'border-accent/60 bg-accent/10 text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground')
              }
            >
              All active
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('type')}
              className={
                'rounded-lg border px-3 py-2 text-sm transition-colors ' +
                (filterMode === 'type'
                  ? 'border-accent/60 bg-accent/10 text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground')
              }
            >
              By type
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('units')}
              className={
                'rounded-lg border px-3 py-2 text-sm transition-colors ' +
                (filterMode === 'units'
                  ? 'border-accent/60 bg-accent/10 text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground')
              }
            >
              Specific units
            </button>
          </div>
          {filterMode === 'type' && (
            <div className="mt-2">
              <Select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="truck">Trucks</option>
                <option value="trailer">Trailers</option>
                <option value="reefer">Reefers</option>
              </Select>
            </div>
          )}
          {filterMode === 'units' && (
            <div className="mt-2">
              <Input
                placeholder="CC01, CC02, BF1701"
                value={unitNumbers}
                onChange={(e) => setUnitNumbers(e.target.value.toUpperCase())}
                helper="Comma or space separated. Case-insensitive."
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Starts on"
            type="date"
            optional
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          <Input
            label="Ends on"
            type="date"
            optional
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activate}
            onChange={(e) => setActivate(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span>
            {editing ? 'Make sure it\'s active (materialize new assignments)' : 'Activate immediately'}
          </span>
        </label>

        {err && (
          <Banner tone="danger" title="Can't save">
            {err}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

// ---- Per-card row --------------------------------------------------------
function CampaignCard({ c, onEdit, onDelete, onActivate, onClose, busy }) {
  const p = c.progress || { open: 0, completed: 0, skipped: 0 };
  const total = p.open + p.completed + p.skipped;
  const pct = total ? Math.round((p.completed / total) * 100) : 0;

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground leading-snug">
            {c.name}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Created {relativeTime(c.created_at)}
            <span className="mx-1.5">·</span>
            {describeFilter(c.asset_filter)}
          </p>
        </div>
        <StatusPill status={c.status} />
      </div>

      {c.description && (
        <p className="text-sm text-foreground/85 leading-relaxed mb-3">
          {c.description}
        </p>
      )}

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>
              {p.completed} done · {p.open} open · {p.skipped} skipped
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-success transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-end">
        {c.status === 'draft' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onActivate(c)}
            disabled={busy}
          >
            <Play size={14} />
            Activate
          </Button>
        )}
        {c.status === 'active' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onClose(c)}
            disabled={busy}
          >
            <CheckCircle2 size={14} />
            Close
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onEdit(c)} disabled={busy}>
          <Pencil size={14} />
          Edit
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onDelete(c)}
          disabled={busy}
        >
          <Trash2 size={14} />
          Delete
        </Button>
      </div>
    </Card>
  );
}

// ---- Page ----------------------------------------------------------------
export default function Campaigns() {
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} for new | campaign obj for edit
  const [formBusy, setFormBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/admin/campaigns`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRows(data.campaigns || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitForm(payload) {
    setFormBusy(true);
    try {
      const editing_ = editing && editing.id;
      const url = editing_
        ? `${API_URL}/api/admin/campaigns/${editing.id}`
        : `${API_URL}/api/admin/campaigns`;
      const method = editing_ ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: editing_ ? 'Campaign updated' : 'Campaign created',
        text: data.materialize
          ? `${data.materialize.matched} assets matched · ${data.materialize.created} assignments created`
          : data.campaign.name,
      });
      setEditing(null);
      await load();
    } catch (e) {
      throw e;
    } finally {
      setFormBusy(false);
    }
  }

  async function activate(c) {
    setBusyId(c.id);
    try {
      const r = await fetch(`${API_URL}/api/admin/campaigns/${c.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status: 'active' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: 'Activated',
        text: data.materialize
          ? `${data.materialize.matched} matched · ${data.materialize.created} created`
          : c.name,
      });
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Activate failed', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function closeCampaign(c) {
    setBusyId(c.id);
    try {
      const r = await fetch(`${API_URL}/api/admin/campaigns/${c.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status: 'closed' }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pushToast({ tone: 'info', title: 'Closed', text: c.name });
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Close failed', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(c) {
    setBusyId(c.id);
    try {
      const r = await fetch(`${API_URL}/api/admin/campaigns/${c.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pushToast({ tone: 'warning', title: 'Deleted', text: c.name });
      setConfirmDelete(null);
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Delete failed', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={rows ? `Campaigns · ${rows.length}` : 'Campaigns'}
        sticky
      />
      <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="mb-6"
        >
          <SectionLabel tone="accent">
            <span className="inline-flex items-center gap-1.5">
              <Megaphone size={12} /> Campaigns
            </span>
          </SectionLabel>
          <div className="mt-4 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-display text-3xl md:text-4xl tracking-tight leading-tight">
                Shop <span className="text-gradient">campaigns</span>
              </h1>
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
                Push the same task across a fleet slice. When you activate
                a campaign, an assignment is created for every matching
                asset. Techs see it when they open a WO on the asset.
              </p>
            </div>
            <Button onClick={() => setEditing({})}>
              <Plus size={16} />
              New campaign
            </Button>
          </div>
        </motion.div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        )}

        {err && (
          <Banner tone="danger" title="Couldn't load campaigns">
            {err}
          </Banner>
        )}

        {!loading && !err && rows && rows.length === 0 && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-bg text-accent">
              <Inbox size={22} />
            </div>
            <p className="font-display text-2xl tracking-tight">No campaigns yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one to push a directive across a fleet slice.
            </p>
          </Card>
        )}

        {!loading && rows && rows.length > 0 && (
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {rows.map((c) => (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.35, ease: easeOut }}
                >
                  <CampaignCard
                    c={c}
                    busy={busyId === c.id}
                    onEdit={(c) => setEditing(c)}
                    onActivate={activate}
                    onClose={closeCampaign}
                    onDelete={(c) => setConfirmDelete(c)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <CampaignForm
        open={Boolean(editing)}
        initial={editing && editing.id ? editing : null}
        onClose={() => setEditing(null)}
        onSubmit={submitForm}
        busy={formBusy}
      />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        destructive
        title="Delete campaign?"
        description={`"${confirmDelete?.name}" — assignments will be removed too.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={Boolean(busyId)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => doDelete(confirmDelete)}
              loading={Boolean(busyId)}
            >
              <X size={14} /> Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
