// /work-orders — list view across all WOs visible to the caller.
//
// Default tab: Active (open + in_progress). Tabs for Completed and Voided.
// Admins see everyone's WOs; tech/dispatcher see their own.

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  Gauge,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import {
  Header,
  Card,
  Badge,
  SectionLabel,
  Banner,
} from '../components/ui/index.js';
import { cn } from '../lib/cn.js';

const easeOut = [0.16, 1, 0.3, 1];

const TABS = [
  { key: 'active', label: 'Active', status: 'open,in_progress', tone: 'accent' },
  { key: 'completed', label: 'Completed', status: 'completed', tone: 'success' },
  { key: 'voided', label: 'Voided', status: 'voided', tone: 'neutral' },
];

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

function StatusPill({ status }) {
  const map = {
    open: 'warning',
    in_progress: 'warning',
    completed: 'success',
    voided: 'neutral',
  };
  return <Badge tone={map[status] || 'neutral'}>{status.replace('_', ' ')}</Badge>;
}

function WoRow({ wo }) {
  const meter = fmtMeter(wo.opening_meter);
  return (
    <Link
      to={`/assets/${encodeURIComponent(wo.asset_unit_number)}`}
      className="block group"
    >
      <Card interactive className="p-4 group-hover:border-accent/40">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h3 className="text-base font-semibold text-foreground leading-snug">
            <span className="font-mono text-foreground/85">{wo.asset_unit_number}</span>
            {wo.summary && <span className="text-foreground/75"> — {wo.summary}</span>}
          </h3>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {relativeTime(wo.completed_at || wo.started_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="font-mono">WO-{wo.id.slice(0, 8)}</span>
          <span>·</span>
          <span>{wo.user?.full_name || '?'}</span>
          {meter && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Gauge size={11} /> {meter}
              </span>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <StatusPill status={wo.status} />
          <Badge tone="neutral">
            {wo.done_count}/{wo.item_count} done
          </Badge>
          {wo.fail_count > 0 && (
            <Badge tone="danger">{wo.fail_count} fail</Badge>
          )}
          {wo.approval_status === 'pending_review' && (
            <Badge tone="warning">pending review</Badge>
          )}
          <ChevronRight size={14} className="ml-auto text-muted-foreground" />
        </div>
      </Card>
    </Link>
  );
}

export default function WorkOrders() {
  const { session, profile, signOut } = useAuth();
  const [tab, setTab] = useState('active');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false); // admin-only "all WOs" toggle

  const isAdmin = profile?.role === 'admin';
  const status = TABS.find((t) => t.key === tab)?.status || 'open,in_progress';

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ status });
      // For non-admin we always see our own. For admin, default is all unless they untoggle.
      if (isAdmin && !showAll) params.set('mine', '1');
      const r = await fetch(`${API_URL}/api/work-orders?${params}`, {
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
  }, [status, session.access_token, isAdmin, showAll]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={
          rows ? `Work orders · ${rows.length}` : 'Work orders'
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
          <SectionLabel tone="accent">
            <span className="inline-flex items-center gap-1.5">
              <Wrench size={12} /> Work orders
            </span>
          </SectionLabel>
          <h1 className="mt-4 font-display text-3xl md:text-4xl tracking-tight leading-tight">
            Work <span className="text-gradient">orders</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
            {isAdmin
              ? 'All work order sessions across the shop. Tap any to see the kardex.'
              : 'Your work order sessions. Tap any to see the kardex on that asset.'}
          </p>
          {isAdmin && (
            <div className="mt-3">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              >
                {showAll ? 'Showing all — show only mine' : 'Showing mine — show all'}
              </button>
            </div>
          )}
        </motion.div>

        {/* Tabs */}
        <div className="mb-5 flex items-center gap-1 border-b border-border overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative px-4 py-2 text-sm transition-colors whitespace-nowrap',
                tab === t.key
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        )}
        {err && (
          <Banner tone="danger" title="Couldn't load work orders">
            {err}
          </Banner>
        )}

        {!loading && !err && rows && rows.length === 0 && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox size={22} />
            </div>
            <p className="font-display text-2xl tracking-tight">No {tab} work orders.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === 'active'
                ? 'Open a WO from the chat to get started.'
                : tab === 'completed'
                  ? 'Closed work orders will show here.'
                  : 'Voided work orders will show here.'}
            </p>
          </Card>
        )}

        {!loading && rows && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((wo) => (
              <WoRow key={wo.id} wo={wo} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
