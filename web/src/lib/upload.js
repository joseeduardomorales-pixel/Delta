// Multipart upload helper. POSTs files to /api/uploads in a single
// request and returns the staging paths the server responded with.
import { API_URL } from './supabase.js';

export async function uploadPhotos({ files, accessToken }) {
  if (!files.length) return { uploads: [], rejected: [] };
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  const res = await fetch(`${API_URL}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
