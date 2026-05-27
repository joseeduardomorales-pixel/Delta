// /assets/:unit — per-asset work-order history (the kardex view).
// Splits into Pending review / Approved / Rejected sections.
// Photos render inline via short-lived signed URLs.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import clsx from 'clsx';

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

function StatusPill({ wo }) {
  const map = {
    open: 'text-matrix-amber border-matrix-amber/50',
    in_progress: 'text-matrix-amber border-matrix-amber/50',
    completed: 'text-matrix-green border-matrix-green-line',
    voided: 'text-matrix-fg-muted border-matrix-green-line line-through',
  };
  return (
    <span
      className={clsx(
        'inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-widest border rounded',
        map[wo.status] || map.completed,
      )}
    >
      {wo.status}
    </span>
  );
}

function WorkOrderRow({ wo }) {
  return (
    <li className="border border-matrix-green-line rounded-md p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm text-matrix-green tracking-tight">
          {wo.title || '(no title)'}
        </h3>
        <span className="text-[10px] text-matrix-fg-muted whitespace-nowrap">
          {relativeTime(wo.started_at)}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-matrix-fg-muted">
        WO-{wo.id.slice(0, 8)} · {wo.type} · {wo.user?.full_name || '?'}
      </p>
      {wo.description && (
        <p className="mt-2 text-xs text-matrix-fg whitespace-pre-wrap">
          {wo.description}
        </p>
      )}
      {wo.raw_input && wo.raw_input !== wo.description && (
        <p className="mt-2 text-[11px] text-matrix-fg-dim italic">
          "{wo.raw_input}"
        </p>
      )}
      {wo.action_photos?.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {wo.action_photos.map((p) =>
            p.url ? (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 w-20 h-20 rounded-md overflow-hidden border border-matrix-green-line"
              >
                <img
                  src={p.url}
                  alt={p.caption || 'work order photo'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </a>
            ) : null,
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <StatusPill wo={wo} />
        {wo.approval_status === 'rejected' && (
          <span className="text-[9px] uppercase tracking-widest text-matrix-red border border-matrix-red/50 rounded px-1.5 py-0.5">
            rejected
          </span>
        )}
      </div>
    </li>
  );
}

function Section({ title, count, color, children }) {
  return (
    <section className="mb-6">
      <h2
        className={clsx(
          'text-xs uppercase tracking-widest mb-2',
          color || 'text-matrix-fg-dim',
        )}
      >
        {title} <span className="text-matrix-fg-muted">({count})</span>
      </h2>
      {children}
    </section>
  );
}

export default function AssetHistory() {
  const { unit } = useParams();
  const { session, profile } = useAuth();
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
    <main className="min-h-screen bg-matrix-black text-matrix-fg font-mono">
      <header className="border-b border-matrix-green-line px-4 py-3 flex items-center justify-between">
        <div>
          <Link to="/" className="text-[10px] uppercase tracking-widest text-matrix-fg-dim hover:text-matrix-green">
            ← Chat
          </Link>
          <h1 className="text-xl text-matrix-green tracking-tight mt-1">
            {unit.toUpperCase()}
          </h1>
          {asset && (
            <p className="text-[11px] text-matrix-fg-muted">
              {asset.type} · {asset.year || ''} {asset.make || ''} {asset.model || ''}
              {asset.vin ? ` · VIN ${asset.vin}` : ''}
            </p>
          )}
        </div>
        <span className="text-[10px] text-matrix-fg-muted">
          {profile?.fullName}
        </span>
      </header>

      <div className="px-4 py-5 max-w-3xl mx-auto">
        {loading && <p className="text-sm text-matrix-fg-dim">Loading…</p>}
        {err && <p className="text-sm text-matrix-red">Error: {err}</p>}
        {!loading && !err && data && (
          <>
            <Section
              title="Pending review"
              count={data.pending.length}
              color="text-matrix-amber"
            >
              {data.pending.length === 0 ? (
                <p className="text-[11px] text-matrix-fg-muted">None.</p>
              ) : (
                <ul className="space-y-2">
                  {data.pending.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="Approved"
              count={data.approved.length}
              color="text-matrix-green"
            >
              {data.approved.length === 0 ? (
                <p className="text-[11px] text-matrix-fg-muted">None yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.approved.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </ul>
              )}
            </Section>

            {data.rejected.length > 0 && (
              <Section
                title="Rejected"
                count={data.rejected.length}
                color="text-matrix-red"
              >
                <ul className="space-y-2">
                  {data.rejected.map((w) => (
                    <WorkOrderRow key={w.id} wo={w} />
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
