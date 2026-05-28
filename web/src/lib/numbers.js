// Human-readable IDs.
//
// Schema 0007 added:
//   users.handle              4-digit per-user handle starting at 1000
//   work_orders.display_seq   per-user-1-up sequence
//   issues.display_seq        per-reporter-1-up sequence
//   work_order_inspections.display_seq   per-starter-1-up sequence
//
// Render format: `<prefix>-<handle>-<seq-4>` e.g. WO-1001-0042.
// `handle` and `display_seq` come back from the API alongside the row.

function pad4(n) {
  return String(n).padStart(4, '0');
}

export function formatWo({ handle, display_seq } = {}) {
  if (handle == null || display_seq == null) return null;
  return `WO-${handle}-${pad4(display_seq)}`;
}

export function formatIssue({ handle, display_seq } = {}) {
  if (handle == null || display_seq == null) return null;
  return `ISS-${handle}-${pad4(display_seq)}`;
}

export function formatInspection({ handle, display_seq } = {}) {
  if (handle == null || display_seq == null) return null;
  return `INS-${handle}-${pad4(display_seq)}`;
}

// Fallback to the old 8-char hex short-id if we don't have the new pair
// (e.g. row created before the migration, joined data missing).
export function woLabel(wo, opts) {
  const human = formatWo({
    handle: opts?.handle ?? wo?.user?.handle,
    display_seq: wo?.display_seq,
  });
  return human || (wo?.id ? `WO-${wo.id.slice(0, 8)}` : 'WO-?');
}

export function issueLabel(issue) {
  const human = formatIssue({
    handle: issue?.reporter?.handle,
    display_seq: issue?.display_seq,
  });
  return human || (issue?.id ? `ISS-${issue.id.slice(0, 8)}` : 'ISS-?');
}

export function inspectionLabel(insp) {
  const human = formatInspection({
    handle: insp?.started_by_user?.handle,
    display_seq: insp?.display_seq,
  });
  return human || (insp?.id ? `INS-${insp.id.slice(0, 8)}` : 'INS-?');
}
