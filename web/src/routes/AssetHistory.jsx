// /assets/:unit — per-asset work-order history (the kardex view).
// Mid-density v2 design: SectionLabels, Cards w/ hover lift, photo
// thumbnails inline, status pills.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ImageOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { Header, Card, Badge, SectionLabel, Banner } from '../components/ui/index.js';
import { cn } from '../lib/cn.js';
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

function StatusPill({ status }) {
  const map = {
    open: 'warning',
    in_progress: 'warning',
    completed: 'success',
    voided: 'neutral',
  };
  return <Badge tone={map[status] || 'neutral'}>{status.replace('_', ' ')}</Badge>;
}

function WorkOrderRow({ wo }) {
  return (
    <Card interactive className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground leading-snug">
          {wo.title || '(no title)'}
        </h3>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {relativeTime(wo.started_at)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        <span className="font-mono">WO-{wo.id.slice(0, 8)}</span>
        <span className="mx-1.5">·</span>
        {wo.type}
        <span className="mx-1.5">·</span>
        {wo.user?.full_name || '?'}
      </p>

      {wo.description && (
        <p className="mt-3 text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
          {wo.description}
        </p>
      )}
      {wo.raw_input && wo.raw_input !== wo.description && (
        <p className="mt-2 text-[12px] text-muted-foreground italic leading-relaxed">
          "{wo.raw_input}"
        </p>
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

      <div className="mt-3 flex items-center gap-2">
        <StatusPill status={wo.status} />
      </div>
    </Card>
  );
}

function Section({ title, tone, count, children }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <SectionLabel tone={tone}>{title}</SectionLabel>
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

  useEffect(() => {
    let alive = true;
    async function load() {
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
        if (!alive) return;
        setAsset(a.asset);
        setData(w);
      } catch (e) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [unit, session.access_token]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={asset ? `${asset.unit_number.toUpperCase()} · ${asset.type}` : unit.toUpperCase()}
        sticky
      />
      <main className="mx-auto max-w-4xl px-4 py-6 md:py-10">
        {/* Page title block */}
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
              onSubmitted={() => {
                // Refresh the list so the new pending issue shows up
                setData(null);
                setLoading(true);
                setErr(null);
                // Trigger the effect by changing the URL? — simpler: reload via fetch.
                // Easiest is to bounce loading state and let the effect re-run on session change.
                // For now: just push the user toward visible feedback.
                window.location.reload();
              }}
            />
          </div>
        </motion.div>

        {loading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {err && (
          <Banner tone="danger" title="Couldn't load asset history">
            {err}
          </Banner>
        )}

        {!loading && !err && data && (
          <>
            <Section
              title="Pending review"
              tone="warning"
              count={data.pending.length}
            >
              {data.pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <div className="space-y-3">
                  {data.pending.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Approved"
              tone="success"
              count={data.approved.length}
            >
              {data.approved.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.approved.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </div>
              )}
            </Section>

            {data.rejected.length > 0 && (
              <Section
                title="Rejected"
                tone="danger"
                count={data.rejected.length}
              >
                <div className="space-y-3">
                  {data.rejected.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
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
