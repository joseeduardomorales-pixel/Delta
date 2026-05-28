// /assets/:unit — per-asset kardex.
//
// Post-redesign layout:
//   1. Open issues   — pending problems anyone can act on
//   2. Active WOs    — work sessions in progress
//   3. Completed WOs — historical record, with approval status

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
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
import { Header, Card, Badge, SectionLabel, Banner } from '../components/ui/index.js';
import { cn } from '../lib/cn.js';
import { woLabel, issueLabel, inspectionLabel } from '../lib/numbers.js';
import ReportIssueButton from '../components/ReportIssueButton.jsx';

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
function IssueRow({ issue }) {
  return (
    <Card interactive className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground leading-snug">
          {issue.title}
        </h3>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {relativeTime(issue.reported_at)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{issueLabel(issue)}</span>
        <span className="mx-1.5">·</span>
        {issue.reporter?.full_name || '?'}
        <span className="mx-1.5">·</span>
        <span className="capitalize">{issue.status.replace('_', ' ')}</span>
      </p>
      {issue.description && (
        <p className="mt-3 text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
          {issue.description}
        </p>
      )}
      {issue.raw_input && issue.raw_input !== issue.description && (
        <p className="mt-2 text-[12px] text-muted-foreground italic leading-relaxed">
          "{issue.raw_input}"
        </p>
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

  return (
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
  );
}

// --- Inspection row --------------------------------------------------------
function InspectionRow({ insp }) {
  const completed = !!insp.completed_at;
  const tone = !completed ? 'warning' : insp.fail_count > 0 ? 'danger' : 'success';
  return (
    <Card interactive className="p-4">
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
        <p className="mt-2">
          <Link
            to={`/work-orders/${insp.work_order_id}/inspect/${insp.id}`}
            className="text-xs text-accent hover:underline"
          >
            Continue inspection →
          </Link>
        </p>
      )}
    </Card>
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
  const [asset, setAsset] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

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
            <ReportIssueButton
              lockedAsset={unit.toUpperCase()}
              variant="compact"
              onSubmitted={() => load()}
            />
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
                    <IssueRow key={i.id} issue={i} />
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
    </div>
  );
}
