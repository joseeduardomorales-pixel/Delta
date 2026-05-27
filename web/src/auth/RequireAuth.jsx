// Route guard: redirects to /login if no session, shows a minimal
// loading frame while the session resolves on first paint, and
// optionally checks role.

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';

function LoadingFrame({ label }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
        <span className="font-mono text-[11px] uppercase tracking-[0.15em]">{label}</span>
      </div>
    </main>
  );
}

export function RequireAuth({ children, requireRole }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingFrame label="loading" />;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!profile) return <LoadingFrame label="authenticating" />;

  if (requireRole && profile.role !== requireRole) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-3xl text-foreground">Restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is for {requireRole}s only.
          </p>
        </div>
      </main>
    );
  }

  return children;
}
