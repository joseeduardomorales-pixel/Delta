// /fleet — read-only directory of trucks, reefers, and drivers.
//
// Three tabs:
//   Trucks (17)    — click row → /assets/:unit kardex
//   Reefers (22)   — click row → /assets/:unit kardex
//   Drivers (45)   — read-only, no per-driver page yet
//
// Each asset row shows: unit, make/model/year, latest meter, and
// inline badges for "Inspection in progress" / "N open issues".
// Search filters within the active tab.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Truck,
  Snowflake,
  UserCircle2,
  Search,
  Loader2,
  Gauge,
  Clock,
  ChevronRight,
  ClipboardCheck,
  AlertCircle,
  Phone,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import {
  Header,
  Card,
  Badge,
  SectionLabel,
  Banner,
  Input,
} from '../components/ui/index.js';
import { cn } from '../lib/cn.js';

const easeOut = [0.16, 1, 0.3, 1];

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(ms / 60000);
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

const TABS = [
  { key: 'truck', label: 'Trucks', icon: Truck },
  { key: 'reefer', label: 'Reefers', icon: Snowflake },
  { key: 'driver', label: 'Drivers', icon: UserCircle2 },
];

function AssetRow({ a }) {
  const isReefer = a.type === 'reefer';
  const meter = a.latest_meter;
  const meterIcon = meter?.unit === 'hours' ? Clock : Gauge;
  const MeterIcon = meterIcon;
  return (
    <Link to={`/assets/${encodeURIComponent(a.unit_number)}`} className="block group">
      <Card interactive className="p-4 group-hover:border-accent/40">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="font-mono text-base font-semibold text-foreground">
                {a.unit_number}
              </h3>
              {!a.active && <Badge tone="neutral">inactive</Badge>}
              {a.active_inspection_count > 0 && (
                <Badge tone="warning">
                  <ClipboardCheck size={11} /> inspection in progress
                </Badge>
              )}
              {a.open_issue_count > 0 && (
                <Badge tone="danger">
                  <AlertCircle size={11} /> {a.open_issue_count} open issue
                  {a.open_issue_count === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground truncate">
              {[a.year, a.make, a.model].filter(Boolean).join(' ') || '—'}
              {a.vin && (
                <>
                  <span className="mx-2">·</span>
                  <span className="font-mono">VIN {a.vin.slice(-8)}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
            {meter && (
              <span className="inline-flex items-center gap-1">
                <MeterIcon size={12} />
                {meter.value.toLocaleString()}{' '}
                {meter.unit === 'hours' ? 'hr' : 'mi'}
                <span className="text-muted-foreground/70 ml-1">
                  {relTime(meter.recorded_at)}
                </span>
              </span>
            )}
            <ChevronRight size={14} className="text-muted-foreground" />
          </div>
        </div>
      </Card>
    </Link>
  );
}

function DriverRow({ d }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-foreground">
              {d.full_name}
            </h3>
            {!d.active && <Badge tone="neutral">inactive</Badge>}
          </div>
          <p className="mt-1 text-[11px] font-mono text-muted-foreground">
            Alvys {d.alvys_id}
          </p>
        </div>
        {d.phone && (
          <a
            href={`tel:${d.phone}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent whitespace-nowrap"
          >
            <Phone size={12} />
            <span className="font-mono">{d.phone}</span>
          </a>
        )}
      </div>
    </Card>
  );
}

export default function Fleet() {
  const { session, profile, signOut } = useAuth();
  const [tab, setTab] = useState('truck');
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const activeQs = showInactive ? '&active=all' : '';
      const [aRes, dRes] = await Promise.all([
        fetch(`${API_URL}/api/assets?${activeQs.slice(1)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${API_URL}/api/drivers?${activeQs.slice(1)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!aRes.ok) throw new Error(`assets HTTP ${aRes.status}`);
      if (!dRes.ok) throw new Error(`drivers HTTP ${dRes.status}`);
      const aJson = await aRes.json();
      const dJson = await dRes.json();
      setAssets(aJson.assets || []);
      setDrivers(dJson.drivers || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [session.access_token, showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  // Counts for tab badges
  const counts = useMemo(() => {
    const trucks = (assets || []).filter((a) => a.type === 'truck').length;
    const reefers = (assets || []).filter((a) => a.type === 'reefer').length;
    return { truck: trucks, reefer: reefers, driver: drivers?.length || 0 };
  }, [assets, drivers]);

  // Active tab rows after search.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === 'driver') {
      return (drivers || []).filter(
        (d) => !q || d.full_name.toLowerCase().includes(q) || (d.phone || '').includes(q),
      );
    }
    return (assets || [])
      .filter((a) => a.type === tab)
      .filter((a) => {
        if (!q) return true;
        return (
          a.unit_number.toLowerCase().includes(q) ||
          (a.make || '').toLowerCase().includes(q) ||
          (a.model || '').toLowerCase().includes(q)
        );
      });
  }, [tab, assets, drivers, search]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={
          assets && drivers
            ? `Fleet · ${counts.truck} trucks · ${counts.reefer} reefers · ${counts.driver} drivers`
            : 'Fleet'
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
          <SectionLabel tone="accent">Fleet</SectionLabel>
          <h1 className="mt-4 font-display text-3xl md:text-4xl tracking-tight leading-tight">
            <span className="text-gradient">Trucks</span>, reefers & drivers
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Browse the whole shop in one place. Tap any unit to see its
            kardex; the badges show what needs attention.
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="mb-4 flex items-center gap-1 border-b border-border overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative inline-flex items-center gap-1.5 px-4 py-2 text-sm transition-colors whitespace-nowrap',
                  tab === t.key
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon size={14} />
                {t.label}
                <span className="ml-1 text-[11px] text-muted-foreground/70 font-mono">
                  ({counts[t.key] ?? 0})
                </span>
                {tab === t.key && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Search + toggle */}
        <div className="mb-5 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === 'driver' ? 'Search drivers…' : 'Search by unit, make, model…'
              }
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Show inactive
          </label>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading…
          </div>
        )}
        {err && (
          <Banner tone="danger" title="Couldn't load the fleet">
            {err}
          </Banner>
        )}

        {!loading && !err && filteredRows.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No {tab === 'driver' ? 'drivers' : tab === 'reefer' ? 'reefers' : 'trucks'}
              {search ? ` match "${search}"` : ''}.
            </p>
          </Card>
        )}

        {!loading && filteredRows.length > 0 && (
          <div className="space-y-2.5">
            {tab === 'driver'
              ? filteredRows.map((d) => <DriverRow key={d.id} d={d} />)
              : filteredRows.map((a) => <AssetRow key={a.unit_number} a={a} />)}
          </div>
        )}
      </main>
    </div>
  );
}
