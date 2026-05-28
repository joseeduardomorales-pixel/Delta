// Delta — Header primitive (v2).
// Top bar present on every screen except /login. Logo + page context
// + role-gated admin nav + user info + sign out.
//
// Mobile: condenses admin nav + user info into a slide-out menu.
// Desktop: everything inline.

import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X, LogOut } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './Button.jsx';
import { buildLabel } from '../../lib/build.js';

function Logo() {
  // The `title` tooltip exposes the build sha — hovering the logo on
  // desktop shows e.g. "Delta · 3046c49 · 5/27". One-second sanity check
  // for "is this user on the latest build?" without opening dev tools.
  return (
    <Link
      to="/"
      title={`Delta · ${buildLabel()}`}
      className="inline-flex items-center gap-2 group"
    >
      <span
        aria-hidden
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-accent-diagonal shadow-accent text-accent-foreground font-display text-base leading-none"
      >
        Δ
      </span>
      <span className="font-display text-lg leading-none">Delta</span>
    </Link>
  );
}

function MainNav({ onClick, mobile = false, isAdmin }) {
  // Everyone sees Chat + Work Orders. Admins also see the admin tools.
  const links = [
    { to: '/', label: 'Chat', everyone: true, end: true },
    { to: '/work-orders', label: 'Work orders', everyone: true },
    { to: '/admin/work-orders/pending', label: 'Review queue', adminOnly: true },
    { to: '/admin/pm-schedules', label: 'PM schedules', adminOnly: true },
    { to: '/admin/campaigns', label: 'Campaigns', adminOnly: true },
    { to: '/admin/users', label: 'Users', adminOnly: true },
  ];
  const visible = links.filter((l) => l.everyone || (l.adminOnly && isAdmin));
  return (
    <nav className={cn(mobile ? 'flex flex-col gap-1' : 'flex items-center gap-1')}>
      {visible.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          onClick={onClick}
          className={({ isActive }) =>
            cn(
              'rounded-md text-sm transition-colors',
              mobile ? 'px-3 py-2 min-h-tap flex items-center' : 'px-3 py-1.5',
              isActive
                ? 'bg-accent-bg text-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBlock({ profile, onSignOut, mobile = false }) {
  return (
    <div className={cn('flex items-center', mobile ? 'flex-col gap-3 items-stretch w-full' : 'gap-3')}>
      <div className={cn('flex flex-col', mobile ? 'items-start' : 'items-end')}>
        <span className="text-xs font-medium text-foreground">
          {profile?.fullName || '—'}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {profile?.role || ''}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onSignOut}>
        <LogOut size={14} />
        Sign out
      </Button>
    </div>
  );
}

export function Header({ profile, onSignOut, context, sticky = false, className }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const isAdmin = profile?.role === 'admin';

  // Close mobile menu on route change.
  // (Simple: just close whenever pathname changes.)
  // The Link clicks call setMenuOpen(false) too; this is a backstop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // (Skipping a full effect to stay light.)

  return (
    <header
      className={cn(
        'w-full bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70 border-b border-border',
        sticky && 'sticky top-0 z-40',
        className,
      )}
    >
      <div className="mx-auto max-w-6xl px-4 h-14 md:h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <Logo />
          {context && (
            <span className="hidden md:inline-block text-sm text-muted-foreground border-l border-border pl-4 truncate">
              {context}
            </span>
          )}
        </div>

        {/* Desktop right side */}
        <div className="hidden md:flex items-center gap-3">
          <MainNav isAdmin={isAdmin} />
          <span className="h-6 w-px bg-border" aria-hidden />
          <UserBlock profile={profile} onSignOut={onSignOut} />
        </div>

        {/* Mobile menu trigger */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden inline-flex items-center justify-center min-h-tap min-w-tap -mr-2 rounded-md text-muted-foreground hover:text-foreground"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile sheet */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-card">
          <div className="px-4 py-4 space-y-4">
            {context && (
              <p className="text-xs text-muted-foreground">{context}</p>
            )}
            <MainNav isAdmin={isAdmin} mobile onClick={() => setMenuOpen(false)} />
            <div className="h-px bg-border" />
            <UserBlock profile={profile} onSignOut={onSignOut} mobile />
            <p className="text-[10px] text-muted-foreground/70 text-center pt-2">
              build {buildLabel()}
            </p>
          </div>
        </div>
      )}
    </header>
  );
}
