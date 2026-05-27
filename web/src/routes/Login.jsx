// Delta — Login screen (v2, showcase aesthetic).
// Full Minimalist Modern treatment: Calistoga gradient headline,
// rotating decorative ring, generous space, single focused form.

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Button, Input, SectionLabel, Banner } from '../components/ui/index.js';

const easeOut = [0.16, 1, 0.3, 1];

export default function Login() {
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

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
    <main className="min-h-screen bg-background relative overflow-hidden">
      {/* Decorative radial glow — top right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 h-[480px] w-[480px] rounded-full opacity-30 blur-[120px]"
        style={{ background: 'radial-gradient(circle, var(--accent), transparent 60%)' }}
      />
      {/* Decorative radial glow — bottom left, smaller */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 h-[320px] w-[320px] rounded-full opacity-20 blur-[100px]"
        style={{ background: 'radial-gradient(circle, var(--accent-secondary), transparent 60%)' }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-12 md:py-20 min-h-screen flex items-center">
        <div className="grid w-full gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 items-center">
          {/* Left — form column */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: easeOut }}
            className="max-w-md w-full"
          >
            <SectionLabel tone="accent" pulse>
              Cold Cargo · Maintenance Log
            </SectionLabel>

            <h1 className="mt-5 font-display text-[2.75rem] md:text-5xl leading-[1.05] tracking-tight">
              Welcome to <span className="text-gradient">Delta</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Sign in to log work, review the kardex, and keep the shop honest.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4" aria-label="Sign in">
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {err && (
                <Banner tone="danger" title="Couldn't sign in">
                  {err}
                </Banner>
              )}

              <Button
                type="submit"
                size="lg"
                loading={busy}
                disabled={busy || !email || !password}
                className="w-full"
              >
                Sign in
                {!busy && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
              </Button>

              <p className="text-xs text-muted-foreground text-center pt-2">
                First login uses the temporary password you were issued.
              </p>
            </form>
          </motion.div>

          {/* Right — decorative graphic (hidden on small screens) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: easeOut, delay: 0.15 }}
            className="hidden lg:block relative h-[480px]"
            aria-hidden
          >
            {/* Outer rotating dashed ring */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="h-[420px] w-[420px] rounded-full border-2 border-dashed border-accent/30 animate-spin-slow"
              />
            </div>

            {/* Middle solid ring */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-[300px] w-[300px] rounded-full border border-accent/15" />
            </div>

            {/* Center Δ glyph card */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{ y: [-10, 10, -10] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                className="relative h-32 w-32 rounded-2xl bg-gradient-accent-diagonal shadow-accent-lg flex items-center justify-center"
              >
                <span className="font-display text-6xl text-accent-foreground leading-none">Δ</span>
              </motion.div>
            </div>

            {/* Floating fact cards */}
            <motion.div
              animate={{ y: [-8, 8, -8] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
              className="absolute top-8 right-6 rounded-xl bg-card border border-border shadow-md px-3 py-2 max-w-[160px]"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Fleet</p>
              <p className="mt-0.5 font-display text-lg leading-none">17 trucks</p>
            </motion.div>

            <motion.div
              animate={{ y: [8, -8, 8] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
              className="absolute bottom-12 left-2 rounded-xl bg-card border border-border shadow-md px-3 py-2 max-w-[160px]"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Trailers</p>
              <p className="mt-0.5 font-display text-lg leading-none">22 reefers</p>
            </motion.div>

            {/* Dot grid corner accent */}
            <div className="absolute bottom-0 right-0 grid grid-cols-3 gap-1.5">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-accent/40" />
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
