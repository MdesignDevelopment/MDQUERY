'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import RiskBadge from './RiskBadge';

interface Result {
  id: number;
  tag: string;
  title: string;
  is_public: boolean;
  kind: 'query' | 'workflow';
  risk_level?: string;
  client_label?: string | null;
}

/** Ctrl+K jump-to-item palette (§2.8, §3 keyboard-first navigation). */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    // Abort the previous request on every keystroke so a slow response for an
    // older query can never overwrite results of a newer one.
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results ?? []);
          setActive(0);
        })
        .catch(() => {}); // aborted — newer keystroke owns the results
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  function open(r: Result) {
    onClose();
    router.push(r.kind === 'workflow' ? `/workflows/${r.id}` : `/queries/${r.id}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
    if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    if (e.key === 'Enter' && results[active]) open(results[active]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]" onClick={onClose}>
      <div className="w-[560px] overflow-hidden rounded-md border border-edge bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to a query or workflow by tag, title, body, client, author…"
          className="mono w-full border-b border-edge bg-panel px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint"
          aria-label="Search"
        />
        <div className="max-h-[320px] overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${i === active ? 'bg-panel-2' : 'hover:bg-panel-2'}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(r)}
            >
              <span className="text-ink-faint">{r.kind === 'workflow' ? '⛓' : '≡'}</span>
              <span className="mono text-[var(--accent-hi)]">{r.tag}</span>
              <span className="flex-1 truncate text-ink-dim">{r.title}</span>
              {r.client_label && <span className="badge border border-edge text-ink-faint">{r.client_label}</span>}
              {r.risk_level && <RiskBadge level={r.risk_level as any} compact />}
              <span className="text-[10px] uppercase text-ink-faint">{r.is_public ? 'public' : 'private'}</span>
            </button>
          ))}
          {q && results.length === 0 && <div className="px-3 py-4 text-xs text-ink-faint">No matches.</div>}
        </div>
      </div>
    </div>
  );
}
