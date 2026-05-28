// /work-orders/:woId/inspect/:inspectionId — checklist walker.
//
// Loads an inspection (created via /api/work-orders/:woId/inspections),
// renders it grouped by section, lets the tech tap PASS / FAIL / N/A for
// each item. Failures get a comment field + photo. At the bottom: the
// three FINAL ASSESSMENT yes/no questions + a submit button that signs
// the inspection.

import { useEffect, useState, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
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

const easeOut = [0.16, 1, 0.3, 1];

// ── One row per inspection item ─────────────────────────────────────────────
function ItemRow({ item, onResult, busy }) {
  const tpl = item.template_item || {};
  const isYesNo = tpl.kind === 'yes_no';
  const isMeasurement = tpl.kind === 'measurement';
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(item.notes || '');
  const [measurement, setMeasurement] = useState(item.measurement_value ?? '');

  const result = item.inspection_result;
  // Visual state mapping.
  const failed = isYesNo
    ? tpl.good_answer && result && result !== tpl.good_answer
    : result === 'fail';
  const passed = isYesNo
    ? tpl.good_answer && result === tpl.good_answer
    : result === 'pass';
  const skipped = result === 'na';

  async function submit(value) {
    const payload = { inspection_result: value };
    if (notes.trim()) payload.notes = notes.trim();
    if (isMeasurement && measurement !== '') {
      const n = Number(measurement);
      if (Number.isFinite(n)) payload.measurement_value = n;
    }
    await onResult(item.id, payload);
    setOpen(false);
  }

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5 transition-colors',
        passed && 'border-success/40 bg-success-bg/40',
        failed && 'border-danger/40 bg-danger-bg/40',
        skipped && 'border-border bg-muted/30 opacity-70',
        !result && 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-snug">{item.title}</p>
          {tpl.measurement_unit && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Measurement: {tpl.measurement_unit}
              {tpl.measurement_min != null && ` · min ${tpl.measurement_min}`}
              {tpl.measurement_max != null && ` · max ${tpl.measurement_max}`}
            </p>
          )}
          {item.notes && (
            <p className="text-xs text-muted-foreground italic mt-1">
              "{item.notes}"
            </p>
          )}
          {item.measurement_value != null && (
            <p className="text-xs text-foreground mt-1">
              Value: {item.measurement_value}
              {tpl.measurement_unit ? ` ${tpl.measurement_unit}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isYesNo ? (
            <>
              <ResultButton
                tone="success"
                active={result === 'yes'}
                onClick={() => onResult(item.id, { inspection_result: 'yes' })}
                disabled={busy}
              >
                YES
              </ResultButton>
              <ResultButton
                tone="danger"
                active={result === 'no'}
                onClick={() => setOpen(true)}
                disabled={busy}
              >
                NO
              </ResultButton>
            </>
          ) : (
            <>
              <ResultButton
                tone="success"
                active={passed}
                onClick={() => onResult(item.id, { inspection_result: 'pass' })}
                disabled={busy}
                title="Pass"
              >
                <Check size={16} />
              </ResultButton>
              <ResultButton
                tone="danger"
                active={failed}
                onClick={() => setOpen(true)}
                disabled={busy}
                title="Fail"
              >
                <X size={16} />
              </ResultButton>
              <ResultButton
                tone="neutral"
                active={skipped}
                onClick={() => onResult(item.id, { inspection_result: 'na' })}
                disabled={busy}
                title="N/A"
              >
                <Minus size={16} />
              </ResultButton>
            </>
          )}
        </div>
      </div>

      {/* Fail modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Fail — ${item.title}`}
        description="Capture what's wrong. This will be the body of an auto-created issue on the asset."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => submit(isYesNo ? 'no' : 'fail')}
              loading={busy}
            >
              Record fail
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {isMeasurement && (
            <Input
              label={`Measured value (${tpl.measurement_unit || ''})`}
              type="number"
              value={measurement}
              onChange={(e) => setMeasurement(e.target.value)}
            />
          )}
          <Textarea
            label="What's wrong?"
            placeholder="e.g. crack on right corner, display flickers, missing bracket"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}

function ResultButton({ tone, active, onClick, disabled, children, title }) {
  const toneClasses = {
    success: active
      ? 'bg-success text-white border-success'
      : 'border-border text-success hover:bg-success-bg',
    danger: active
      ? 'bg-danger text-white border-danger'
      : 'border-border text-danger hover:bg-danger-bg',
    neutral: active
      ? 'bg-muted-foreground text-background border-muted-foreground'
      : 'border-border text-muted-foreground hover:bg-muted',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1',
        'min-w-[2.5rem] h-9 px-2 rounded-md border text-xs font-semibold',
        'transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        toneClasses[tone],
      )}
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

  async function onResult(itemId, payload) {
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
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const resp = await r.json();
      if (resp.created_issue) {
        pushToast({
          tone: 'warning',
          title: 'Issue created from fail',
          text: `ISS-${resp.created_issue.short_id} on this asset.`,
        });
      }
      // Patch the local state with the updated item.
      setData((d) => {
        if (!d) return d;
        const next = { ...d, sections: d.sections.map((s) => ({
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
        })) };
        return next;
      });
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Save failed', text: e.message });
    } finally {
      setBusyItemId(null);
    }
  }

  // Progress + counts
  const counts = useMemo(() => {
    if (!data) return { total: 0, done: 0, pass: 0, fail: 0, na: 0 };
    let total = 0, done = 0, pass = 0, fail = 0, na = 0;
    for (const s of data.sections) {
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
        text: `${resp.counts?.pass || 0} pass · ${(resp.counts?.fail || 0) + (resp.counts?.no || 0)} fail · ${resp.counts?.na || 0} N/A`,
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
          {/* "/work-orders/:woId" isn't a route — back-link to the asset
              kardex (where the WO + its inspection both surface). */}
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
              Back to{' '}
              {data?.inspection?.work_order?.asset_unit_number || 'work orders'}
            </span>
          </Link>
          <h1 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">
            {data?.inspection?.template?.name || 'Inspection'}
          </h1>
          {data?.inspection?.work_order && (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{data.inspection.work_order.asset_unit_number}</span>
              <span className="mx-2">·</span>
              <span className="font-mono">WO-{woId.slice(0, 8)}</span>
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
            <div className="sticky top-14 md:top-16 -mx-4 md:mx-0 px-4 md:px-0 py-3 mb-4 z-30 bg-background/95 backdrop-blur border-b border-border md:border md:rounded-xl md:bg-card md:shadow-sm md:p-4">
              <div className="flex items-center justify-between text-xs mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span>
                    <span className="font-semibold">{counts.done}</span>/{counts.total} done
                  </span>
                  <span className="text-success">{counts.pass} pass</span>
                  <span className="text-danger">{counts.fail} fail</span>
                  <span className="text-muted-foreground">{counts.na} N/A</span>
                </div>
                <span className="text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    counts.fail > 0 ? 'bg-warning' : 'bg-success',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-6">
              {data.sections.map((sec) => (
                <section key={sec.section}>
                  <SectionLabel tone="accent">{sec.section}</SectionLabel>
                  <div className="mt-3 space-y-2">
                    {sec.items.map((it) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        onResult={onResult}
                        busy={busyItemId === it.id}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Footer — finalize */}
            <div className="mt-8 mb-12">
              <Card className="p-5">
                {isCompleted ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-success" />
                    Inspection completed{' '}
                    {new Date(data.inspection.completed_at).toLocaleString()}
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <h2 className="font-display text-xl">Sign & submit</h2>
                      {counts.fail > 0 && (
                        <Badge tone="warning">
                          {counts.fail} fail{counts.fail === 1 ? '' : 's'} → {counts.fail} new issue{counts.fail === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Tapping submit records your signature with a timestamp.
                      Any failed items have already been logged as open issues on{' '}
                      <span className="font-mono">{data.inspection.work_order?.asset_unit_number}</span>.
                    </p>
                    {!allDone && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-warning">
                        <AlertTriangle size={14} />
                        {counts.total - counts.done} item{counts.total - counts.done === 1 ? '' : 's'} still pending.
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
    </div>
  );
}
