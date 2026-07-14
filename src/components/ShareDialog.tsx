'use client';

import { useEffect, useState } from 'react';

interface Person { id: number; name: string; email: string; department: string }

/** Colleague picker for person-to-person sharing (§2.2). */
export default function ShareDialog({ itemLabel, onShare, onClose }: {
  itemLabel: string;
  onShare: (userIds: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/users?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setPeople(d.users ?? []))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[440px] rounded-md border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold">Share <span className="mono text-[var(--accent-hi)]">{itemLabel}</span></h2>
        <p className="mb-3 text-[11px] text-ink-faint">
          Recipients get an independent copy in their private dictionary — edits on either side stay independent (no live sync).
        </p>
        <input className="input mb-2" placeholder="Search colleagues by name or email…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {picked.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {picked.map((p) => (
              <button key={p.id} className="badge border border-edge" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} title="Remove">
                {p.name} ✕
              </button>
            ))}
          </div>
        )}
        <div className="mb-3 max-h-44 overflow-y-auto rounded-sm border border-edge">
          {people.filter((p) => !picked.some((x) => x.id === p.id)).map((p) => (
            <button key={p.id} className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-panel-2" onClick={() => setPicked([...picked, p])}>
              <span>{p.name} <span className="text-ink-faint">{p.email}</span></span>
              <span className="text-[10px] uppercase text-ink-faint">{p.department}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={picked.length === 0 || busy} onClick={async () => {
            setBusy(true);
            await onShare(picked.map((p) => p.id));
            onClose();
          }}>
            Share with {picked.length || '…'}
          </button>
        </div>
      </div>
    </div>
  );
}
