// /admin/pm-schedules — PM schedule CRUD + status overview.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Wrench,
  Loader2,
  Edit3,
  Trash2,
  AlertTriangle,
  Calendar,
  Gauge,
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
  Select,
  Modal,
  ModalActions,
  useToast,
} from '../../components/ui/index.js';
import { cn } from '../../lib/cn.js';

const easeOut = [0.16, 1, 0.3, 1];

const CADENCE_ICON = { miles: Gauge, hours: Clock, months: Calendar };

const STATUS_TONE = {
  ok: 'success',
  due_soon: 'warning',
  overdue: 'danger',
  unseeded: 'neutral',
  unknown: 'neutral',
};

const STATUS_LABEL = {
  ok: 'OK',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  unseeded: 'Not seeded',
  unknown: 'No meter data',
};

function summarizeCadence(s) {
  if (s.cadence_type === 'miles') return `Every ${s.interval_miles.toLocaleString()} mi`;
  if (s.cadence_type === 'hours') return `Every ${s.interval_hours.toLocaleString()} hr`;
  if (s.cadence_type === 'months')
    return `Every ${s.interval_months} month${s.interval_months === 1 ? '' : 's'}`;
  return '?';
}

function summarizeRemaining(s) {
  if (s.units_remaining == null) return null;
  const r = s.units_remaining;
  if (s.cadence_type === 'miles') {
    return r >= 0 ? `${r.toLocaleString()} mi to go` : `${(-r).toLocaleString()} mi past due`;
  }
  if (s.cadence_type === 'hours') {
    return r >= 0 ? `${r.toLocaleString()} hr to go` : `${(-r).toLocaleString()} hr past due`;
  }
  if (s.cadence_type === 'months') {
    return r >= 0 ? `${r} day${r === 1 ? '' : 's'} to go` : `${-r} days past due`;
  }
  return null;
}

// ─── Add / Edit modal ──────────────────────────────────────────────────────
const BLANK = {
  asset_unit_number: '',
  scope: 'truck',
  name: '',
  cadence_type: 'miles',
  interval_miles: '',
  interval_hours: '',
  interval_months: '',
  last_completed_at: '',
  last_completed_miles: '',
  last_completed_hours: '',
};

function ScheduleFormModal({ open, initial, onClose, onSave, busy, assets }) {
  const [form, setForm] = useState(BLANK);
  const [err, setErr] = useState(null);
  const isEdit = Boolean(initial?.id);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (initial) {
      setForm({
        asset_unit_number: initial.asset?.unit_number || '',
        scope: initial.scope,
        name: initial.name || '',
        cadence_type: initial.cadence_type,
        interval_miles: initial.interval_miles ?? '',
        interval_hours: initial.interval_hours ?? '',
        interval_months: initial.interval_months ?? '',
        last_completed_at: initial.last_completed_at?.slice(0, 10) ?? '',
        last_completed_miles: initial.last_completed_miles ?? '',
        last_completed_hours: initial.last_completed_hours ?? '',
      });
    } else {
      setForm(BLANK);
    }
  }, [open, initial]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit() {
    setErr(null);
    if (!form.asset_unit_number.trim()) return setErr('asset_required');
    if (!form.name.trim()) return setErr('name_required');
    const intervalKey =
      form.cadence_type === 'miles'
        ? 'interval_miles'
        : form.cadence_type === 'hours'
          ? 'interval_hours'
          : 'interval_months';
    if (!form[intervalKey] || Number(form[intervalKey]) <= 0) {
      return setErr('interval_required');
    }

    const payload = {
      asset_unit_number: form.asset_unit_number.trim().toUpperCase(),
      scope: form.scope,
      name: form.name.trim(),
      cadence_type: form.cadence_type,
      interval_miles:
        form.cadence_type === 'miles' ? Number(form.interval_miles) : null,
      interval_hours:
        form.cadence_type === 'hours' ? Number(form.interval_hours) : null,
      interval_months:
        form.cadence_type === 'months' ? Number(form.interval_months) : null,
      last_completed_at: form.last_completed_at || null,
      last_completed_miles: form.last_completed_miles
        ? Number(form.last_completed_miles)
        : null,
      last_completed_hours: form.last_completed_hours
        ? Number(form.last_completed_hours)
        : null,
    };

    try {
      await onSave(payload, initial?.id || null);
    } catch (e) {
      setErr(e.message);
    }
  }

  const intervalLabel =
    form.cadence_type === 'miles'
      ? 'Miles between services'
      : form.cadence_type === 'hours'
        ? 'Hours between services'
        : 'Months between services';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit PM schedule' : 'New PM schedule'}
      description={
        isEdit
          ? 'Adjust cadence, interval, or last-completed snapshot.'
          : 'Define how often this PM happens and (optionally) when it was last done.'
      }
      maxWidth="lg"
      footer={
        <ModalActions onCancel={onClose}>
          <Button onClick={submit} loading={busy}>
            {isEdit ? 'Save changes' : 'Create schedule'}
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Asset"
            placeholder="CC07 / T05 / BF1701"
            value={form.asset_unit_number}
            onChange={(e) => set('asset_unit_number', e.target.value.toUpperCase())}
            disabled={isEdit}
            helper={
              !isEdit && assets?.length > 0
                ? `${assets.length} assets available`
                : undefined
            }
          />
          <Select
            label="Scope"
            value={form.scope}
            onChange={(e) => set('scope', e.target.value)}
          >
            <option value="truck">Truck</option>
            <option value="trailer_body">Trailer body</option>
            <option value="reefer_unit">Reefer unit</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <Input
          label="Name"
          placeholder="Oil & filter, DOT inspection, Reefer 1500-hr…"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Cadence
          </label>
          <div className="grid grid-cols-3 gap-2">
            {['miles', 'hours', 'months'].map((c) => {
              const Icon = CADENCE_ICON[c];
              const selected = form.cadence_type === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('cadence_type', c)}
                  className={cn(
                    'min-h-tap rounded-lg border px-3 py-2 text-sm transition-all',
                    'inline-flex items-center justify-center gap-2',
                    selected
                      ? 'border-accent bg-accent-bg text-accent shadow-sm'
                      : 'border-border text-muted-foreground hover:border-accent/40 hover:text-foreground',
                  )}
                >
                  <Icon size={16} />
                  <span className="capitalize">{c}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Input
          label={intervalLabel}
          type="number"
          inputMode="numeric"
          min={1}
          value={
            form.cadence_type === 'miles'
              ? form.interval_miles
              : form.cadence_type === 'hours'
                ? form.interval_hours
                : form.interval_months
          }
          onChange={(e) => {
            const key =
              form.cadence_type === 'miles'
                ? 'interval_miles'
                : form.cadence_type === 'hours'
                  ? 'interval_hours'
                  : 'interval_months';
            set(key, e.target.value);
          }}
        />

        <details className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground select-none">
            Optional: last completed (so we know when the next one is due)
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Input
              label="Date"
              type="date"
              value={form.last_completed_at}
              onChange={(e) => set('last_completed_at', e.target.value)}
            />
            {form.cadence_type === 'miles' && (
              <Input
                label="At mileage"
                type="number"
                inputMode="numeric"
                value={form.last_completed_miles}
                onChange={(e) => set('last_completed_miles', e.target.value)}
              />
            )}
            {form.cadence_type === 'hours' && (
              <Input
                label="At hours"
                type="number"
                inputMode="numeric"
                value={form.last_completed_hours}
                onChange={(e) => set('last_completed_hours', e.target.value)}
              />
            )}
          </div>
        </details>

        {err && (
          <Banner tone="danger" title="Can't save">
            {err}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

// ─── Per-row card ─────────────────────────────────────────────────────────
function ScheduleRow({ s, onEdit, onDelete, busy }) {
  const Icon = CADENCE_ICON[s.cadence_type] || Wrench;
  const tone = STATUS_TONE[s.status] || 'neutral';
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-bg text-accent">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="font-display text-lg tracking-tight truncate">{s.name}</h3>
              <Badge tone={tone}>{STATUS_LABEL[s.status]}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{s.asset?.unit_number || '?'}</span>
              <span className="mx-1.5">·</span>
              <span className="capitalize">{s.scope.replace('_', ' ')}</span>
              <span className="mx-1.5">·</span>
              {summarizeCadence(s)}
            </p>
            {summarizeRemaining(s) && (
              <p
                className={cn(
                  'mt-2 text-sm',
                  s.status === 'overdue' ? 'text-danger' : 'text-foreground/80',
                )}
              >
                {summarizeRemaining(s)}
              </p>
            )}
            {s.status === 'unseeded' && (
              <p className="mt-2 text-[12px] text-muted-foreground italic">
                Add a "last completed" date or meter value to start the clock.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onEdit(s)} disabled={busy}>
            <Edit3 size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(s)} disabled={busy}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────
export default function PmSchedules() {
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const [rows, setRows] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // schedule or {} for add
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [pmRes, aRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/pm-schedules`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${API_URL}/api/assets`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!pmRes.ok) throw new Error(`pm-schedules ${pmRes.status}`);
      if (!aRes.ok) throw new Error(`assets ${aRes.status}`);
      const pm = await pmRes.json();
      const a = await aRes.json();
      setRows(pm.pm_schedules || []);
      setAssets(a.assets || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(payload, id) {
    setBusy(true);
    try {
      const url = id
        ? `${API_URL}/api/admin/pm-schedules/${id}`
        : `${API_URL}/api/admin/pm-schedules`;
      const method = id ? 'PATCH' : 'POST';
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
        title: id ? 'Schedule updated' : 'Schedule created',
        ttl: 2000,
      });
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function destroy(id) {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/pm-schedules/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok && r.status !== 204) {
        const body = await r.text();
        throw new Error(body || `HTTP ${r.status}`);
      }
      pushToast({ tone: 'warning', title: 'Schedule deleted', ttl: 2000 });
      setConfirmDelete(null);
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Delete failed', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = { ok: 0, due_soon: 0, overdue: 0, unseeded: 0, unknown: 0 };
    for (const r of rows || []) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={
          rows ? `PM schedules · ${rows.length}` : 'PM schedules'
        }
        sticky
      />
      <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="mb-6 flex items-end justify-between gap-4 flex-wrap"
        >
          <div>
            <SectionLabel tone="accent">
              Preventive Maintenance
            </SectionLabel>
            <h1 className="mt-4 font-display text-3xl md:text-4xl tracking-tight leading-tight">
              <span className="text-gradient">PM</span> schedules
            </h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Set up recurring maintenance per asset. Cadence is mileage,
              engine hours, or months. Status updates automatically as
              meters sync and time passes.
            </p>
          </div>
          <Button size="md" onClick={() => setEditing({})}>
            <Plus size={16} />
            Add schedule
          </Button>
        </motion.div>

        {rows && rows.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
            {counts.overdue > 0 && (
              <Badge tone="danger">
                <AlertTriangle size={11} /> {counts.overdue} overdue
              </Badge>
            )}
            {counts.due_soon > 0 && <Badge tone="warning">{counts.due_soon} due soon</Badge>}
            <Badge tone="success">{counts.ok} OK</Badge>
            {counts.unseeded > 0 && (
              <Badge tone="neutral">{counts.unseeded} unseeded</Badge>
            )}
            {counts.unknown > 0 && <Badge tone="neutral">{counts.unknown} no meter data</Badge>}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading schedules…
          </div>
        )}
        {err && (
          <Banner tone="danger" title="Couldn't load PM schedules">
            {err}
          </Banner>
        )}

        {!loading && !err && rows && rows.length === 0 && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-bg text-accent">
              <Wrench size={22} />
            </div>
            <p className="font-display text-2xl tracking-tight">
              No PM schedules yet.
            </p>
            <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
              Add the first one to start tracking when oil changes, DOT
              inspections, and reefer services are due.
            </p>
            <div className="mt-5">
              <Button onClick={() => setEditing({})}>
                <Plus size={16} />
                Add schedule
              </Button>
            </div>
          </Card>
        )}

        {!loading && rows && rows.length > 0 && (
          <div className="space-y-3">
            {rows
              .slice()
              .sort((a, b) => {
                // Sort: overdue > due_soon > unseeded > ok
                const order = { overdue: 0, due_soon: 1, unseeded: 2, unknown: 3, ok: 4 };
                return (order[a.status] ?? 5) - (order[b.status] ?? 5);
              })
              .map((s) => (
                <ScheduleRow
                  key={s.id}
                  s={s}
                  busy={busy}
                  onEdit={(sched) => setEditing(sched)}
                  onDelete={(sched) => setConfirmDelete(sched)}
                />
              ))}
          </div>
        )}
      </main>

      <ScheduleFormModal
        open={Boolean(editing)}
        initial={editing?.id ? editing : null}
        onClose={() => setEditing(null)}
        onSave={save}
        busy={busy}
        assets={assets}
      />

      <Modal
        open={Boolean(confirmDelete)}
        destructive
        onClose={() => setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.name || ''}"?`}
        description="The schedule is removed from rotation. Past work orders that referenced it stay intact."
        footer={
          <ModalActions onCancel={() => setConfirmDelete(null)}>
            <Button
              variant="danger"
              onClick={() => destroy(confirmDelete.id)}
              loading={busy}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </ModalActions>
        }
      />
    </div>
  );
}
