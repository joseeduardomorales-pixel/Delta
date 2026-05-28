// /admin/users — admin user management.
// List · Add (modal, email + name + role + temp password) ·
// Change role (inline select) · Deactivate / Reactivate (toggle).

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, ShieldCheck, Loader2, UserPlus, UserCheck, UserX, Key, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { API_URL } from '../../lib/supabase.js';
import {
  Header,
  Card,
  Badge,
  SectionLabel,
  Banner,
  Button,
  Input,
  Select,
  Modal,
  useToast,
} from '../../components/ui/index.js';
import { cn } from '../../lib/cn.js';

const easeOut = [0.16, 1, 0.3, 1];

const ROLE_TONE = {
  admin: 'accent',
  dispatcher: 'info',
  tech: 'success',
  driver: 'neutral',
};

function relTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(ms / 60000);
  return `${m}m ago`;
}

// ── Add-user modal ────────────────────────────────────────────────────────
function AddUserModal({ open, onClose, onCreate, busy }) {
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    role: 'tech',
    phone: '',
    temp_password: '',
  });
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ email: '', full_name: '', role: 'tech', phone: '', temp_password: '' });
      setErr(null);
    }
  }, [open]);

  async function submit() {
    setErr(null);
    if (!form.email.includes('@')) return setErr('email_required');
    if (!form.full_name.trim()) return setErr('full_name_required');
    if (form.temp_password.length < 8) return setErr('password_min_8');
    try {
      await onCreate(form);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a user"
      description="They'll sign in with this email + temporary password and can change the password from their account later."
      maxWidth="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            <UserPlus size={16} /> Create user
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Email"
          type="email"
          placeholder="hugo@coldcargo.us"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Input
          label="Full name"
          placeholder="Hugo Cesar Guajardo"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            helper={
              form.role === 'admin'
                ? 'Full access. Choose carefully.'
                : form.role === 'dispatcher'
                  ? 'Can report issues; cannot open work orders.'
                  : form.role === 'tech'
                    ? 'Can log work, report issues, open WOs.'
                    : 'Reserved for driver app — limited usage today.'
            }
          >
            <option value="tech">Tech</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="admin">Admin</option>
            <option value="driver">Driver</option>
          </Select>
          <Input
            label="Phone"
            optional
            placeholder="9561234567"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <Input
          label="Temporary password"
          type="text"
          placeholder="min. 8 characters"
          value={form.temp_password}
          onChange={(e) => setForm({ ...form, temp_password: e.target.value })}
          helper="Share this with them privately. They can change it after first login."
        />
        {err && (
          <Banner tone="danger" title="Couldn't create user">
            {err}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

// ── Reset password modal ──────────────────────────────────────────────────
function ResetPasswordModal({ open, user, onClose, onConfirm, busy }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open) {
      setPw('');
      setErr(null);
    }
  }, [open]);

  function generate() {
    // Pronounceable-ish temp: short, easy to read over the phone.
    const wordlist = ['blue', 'fast', 'oak', 'sky', 'rock', 'mint', 'red', 'pine', 'bolt', 'frost'];
    const word = wordlist[Math.floor(Math.random() * wordlist.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    setPw(`${word}-${word}-${num}`);
  }

  async function submit() {
    setErr(null);
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      await onConfirm(user.id, pw);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reset password for ${user?.full_name || user?.email || ''}`}
      description="They will sign in with this new password. Share it with them privately — Delta will not show it again."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy || pw.length < 8}>
            <Key size={16} /> Set new password
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <span className="font-mono text-xs text-muted-foreground">EMAIL</span>{' '}
          {user?.email}
        </div>
        <Input
          label="New password"
          type="text"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="min. 8 characters"
          autoFocus
        />
        <div className="flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={generate} disabled={busy}>
            Generate one
          </Button>
          <p className="text-[11px] text-muted-foreground">
            They can change it after they sign in.
          </p>
        </div>
        {err && (
          <Banner tone="danger" title="Couldn't reset">
            {err}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────
function DeleteUserModal({ open, user, onClose, onConfirm, busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      destructive
      title={`Delete ${user?.full_name || user?.email || 'user'}?`}
      description={
        user?.role
          ? 'Removes them permanently. Any WOs or issues they logged stay, but the user row is gone. Deactivate is usually safer.'
          : 'This is an orphan account (no profile data). Safe to remove.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onConfirm(user.id)} loading={busy}>
            <Trash2 size={16} /> Delete permanently
          </Button>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm space-y-1">
        <p>
          <span className="font-mono text-xs text-muted-foreground">EMAIL</span>{' '}
          {user?.email}
        </p>
        {user?.role && (
          <p>
            <span className="font-mono text-xs text-muted-foreground">ROLE</span>{' '}
            <Badge tone={ROLE_TONE[user?.role] || 'neutral'}>{user?.role}</Badge>
          </p>
        )}
      </div>
    </Modal>
  );
}

// ── Deactivate confirm modal ──────────────────────────────────────────────
function DeactivateModal({ open, user, onClose, onConfirm, busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      destructive
      title={`Deactivate ${user?.full_name || ''}?`}
      description="They will no longer be able to sign in. Existing work orders they logged stay intact. You can reactivate any time."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep active
          </Button>
          <Button variant="danger" onClick={() => onConfirm(user.id)} loading={busy}>
            <UserX size={16} /> Deactivate
          </Button>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm space-y-1">
        <p>
          <span className="font-mono text-xs text-muted-foreground">EMAIL</span>{' '}
          {user?.email}
        </p>
        <p>
          <span className="font-mono text-xs text-muted-foreground">ROLE</span>{' '}
          <Badge tone={ROLE_TONE[user?.role] || 'neutral'}>{user?.role}</Badge>
        </p>
      </div>
    </Modal>
  );
}

// ── Per-row card ─────────────────────────────────────────────────────────
function UserRow({
  u,
  isSelf,
  onChangeRole,
  onToggleActive,
  onDeactivate,
  onResetPassword,
  onDelete,
  busy,
}) {
  // An "orphan" is an auth.users entry without a profile row — shows up
  // as "(no name)" with no role. Right action is delete, not deactivate.
  const isOrphan = !u.role;
  return (
    <Card className={cn('p-5', !u.active && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-display text-lg tracking-tight truncate">
              {u.full_name || <span className="text-muted-foreground italic">(no name)</span>}
            </h3>
            <Badge tone={ROLE_TONE[u.role] || 'neutral'}>{u.role || '?'}</Badge>
            {u.handle && <Badge tone="neutral">#{u.handle}</Badge>}
            {!u.active && <Badge tone="danger">inactive</Badge>}
            {isSelf && <Badge tone="accent">you</Badge>}
            {isOrphan && <Badge tone="warning">orphan</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground font-mono truncate">{u.email}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Last sign-in {relTime(u.last_sign_in_at)}
            {u.phone && (
              <>
                <span className="mx-1.5">·</span>
                <span className="font-mono">{u.phone}</span>
              </>
            )}
          </p>
        </div>
        {!isSelf && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {!isOrphan && (
              <>
                <Select
                  value={u.role || 'tech'}
                  onChange={(e) => onChangeRole(u.id, e.target.value)}
                  className="h-9 text-xs"
                  disabled={busy}
                >
                  <option value="tech">Tech</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="admin">Admin</option>
                  <option value="driver">Driver</option>
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onResetPassword(u)}
                  disabled={busy}
                >
                  <Key size={14} /> Reset password
                </Button>
                {u.active ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onDeactivate(u)}
                    disabled={busy}
                  >
                    <UserX size={14} /> Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onToggleActive(u.id, true)}
                    disabled={busy}
                  >
                    <UserCheck size={14} /> Reactivate
                  </Button>
                )}
              </>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={() => onDelete(u)}
              disabled={busy}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function Users() {
  const { session, profile, signOut } = useAuth();
  const { push: pushToast } = useToast();
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [resettingPw, setResettingPw] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setUsers(data.users || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [session.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(form) {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: 'User created',
        text: `${data.user.full_name} · ${data.user.role}`,
      });
      setAddOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(id, body, successMsg) {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (successMsg) pushToast({ tone: 'success', title: successMsg, ttl: 1500 });
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Update failed', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function onChangeRole(id, role) {
    patchUser(id, { role }, 'Role updated');
  }
  function onToggleActive(id, active) {
    patchUser(id, { active }, active ? 'Reactivated' : 'Deactivated');
  }
  async function onDeactivate(id) {
    await patchUser(id, { active: false }, 'Deactivated');
    setDeactivating(null);
  }

  async function onResetPassword(id, new_password) {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ new_password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({
        tone: 'success',
        title: 'Password reset',
        text: 'Share the new password with them privately.',
      });
      setResettingPw(null);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      pushToast({ tone: 'warning', title: 'User deleted' });
      setDeleting(null);
      await load();
    } catch (e) {
      pushToast({ tone: 'danger', title: 'Delete failed', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const counts = (users || []).reduce(
    (acc, u) => {
      if (u.active) acc.active++;
      else acc.inactive++;
      acc.byRole[u.role || '?'] = (acc.byRole[u.role || '?'] || 0) + 1;
      return acc;
    },
    { active: 0, inactive: 0, byRole: {} },
  );

  return (
    <div className="min-h-screen bg-background">
      <Header
        profile={profile}
        onSignOut={signOut}
        context={users ? `Users · ${counts.active} active` : 'Users'}
        sticky
      />
      <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOut }}
          className="mb-6 flex items-end justify-between gap-4 flex-wrap"
        >
          <div>
            <SectionLabel tone="accent">
              Team
            </SectionLabel>
            <h1 className="mt-4 font-display text-3xl md:text-4xl tracking-tight leading-tight">
              <span className="text-gradient">Users</span> & roles
            </h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Add the people who need access. Roles gate what they can do:
              techs log work, dispatchers report issues, admins (like you)
              see everything.
            </p>
          </div>
          <Button size="md" onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            Add user
          </Button>
        </motion.div>

        {users && users.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="success">
              {counts.active} active
            </Badge>
            {counts.inactive > 0 && (
              <Badge tone="danger">{counts.inactive} inactive</Badge>
            )}
            {Object.entries(counts.byRole)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([role, n]) => (
                <Badge key={role} tone={ROLE_TONE[role] || 'neutral'}>
                  <span className="capitalize">{role}</span> · {n}
                </Badge>
              ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading users…
          </div>
        )}

        {err && (
          <Banner tone="danger" title="Couldn't load users">
            {err}
          </Banner>
        )}

        {!loading && !err && users && users.length === 0 && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-bg text-accent">
              <ShieldCheck size={22} />
            </div>
            <p className="font-display text-2xl tracking-tight">
              No users yet — but you're here.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              That shouldn't happen if you got in. Refresh the page.
            </p>
          </Card>
        )}

        {!loading && users && users.length > 0 && (
          <div className="space-y-3">
            {users.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                isSelf={u.id === profile?.id}
                busy={busy}
                onChangeRole={onChangeRole}
                onToggleActive={onToggleActive}
                onDeactivate={(user) => setDeactivating(user)}
                onResetPassword={(user) => setResettingPw(user)}
                onDelete={(user) => setDeleting(user)}
              />
            ))}
          </div>
        )}
      </main>

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={createUser}
        busy={busy}
      />
      <DeactivateModal
        open={Boolean(deactivating)}
        user={deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={onDeactivate}
        busy={busy}
      />
      <ResetPasswordModal
        open={Boolean(resettingPw)}
        user={resettingPw}
        onClose={() => setResettingPw(null)}
        onConfirm={onResetPassword}
        busy={busy}
      />
      <DeleteUserModal
        open={Boolean(deleting)}
        user={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        busy={busy}
      />
    </div>
  );
}
