// Delta — login screen.
// Matrix style, mobile-first, single email + password form. Large tap
// targets, loading and error states explicit. No "remember me" — Supabase
// session persistence is on by default.

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';

export default function Login() {
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // If already signed in, bounce home.
  if (session) {
    const to = location.state?.from || '/';
    return null === navigate(to, { replace: true });
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await signIn({ email: email.trim(), password });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error || 'Sign-in failed');
      return;
    }
    const to = location.state?.from || '/';
    navigate(to, { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-matrix-black text-matrix-fg font-mono p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5"
        aria-label="Sign in"
      >
        <header className="text-center mb-8">
          <h1 className="text-4xl text-matrix-green tracking-tight">Delta</h1>
          <p className="mt-1 text-xs text-matrix-fg-muted">Cold Cargo maintenance log</p>
        </header>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-matrix-fg-dim">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-transparent border border-matrix-green-line focus:border-matrix-green outline-none rounded-md px-3 py-3 text-base text-matrix-green min-h-tap"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-matrix-fg-dim">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-transparent border border-matrix-green-line focus:border-matrix-green outline-none rounded-md px-3 py-3 text-base text-matrix-green min-h-tap"
          />
        </label>

        {err && (
          <div
            role="alert"
            className="text-sm text-matrix-red border border-matrix-red/40 rounded-md px-3 py-2"
          >
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full min-h-tap rounded-md border border-matrix-green text-matrix-green hover:shadow-matrix-glow disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm uppercase tracking-widest transition-base"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-xs text-matrix-fg-muted">
          First login uses the temporary password you were issued.
        </p>
      </form>
    </main>
  );
}
