// Resume banner for in-progress inspections owned by the current user.
// Renders nothing when there are none. Self-fetches on mount.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { API_URL } from '../lib/supabase.js';
import { inspectionLabel } from '../lib/numbers.js';
import { cn } from '../lib/cn.js';

export default function ResumeInspectionsBanner({ className }) {
  const { session } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/inspections/mine?open=1`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.inspections) setItems(data.inspections);
      })
      .catch(() => {
        // Silent — banner is non-critical.
      });
    return () => {
      alive = false;
    };
  }, [session.access_token]);

  if (!items.length) return null;

  return (
    <div
      className={cn(
        'border-b border-warning/30 bg-warning-bg/40',
        className,
      )}
    >
      <ul className="mx-auto max-w-6xl px-3 py-2 divide-y divide-warning/20">
        {items.map((i) => {
          const pct = i.total ? Math.round((i.done / i.total) * 100) : 0;
          // Synthesize the shape inspectionLabel() expects.
          const label = inspectionLabel({
            id: i.id,
            display_seq: i.display_seq,
            started_by_user: { handle: i.work_order?.user?.handle },
          });
          return (
            <li key={i.id} className="py-1.5">
              <Link
                to={`/work-orders/${i.work_order_id}/inspect/${i.id}`}
                className="flex items-center gap-3 text-sm hover:text-foreground"
              >
                <ClipboardCheck size={16} className="text-warning shrink-0" />
                <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-foreground">
                    {i.template?.name || 'Inspection'} in progress on{' '}
                    <span className="font-mono">
                      {i.work_order?.asset_unit_number || '?'}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i.done}/{i.total} done · {pct}%
                    {i.fail > 0 && (
                      <span className="ml-1.5 text-danger">
                        · {i.fail} issue{i.fail === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {label}
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-warning font-semibold whitespace-nowrap">
                  Resume <ArrowRight size={14} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
