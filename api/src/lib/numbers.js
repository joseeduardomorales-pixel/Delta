// Server-side mirror of web/src/lib/numbers.js so chat confirmations,
// Claude tool replies, and audit logs can produce the same WO-1001-0042
// format the UI shows.

function pad4(n) {
  return String(n).padStart(4, '0');
}

export function formatWo(handle, display_seq) {
  if (handle == null || display_seq == null) return null;
  return `WO-${handle}-${pad4(display_seq)}`;
}

export function formatIssue(handle, display_seq) {
  if (handle == null || display_seq == null) return null;
  return `ISS-${handle}-${pad4(display_seq)}`;
}

export function formatInspection(handle, display_seq) {
  if (handle == null || display_seq == null) return null;
  return `INS-${handle}-${pad4(display_seq)}`;
}
