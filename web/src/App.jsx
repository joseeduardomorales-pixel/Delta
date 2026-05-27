import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import Login from './routes/Login.jsx';

// Temporary home screen — replaced by the real chat surface in the next chunk.
function HomePlaceholder() {
  const { profile, signOut } = useAuth();
  return (
    <main className="min-h-screen bg-matrix-black text-matrix-fg font-mono p-6">
      <header className="flex items-center justify-between mb-10">
        <h1 className="text-2xl text-matrix-green tracking-tight">Delta</h1>
        <button
          type="button"
          onClick={signOut}
          className="min-h-tap text-xs uppercase tracking-widest border border-matrix-green-line text-matrix-fg-dim hover:border-matrix-green hover:text-matrix-green px-4 rounded-md"
        >
          Sign out
        </button>
      </header>
      <section className="space-y-2">
        <p className="text-matrix-green text-lg">
          Hello, <span className="font-bold">{profile?.fullName}</span>
        </p>
        <p className="text-matrix-fg-dim text-sm">
          Role: <span className="text-matrix-green">{profile?.role}</span>
        </p>
        <p className="text-matrix-fg-muted text-xs mt-6">
          Chat interface lands in the next build chunk.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePlaceholder />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
