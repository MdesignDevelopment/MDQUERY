'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Share inbox + notifications (§2.2): accept-into-dictionary or dismiss. */
export default function InboxPage() {
  const [shares, setShares] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [error, setError] = useState('');
  const router = useRouter();

  const load = useCallback(async () => {
    const [s, n] = await Promise.all([
      fetch('/api/shares').then((r) => r.json()),
      fetch('/api/notifications').then((r) => r.json()),
    ]);
    setShares(s.shares ?? []);
    setNotifications(n.notifications ?? []);
    fetch('/api/notifications', { method: 'POST' }); // mark read
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id: number, action: 'accept' | 'dismiss') {
    const r = await fetch(`/api/shares/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    const d = await r.json();
    if (r.ok && action === 'accept') {
      router.push(d.item_type === 'workflow' ? `/workflows/${d.created_id}` : `/queries/${d.created_id}`);
      return;
    }
    if (!r.ok) {
      setError(d.error ?? 'Failed');
      setTimeout(() => setError(''), 4000);
    }
    load();
  }

  const pending = shares.filter((s) => s.status === 'pending');
  const resolved = shares.filter((s) => s.status !== 'pending');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <span className="text-[11px] text-ink-faint">shares from colleagues & review outcomes</span>
        {error && <span className="text-[11px]" style={{ color: 'var(--risk-high)' }} role="alert">{error}</span>}
      </header>

      <section className="p-4">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Shared with you ({pending.length})</h2>
        {pending.map((s) => (
          <div key={s.id} className="mb-2 flex items-center gap-2 rounded-sm border border-edge px-3 py-2 text-xs">
            <span className="text-ink-faint">{s.item_type === 'workflow' ? '⛓' : '≡'}</span>
            <span><b>{s.from_name}</b> shared a {s.item_type} with you:</span>
            <span className="mono text-[var(--accent-hi)]">{s.snapshot?.tag}</span>
            <span className="flex-1 truncate text-ink-dim">{s.snapshot?.title}</span>
            <span className="text-ink-faint">{new Date(s.shared_at).toLocaleString()}</span>
            <button className="btn btn-primary" onClick={() => act(s.id, 'accept')}>Accept into my dictionary</button>
            <button className="btn" onClick={() => act(s.id, 'dismiss')}>Dismiss</button>
          </div>
        ))}
        {pending.length === 0 && <div className="text-xs text-ink-faint">No pending shares.</div>}
      </section>

      <section className="p-4 pt-0">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Notifications</h2>
        {notifications.map((n) => (
          <div key={n.id} className="mb-1 flex items-center gap-2 rounded-sm border border-edge px-3 py-1.5 text-[11px] text-ink-dim">
            {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
            {n.kind === 'share' && <span><b>{n.payload.from}</b> shared <span className="mono text-[var(--accent-hi)]">{n.payload.tag}</span> — check “Shared with you” above.</span>}
            {n.kind === 'review_approved' && <span>✓ Your request for <span className="mono text-[var(--accent-hi)]">{n.payload.tag}</span> was <b style={{ color: 'var(--risk-safe)' }}>approved</b> by {n.payload.by}.</span>}
            {n.kind === 'review_rejected' && <span>✕ Your request for <span className="mono text-[var(--accent-hi)]">{n.payload.tag}</span> was <b style={{ color: 'var(--risk-high)' }}>rejected</b> by {n.payload.by}: “{n.payload.notes}” — revise it under My Requests.</span>}
            <span className="flex-1" />
            <span className="text-ink-faint">{new Date(n.created_at).toLocaleString()}</span>
          </div>
        ))}
        {notifications.length === 0 && <div className="text-xs text-ink-faint">Nothing yet.</div>}
      </section>

      {resolved.length > 0 && (
        <section className="p-4 pt-0">
          <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Handled shares</h2>
          {resolved.map((s) => (
            <div key={s.id} className="mb-1 flex items-center gap-2 px-3 py-1 text-[11px] text-ink-faint">
              <span className="mono">{s.snapshot?.tag}</span> from {s.from_name} — {s.status}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
