'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { User } from '@/lib/types';
import CommandPalette from './CommandPalette';

const NAV = [
  { href: '/favorites', label: 'Favorites', icon: '★' },
  { href: '/dictionary', label: 'My Private Dictionary', icon: '⌂' },
  { href: '/public', label: 'Public Dictionary', icon: '⌸' },
  { href: '/workflows', label: 'Workflows', icon: '⛓' },
  { href: '/inbox', label: 'Inbox', icon: '✉' },
  { href: '/reviews', label: 'My Requests', icon: '⇪' },
];

export default function Nav({ user }: { user: User }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isReviewer = user.role === 'curator' || user.role === 'admin' || user.department === 'Support';

  useEffect(() => {
    const load = () => fetch('/api/notifications').then((r) => r.json()).then((d) => setUnread(d.unread ?? 0)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleTheme() {
    const el = document.documentElement;
    const light = el.getAttribute('data-theme') === 'light';
    if (light) {
      el.removeAttribute('data-theme');
      localStorage.setItem('mdq-theme', 'dark');
    } else {
      el.setAttribute('data-theme', 'light');
      localStorage.setItem('mdq-theme', 'light');
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <>
      <nav className={`flex shrink-0 flex-col border-r border-edge bg-panel ${collapsed ? 'w-11' : 'w-56'} transition-all`}>
        <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
          {!collapsed && (
            <div className="mono text-base font-bold tracking-wide">
              MD<span className="text-[var(--accent-hi)]">/</span>QUERY
            </div>
          )}
          <button className="text-ink-faint hover:text-ink" onClick={() => setCollapsed(!collapsed)} title="Toggle sidebar">
            {collapsed ? '»' : '«'}
          </button>
        </div>

        {!collapsed && (
          <button
            onClick={() => setPaletteOpen(true)}
            className="mx-2 mt-2 flex items-center justify-between rounded-sm border border-edge bg-bg px-2 py-1.5 text-xs text-ink-faint hover:border-[var(--accent)]"
          >
            <span>Search queries…</span>
            <kbd className="mono rounded border border-edge px-1 text-[10px]">Ctrl K</kbd>
          </button>
        )}

        <div className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                pathname.startsWith(n.href) ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
              title={n.label}
            >
              <span className="w-4 text-center">{n.icon}</span>
              {!collapsed && <span className="flex-1">{n.label}</span>}
              {!collapsed && n.href === '/inbox' && unread > 0 && (
                <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-white">{unread}</span>
              )}
            </Link>
          ))}
          {user.role === 'admin' && (
            <Link
              href="/admin/users"
              className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                pathname.startsWith('/admin') ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
              title="User Management"
            >
              <span className="w-4 text-center">⚙</span>
              {!collapsed && <span>User Management</span>}
            </Link>
          )}
          {isReviewer && (
            <Link
              href="/approvals"
              className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                pathname.startsWith('/approvals') ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
              title="Pending Approvals"
            >
              <span className="w-4 text-center">✓</span>
              {!collapsed && <span>Pending Approvals</span>}
            </Link>
          )}
        </div>

        <div className="border-t border-edge p-2">
          {!collapsed && (
            <div className="mb-1 truncate px-1 text-[11px] text-ink-dim" title={user.email}>
              {user.name} <span className="mono text-[10px] uppercase text-ink-faint">({user.role})</span>
            </div>
          )}
          <div className="flex gap-1">
            <button className="btn flex-1 justify-center" onClick={toggleTheme} title="Toggle light/dark theme">
              ◐
            </button>
            <button className="btn flex-1 justify-center" onClick={logout} title="Sign out">
              ⎋
            </button>
          </div>
        </div>
      </nav>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}
