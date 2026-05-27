// Route guard: redirects to /login if no session, shows a tiny
// loading frame while the session resolves on first paint, and
// optionally checks role.

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';

export function RequireAuth({ children, requireRole }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-matrix-black text-matrix-green font-mono">
        <div className="text-sm tracking-widest animate-pulse">loading…</div>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // We have a session but the /me call hasn't returned yet — keep it loading.
  if (!profile) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-matrix-black text-matrix-green font-mono">
        <div className="text-sm tracking-widest animate-pulse">authenticating…</div>
      </main>
    );
  }

  if (requireRole && profile.role !== requireRole) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-matrix-black text-matrix-fg-dim font-mono p-6">
        <div className="text-center">
          <h1 className="text-xl text-matrix-amber tracking-tight">Restricted</h1>
          <p className="mt-2 text-sm">This area is for {requireRole}s only.</p>
        </div>
      </main>
    );
  }

  return children;
}
