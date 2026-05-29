// Start Inspection trigger — opens a picker modal that lists active
// templates matching the asset's scope. Mirrors ReportIssueButton's
// shape so the two sit nicely together in the asset header.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Gauge, Loader2 } from 'lucide-react';
import { Button, Modal, Banner, useToast } from './ui/index.js';
import { cn } from '../lib/cn.js';
import { API_URL } from '../lib/supabase.js';

// Which template scopes apply to a given asset.type. A reefer is also a
// trailer, so reefer assets see reefer/reefer_trailer/trailer/any.
function scopesForAssetType(assetType) {
  if (assetType === 'truck') return new Set(['truck', 'any']);
  if (assetType === 'reefer')
    return new Set(['reefer', 'reefer_trailer', 'trailer', 'any']);
  if (assetType === 'trailer') return new Set(['trailer', 'any']);
  return new Set(['any']);
}

export default function StartInspectionButton({
  asset, // { unit_number, type, ... } — required to filter scope
  accessToken,
  variant = 'compact', // 'compact' | 'pill'
  onStarted,
  className,
}) {
  const [open, setOpen] = useState(false);

  if (!asset) return null; // need asset.type to scope the picker

  return (
    <>
      <Button
        variant={variant === 'compact' ? 'secondary' : 'primary'}
        size={variant === 'compact' ? 'sm' : 'md'}
        onClick={() => setOpen(true)}
        className={className}
      >
        <ClipboardCheck size={variant === 'compact' ? 14 : 16} />
        Start inspection
      </Button>
      <StartInspectionModal
        open={open}
        onClose={() => setOpen(false)}
        asset={asset}
        accessToken={accessToken}
        onStarted={onStarted}
      />
    </>
  );
}

function StartInspectionModal({ open, onClose, asset, accessToken, onStarted }) {
  const navigate = useNavigate();
  const { push: pushToast } = useToast();
  const [templates, setTemplates] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [needsMeter, setNeedsMeter] = useState(null); // { template_id, meter_unit, last_known }
  const [meterValue, setMeterValue] = useState('');

  // Fetch templates on open and filter to ones whose scope matches this asset.
  useEffect(() => {
    if (!open) return;
    setTemplates(null);
    setErr(null);
    setNeedsMeter(null);
    setMeterValue('');
    fetch(`${API_URL}/api/inspection-templates`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        const allowed = scopesForAssetType(asset.type);
        const matching = (d.templates || []).filter((t) => allowed.has(t.scope));
        setTemplates(matching);
      })
      .catch((e) => setErr(e.message || `HTTP ${e.status}`));
  }, [open, asset.type, accessToken]);

  async function start(templateId, manualMeter = null) {
    setBusyId(templateId);
    try {
      const body = {
        asset_unit_number: asset.unit_number,
        template_id: templateId,
      };
      if (manualMeter != null) body.manual_meter_value = Number(manualMeter);
      const r = await fetch(`${API_URL}/api/inspections/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      // Meter prompt — server says it needs an opening reading.
      if (r.ok && data.needs_meter) {
        setNeedsMeter({ template_id: templateId, ...data });
        return;
      }
      // Already started — server returned the existing inspection URL.
      if (r.status === 409 && data.url) {
        pushToast({
          tone: 'info',
          title: 'Continuing existing inspection',
        });
        onStarted?.();
        navigate(data.url);
        onClose();
        return;
      }
      if (!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);

      pushToast({
        tone: 'success',
        title: 'Inspection started',
        text: `${data.template_name} on ${asset.unit_number}`,
      });
      onStarted?.();
      navigate(data.url);
      onClose();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Couldn’t start', text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (busyId ? null : onClose())}
      title={needsMeter ? 'Enter opening meter' : 'Start inspection'}
      description={
        needsMeter
          ? null
          : `Pick a template for ${asset.unit_number}.`
      }
    >
      {/* Meter prompt view */}
      {needsMeter && (
        <div className="space-y-4">
          <p className="text-sm text-foreground/85">
            We need an opening{' '}
            <span className="font-medium">
              {needsMeter.meter_unit === 'miles' ? 'odometer' : 'hour meter'}
            </span>{' '}
            reading before starting this inspection.
          </p>
          {needsMeter.last_known && (
            <p className="text-xs text-muted-foreground">
              Last reading:{' '}
              {Number(needsMeter.last_known.value).toLocaleString()}{' '}
              {needsMeter.last_known.unit === 'hours' ? 'hr' : 'mi'}
              {needsMeter.last_known.recorded_human && (
                <> · {needsMeter.last_known.recorded_human}</>
              )}
            </p>
          )}
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            value={meterValue}
            onChange={(e) => setMeterValue(e.target.value)}
            placeholder={
              needsMeter.meter_unit === 'miles' ? 'Miles' : 'Hours'
            }
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
              disabled={busyId !== null}
            >
              Back
            </Button>
            <Button
              variant="primary"
              onClick={() => start(needsMeter.template_id, meterValue.trim() || '0')}
              disabled={busyId !== null || !meterValue.trim()}
            >
              <Gauge size={14} /> Start inspection
            </Button>
          </div>
        </div>
      )}

      {/* Picker view */}
      {!needsMeter && (
        <>
          {!templates && !err && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading templates…
            </div>
          )}
          {err && (
            <Banner tone="danger" title="Couldn't load templates">
              {err}
            </Banner>
          )}
          {templates && templates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No inspection templates available for this asset type.
            </p>
          )}
          {templates && templates.length > 0 && (
            <ul className="space-y-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => start(t.id)}
                    disabled={busyId !== null}
                    className={cn(
                      'w-full text-left rounded-lg border border-border bg-card px-4 py-3',
                      'hover:border-accent/40 transition-colors disabled:opacity-50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{t.name}</span>
                      {busyId === t.id && (
                        <Loader2 size={14} className="animate-spin" />
                      )}
                    </div>
                    {t.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {t.description}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={onClose} disabled={busyId !== null}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
