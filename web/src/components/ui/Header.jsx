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

function Logo() {
  return (
    <Link to="/" className="inline-flex items-center gap-2 group">
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

function AdminNav({ onClick, mobile = false }) {
  const links = [
    { to: '/admin/work-orders/pending', label: 'Review queue' },
    { to: '/admin/pm-schedules', label: 'PM schedules' },
    { to: '/admin/users', label: 'Users' },
  ];
  return (
    <nav className={cn(mobile ? 'flex flex-col gap-1' : 'flex items-center gap-1')}>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
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
          {isAdmin && <AdminNav />}
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
            {isAdmin && <AdminNav mobile onClick={() => setMenuOpen(false)} />}
            <div className="h-px bg-border" />
            <UserBlock profile={profile} onSignOut={onSignOut} mobile />
          </div>
        </div>
      )}
    </header>
  );
}
