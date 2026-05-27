// Delta — auth context.
// Holds the Supabase session + the profile row from public.users
// (delivered via GET /me from the API). Exposes signIn / signOut.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, API_URL } from '../lib/supabase.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null); // { id, email, fullName, role }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Subscribe to session changes (initial load + sign in/out)
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // Whenever the session changes, fetch /me to get role + full_name.
  useEffect(() => {
    let alive = true;
    if (!session?.access_token) {
      setProfile(null);
      return;
    }
    fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        if (alive) setProfile(data);
      })
      .catch(async (r) => {
        // If /me fails, surface as auth error and sign out — better than
        // a half-authenticated state.
        const text = r?.text ? await r.text().catch(() => '') : String(r);
        if (alive) {
          setError(`Profile fetch failed (${r?.status || '?'}): ${text.slice(0, 200)}`);
          await supabase.auth.signOut();
        }
      });
    return () => {
      alive = false;
    };
  }, [session?.access_token]);

  async function signIn({ email, password }) {
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    }
    setSession(data.session);
    return { ok: true };
  }

  async function signOut() {
    setError(null);
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  const value = useMemo(
    () => ({ session, profile, loading, error, signIn, signOut }),
    [session, profile, loading, error],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
