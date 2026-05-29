// /assets/:unit — per-asset kardex.
//
// Post-redesign layout:
//   1. Open issues   — pending problems anyone can act on
//   2. Active WOs    — work sessions in progress
//   3. Completed WOs — historical record, with approval status

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ImageOff,
  AlertCircle,
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  Gauge,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { Header, Card, Badge, SectionLabel, Banner, Button, Modal, useToast } from '../components/ui/index.js';
import { cn } from '../lib/cn.js';
import { woLabel, issueLabel, inspectionLabel } from '../lib/numbers.js';
import ReportIssueButton from '../components/ReportIssueButton.jsx';
import StartInspectionButton from '../components/StartInspectionButton.jsx';

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

function ApprovalPill({ status }) {
  const map = {
    pending_review: { tone: 'warning', label: 'pending review' },
    approved: { tone: 'success', label: 'approved' },
    rejected: { tone: 'danger', label: 'rejected' },
  };
  const { tone, label } = map[status] || { tone: 'neutral', label: status };
  return <Badge tone={tone}>{label}</Badge>;
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
  if (source === 'inspection_template') return <Badge tone="accent">inspection</Badge>;
  return <Badge tone="neutral">ad-hoc</Badge>;
}

// --- Issue row -------------------------------------------------------------

// raw_input gets auto-populated to "inspection_item:<uuid>" when an
// inspection failure is converted to an issue. That string was never
// meant for human eyes — strip anything matching that shape so the UI
// doesn't leak implementation detail.
const RAW_INPUT_NOISE_RE = /^inspection_item:[0-9a-f-]{36}$/i;
function visibleRawInput(raw) {
  if (!raw) return null;
  if (RAW_INPUT_NOISE_RE.test(raw.trim())) return null;
  return raw;
}

// "[Inspection fail] Air tank — drain valves functional" → title becomes
// "Air tank — drain valves functional" and we surface the source as a
// badge instead. Bracket prefixes look like build noise, not editorial.
const INSPECTION_FAIL_PREFIX_RE = /^\s*\[\s*inspection\s+fail\s*\]\s*/i;
function splitTitle(rawTitle) {
  if (!rawTitle) return { title: '', fromInspection: false };
  if (INSPECTION_FAIL_PREFIX_RE.test(rawTitle)) {
    return {
      title: rawTitle.replace(INSPECTION_FAIL_PREFIX_RE, ''),
      fromInspection: true,
    };
  }
  return { title: rawTitle, fromInspection: false };
}

// Top-right status pill — same tone vocabulary as the rest of the app.
function IssueStatusPill({ status }) {
  if (status === 'in_progress') return <Badge tone="accent">in progress</Badge>;
  if (status === 'resolved') return <Badge tone="success">resolved</Badge>;
  if (status === 'dismissed') return <Badge tone="neutral">dismissed</Badge>;
  if (status === 'acknowledged') return <Badge tone="warning">acknowledged</Badge>;
  return <Badge tone="warning">open</Badge>;
}

function IssueRow({
  issue,
  activeWoId,
  linkedWo, // { id, label } when issue is currently in_progress on a WO
  onAddToWo,
  onOpenWoFor,
  busy,
}) {
  const { title, fromInspection } = splitTitle(issue.title);
  const cleanRawInput = visibleRawInput(issue.raw_input);
  const isOpenLike = ['open', 'acknowledged'].includes(issue.status);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground leading-snug min-w-0">
          {title}
        </h3>
        <IssueStatusPill status={issue.status} />
      </div>
      <div className="mt-1 flex items-center flex-wrap gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{issueLabel(issue)}</span>
        <span>·</span>
        <span>{issue.reporter?.full_name || '?'}</span>
        <span>·</span>
        <span>{relativeTime(issue.reported_at)}</span>
        {fromInspection && (
          <>
            <span className="mx-0.5" aria-hidden>·</span>
            <Badge tone="accent">from inspection</Badge>
          </>
        )}
      </div>
      {issue.description && (
        <p className="mt-3 text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
          {issue.description}
        </p>
      )}
      {cleanRawInput && cleanRawInput !== issue.description && (
        <p className="mt-2 text-[12px] text-muted-foreground italic leading-relaxed">
          "{cleanRawInput}"
        </p>
      )}
      {/* Bottom-right anchor: action button OR "linked to WO" pointer. */}
      {isOpenLike && (
        <div className="mt-3 flex justify-end">
          {activeWoId ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAddToWo(issue)}
              disabled={busy}
            >
              <Wrench size={14} /> Add to WO
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenWoFor(issue)}
              disabled={busy}
            >
              <Wrench size={14} /> Open a WO to address this
            </Button>
          )}
        </div>
      )}
      {issue.status === 'in_progress' && linkedWo && (
        <div className="mt-3 flex justify-end">
          <Link
            to={`/work-orders/${linkedWo.id}`}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Linked to <span className="font-mono">{linkedWo.label}</span> →
          </Link>
        </div>
      )}
    </Card>
  );
}

// --- WO row (with items) ---------------------------------------------------
// Inspection items are intentionally NOT expanded here — they're already
// represented by the matching card in the "Inspections" section above.
// We collapse them into a compact summary line per inspection so the WO
// card doesn't repeat all 57 lines.
function WorkOrderRow({ wo }) {
  const meter = fmtMeter(wo.opening_meter);
  const allItems = wo.items || [];
  const regularItems = allItems.filter((it) => it.source !== 'inspection_template');
  const inspectionItems = allItems.filter((it) => it.source === 'inspection_template');

  // One summary row per distinct inspection_template_id on this WO.
  const byTemplate = new Map();
  for (const it of inspectionItems) {
    const key = it.inspection_template_id || 'unknown';
    const cur = byTemplate.get(key) || { total: 0, done: 0, fail: 0 };
    cur.total += 1;
    if (it.status === 'done') cur.done += 1;
    if (it.inspection_result === 'fail' || it.inspection_result === 'no') cur.fail += 1;
    byTemplate.set(key, cur);
  }

  // Tap anywhere on the card → WO detail page where the tech can add
  // items, mark done, close, etc.
  return (
    <Link to={`/work-orders/${wo.id}`} className="block">
      <Card interactive className="p-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-base font-semibold text-foreground leading-snug">
          <span className="font-mono">{woLabel(wo)}</span>
          {wo.summary ? <span className="text-foreground/75"> — {wo.summary}</span> : null}
        </h3>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {relativeTime(wo.started_at)}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
        <span>{wo.user?.full_name || '?'}</span>
        {meter && (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Gauge size={11} /> {meter}
            </span>
          </>
        )}
        <span>·</span>
        <span className="capitalize">{wo.status.replace('_', ' ')}</span>
      </div>

      {regularItems.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {regularItems.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-2 text-sm text-foreground/90"
            >
              <span className="mt-0.5">
                <ItemStatusIcon status={it.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{it.title}</span>
                  <SourceBadge source={it.source} />
                  <Badge tone="neutral">{it.type}</Badge>
                </div>
                {it.description && (
                  <p className="mt-0.5 text-xs text-foreground/75">{it.description}</p>
                )}
                {it.notes && (
                  <p className="mt-0.5 text-xs text-muted-foreground italic">
                    "{it.notes}"
                  </p>
                )}
                {it.skipped_reason && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    skipped: {it.skipped_reason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Inspection summary — one line per template referenced. */}
      {byTemplate.size > 0 && (
        <div className="mt-3 space-y-1.5">
          {[...byTemplate.entries()].map(([key, s]) => (
            <div
              key={key}
              className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
            >
              <SourceBadge source="inspection_template" />
              <span>
                {s.done}/{s.total} items done
                {s.fail > 0 && <span className="text-danger"> · {s.fail} fail</span>}
              </span>
              <span className="ml-auto text-foreground/60">see Inspections above</span>
            </div>
          ))}
        </div>
      )}

      {wo.action_photos?.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {wo.action_photos.map((p) =>
            p.url ? (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'shrink-0 h-20 w-20 rounded-lg overflow-hidden',
                  'border border-border hover:border-accent/40 transition-colors',
                )}
              >
                <img
                  src={p.url}
                  alt={p.caption || 'work order photo'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <div
                key={p.id}
                className="shrink-0 h-20 w-20 rounded-lg border border-border bg-muted flex items-center justify-center text-muted-foreground"
              >
                <ImageOff size={20} />
              </div>
            ),
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <ApprovalPill status={wo.approval_status} />
        {wo.approval_notes && (
          <span className="text-xs text-muted-foreground italic">
            "{wo.approval_notes}"
          </span>
        )}
      </div>
      </Card>
    </Link>
  );
}

// --- Inspection row --------------------------------------------------------
function InspectionRow({ insp }) {
  const completed = !!insp.completed_at;
  const tone = !completed ? 'warning' : insp.fail_count > 0 ? 'danger' : 'success';
  // The whole card becomes the tap target when in progress, so the tech
  // doesn't have to hit the small "Continue inspection →" text. (On touch
  // devices, hover-styled cards eat the first tap; putting the Link as
  // the root means the click registers on the first try.)
  const href = !completed
    ? `/work-orders/${insp.work_order_id}/inspect/${insp.id}`
    : null;
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground leading-snug">
          {insp.template?.name || 'Inspection'}
        </h3>
        <Badge tone={tone}>
          {!completed
            ? 'in progress'
            : insp.fail_count > 0
              ? `${insp.fail_count} fail`
              : 'all pass'}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{inspectionLabel(insp)}</span>
        <span className="mx-1.5">·</span>
        {insp.started_by_user?.full_name || '?'}
        <span className="mx-1.5">·</span>
        {relativeTime(insp.completed_at || insp.started_at)}
        {insp.pass_count + insp.fail_count > 0 && (
          <>
            <span className="mx-1.5">·</span>
            <span className="text-success">{insp.pass_count} pass</span>
            {insp.fail_count > 0 && (
              <>
                <span className="mx-1.5">·</span>
                <span className="text-danger">{insp.fail_count} fail</span>
              </>
            )}
          </>
        )}
      </p>
      {!completed && (
        <p className="mt-2 text-xs text-accent font-medium">
          Continue inspection →
        </p>
      )}
    </>
  );
  return href ? (
    <Link to={href} className="block">
      <Card interactive className="p-4">
        {inner}
      </Card>
    </Link>
  ) : (
    <Card className="p-4">{inner}</Card>
  );
}

function Section({ title, tone, count, icon: Icon, children }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <SectionLabel tone={tone}>
          <span className="inline-flex items-center gap-1.5">
            {Icon ? <Icon size={12} /> : null}
            {title}
          </span>
        </SectionLabel>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      {children}
    </section>
  );
}

export default function AssetHistory() {
  const { unit } = useParams();
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const navigate = useNavigate();
  const [asset, setAsset] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyAction, setBusyAction] = useState(false);
  const [confirmOpenWoFor, setConfirmOpenWoFor] = useState(null); // issue obj
  const [needsMeter, setNeedsMeter] = useState(null); // { issue, meter_unit, last_known }
  const [meterValue, setMeterValue] = useState('');

  // The "active WO" is one this user already opened on this asset and
  // hasn't closed. If multiple, we prefer the most recent.
  const activeWo = (data?.active_work_orders || []).find(
    (w) => w.user?.id === profile?.id,
  );

  // For in_progress issues, point to the WO they're currently being
  // worked on. Scan all active WOs' items for source='issue' + this
  // issue's id (the only items that DON'T link back are completed/
  // skipped, which we still want to show as linked for context).
  const issueToWoMap = (data?.active_work_orders || []).reduce((acc, wo) => {
    for (const it of wo.items || []) {
      if (it.source === 'issue' && it.source_issue_id) {
        acc[it.source_issue_id] = { id: wo.id, label: woLabel(wo) };
      }
    }
    return acc;
  }, {});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [aRes, wRes] = await Promise.all([
        fetch(`${API_URL}/api/assets/${encodeURIComponent(unit)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${API_URL}/api/assets/${encodeURIComponent(unit)}/work-orders`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!aRes.ok) throw new Error(`asset ${aRes.status}`);
      if (!wRes.ok) throw new Error(`work-orders ${wRes.status}`);
      const a = await aRes.json();
      const w = await wRes.json();
      setAsset(a.asset);
      setData(w);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [unit, session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  // Add the given issue as an item on the user's active WO (must exist).
  async function addIssueToActiveWo(issue) {
    if (!activeWo) return;
    setBusyAction(true);
    try {
      const r = await fetch(
        `${API_URL}/api/work-orders/${activeWo.id}/items`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            source: 'issue',
            source_id: issue.id,
            type: 'repair',
            title: issue.title,
            description: issue.description || null,
          }),
        },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: 'Added',
        text: `${issue.title} → ${activeWo.id.slice(0, 8)}`,
      });
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Add failed', text: e.message });
    } finally {
      setBusyAction(false);
    }
  }

  // Open a new WO on this asset (handles needs_meter prompt), then add
  // the issue as its first item.
  async function openWoForIssue(issue, manualMeter = null) {
    setBusyAction(true);
    try {
      const body = { asset_unit_number: unit };
      if (manualMeter != null) {
        body.manual_meter_value = Number(manualMeter);
      }
      const r = await fetch(`${API_URL}/api/work-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (r.status === 409 && data.error === 'needs_meter') {
        setNeedsMeter({ issue, ...data });
        setMeterValue('');
        return;
      }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // WO opened — now add the issue as item.
      const woId = data.work_order.id;
      const r2 = await fetch(`${API_URL}/api/work-orders/${woId}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          source: 'issue',
          source_id: issue.id,
          type: 'repair',
          title: issue.title,
          description: issue.description || null,
        }),
      });
      if (!r2.ok) {
        const body2 = await r2.json().catch(() => ({}));
        throw new Error(body2.error || `HTTP ${r2.status}`);
      }
      pushToast({
        tone: 'success',
        title: 'Work order opened',
        text: `Added "${issue.title}" as the first item.`,
      });
      setConfirmOpenWoFor(null);
      setNeedsMeter(null);
      navigate(`/work-orders/${woId}`);
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Couldn’t open WO', text: e.message });
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={asset ? `${asset.unit_number.toUpperCase()} · ${asset.type}` : unit.toUpperCase()}
        sticky
      />
      <main className="mx-auto max-w-4xl px-4 py-6 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="mb-8"
        >
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={14} />
            <span className="uppercase tracking-widest">Back to chat</span>
          </Link>
          <div className="flex items-start justify-between gap-3 flex-wrap mt-2">
            <div className="min-w-0">
              <h1 className="font-display text-3xl md:text-4xl tracking-tight leading-tight">
                {unit.toUpperCase()}
              </h1>
              {asset && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {asset.year} {asset.make} {asset.model}
                  {asset.vin && (
                    <>
                      <span className="mx-2">·</span>
                      <span className="font-mono text-[12px]">VIN {asset.vin}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StartInspectionButton
                asset={asset}
                accessToken={session.access_token}
                variant="compact"
                onStarted={() => load()}
              />
              <ReportIssueButton
                lockedAsset={unit.toUpperCase()}
                variant="compact"
                onSubmitted={() => load()}
              />
            </div>
          </div>
        </motion.div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {err && (
          <Banner tone="danger" title="Couldn't load asset history">
            {err}
          </Banner>
        )}

        {!loading && !err && data && (
          <>
            <Section
              title="Open issues"
              tone="warning"
              icon={AlertCircle}
              count={data.open_issues?.length || 0}
            >
              {!data.open_issues?.length ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <div className="space-y-3">
                  {data.open_issues.map((i) => (
                    <IssueRow
                      key={i.id}
                      issue={i}
                      activeWoId={activeWo?.id || null}
                      linkedWo={issueToWoMap[i.id] || null}
                      onAddToWo={addIssueToActiveWo}
                      onOpenWoFor={(issue) => setConfirmOpenWoFor(issue)}
                      busy={busyAction}
                    />
                  ))}
                </div>
              )}
            </Section>

            {data.inspections?.length > 0 && (
              <Section
                title="Inspections"
                tone="accent"
                icon={ClipboardCheck}
                count={data.inspections.length}
              >
                <div className="space-y-3">
                  {data.inspections.map((i) => (
                    <InspectionRow key={i.id} insp={i} />
                  ))}
                </div>
              </Section>
            )}

            <Section
              title="Active work orders"
              tone="accent"
              icon={Wrench}
              count={data.active_work_orders?.length || 0}
            >
              {!data.active_work_orders?.length ? (
                <p className="text-sm text-muted-foreground">None in progress.</p>
              ) : (
                <div className="space-y-3">
                  {data.active_work_orders.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Completed"
              tone="success"
              icon={CheckCircle2}
              count={data.completed_work_orders?.length || 0}
            >
              {!data.completed_work_orders?.length ? (
                <p className="text-sm text-muted-foreground">No completed WOs yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.completed_work_orders.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </div>
              )}
            </Section>

            {data.closed_issues?.length > 0 && (
              <Section
                title="Closed issues"
                tone="neutral"
                count={data.closed_issues.length}
              >
                <div className="space-y-3">
                  {data.closed_issues.map((i) => (
                    <IssueRow key={i.id} issue={i} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </main>

      {/* Confirm: open a brand-new WO for this issue */}
      <Modal
        open={!!confirmOpenWoFor && !needsMeter}
        onClose={() => (busyAction ? null : setConfirmOpenWoFor(null))}
        title="Open a work order?"
      >
        {confirmOpenWoFor && (
          <div className="space-y-4">
            <p className="text-sm text-foreground/85">
              You don't have an active WO on <span className="font-mono">{unit.toUpperCase()}</span>.
              Open a new one and add this issue as its first item?
            </p>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-sm font-semibold text-foreground">
                {confirmOpenWoFor.title}
              </p>
              {confirmOpenWoFor.description && (
                <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                  {confirmOpenWoFor.description}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmOpenWoFor(null)}
                disabled={busyAction}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => openWoForIssue(confirmOpenWoFor)}
                disabled={busyAction}
              >
                <Wrench size={14} /> Open WO
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Meter prompt — server told us it needs an opening reading */}
      <Modal
        open={!!needsMeter}
        onClose={() => (busyAction ? null : setNeedsMeter(null))}
        title="Enter opening meter"
      >
        {needsMeter && (
          <div className="space-y-4">
            <p className="text-sm text-foreground/85">
              We need an opening{' '}
              <span className="font-medium">
                {needsMeter.meter_unit === 'miles' ? 'odometer' : 'hour meter'}
              </span>{' '}
              reading before opening this WO.
            </p>
            {needsMeter.last_known && (
              <p className="text-xs text-muted-foreground">
                Last known: {Number(needsMeter.last_known.value).toLocaleString()}{' '}
                {needsMeter.last_known.unit === 'miles' ? 'mi' : 'hr'}
                {needsMeter.last_known.recorded_at && (
                  <> · {relativeTime(needsMeter.last_known.recorded_at)}</>
                )}
              </p>
            )}
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              value={meterValue}
              onChange={(e) => setMeterValue(e.target.value)}
              placeholder={needsMeter.meter_unit === 'miles' ? 'Miles' : 'Hours'}
              className={cn(
                'w-full h-12 px-3 rounded-md border border-border bg-background',
                'text-foreground font-mono text-lg',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setNeedsMeter(null)}
                disabled={busyAction}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  openWoForIssue(needsMeter.issue, meterValue.trim() || '0')
                }
                disabled={busyAction || !meterValue.trim()}
              >
                <Gauge size={14} /> Open WO
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
