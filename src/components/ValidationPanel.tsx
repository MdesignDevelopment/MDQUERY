'use client';

import { useState } from 'react';
import type { LintFinding, Severity } from '@/lib/types';

const TABS: Array<{ key: Severity; label: string; color: string }> = [
  { key: 'error', label: 'Errors', color: 'var(--risk-high)' },
  { key: 'warning', label: 'Warnings', color: 'var(--risk-warn)' },
  { key: 'info', label: 'Info', color: 'var(--risk-safe)' },
];

/** Persistent Errors/Warnings/Info panel under the editor (§2.5) — entries jump to their line. */
export default function ValidationPanel({ findings }: { findings: LintFinding[] }) {
  const [tab, setTab] = useState<Severity>('error');
  const counts = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const active = findings.filter((f) => f.severity === tab);

  return (
    <div className="flex h-36 shrink-0 flex-col border-t border-edge bg-panel">
      <div className="flex border-b border-edge">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 text-[11px] ${tab === t.key ? 'border-b-2 text-ink' : 'text-ink-faint'}`}
            style={tab === t.key ? { borderColor: t.color } : undefined}
          >
            {t.label} <span className="mono">({counts(t.key)})</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {active.map((f, i) => (
          <button
            key={i}
            className="flex w-full items-start gap-2 border-b border-edge px-3 py-1 text-left text-[11px] hover:bg-panel-2"
            onClick={() => window.dispatchEvent(new CustomEvent('mdq-reveal-line', { detail: { line: f.line } }))}
          >
            <span className="mono shrink-0 text-ink-faint">{f.line}:{f.col}</span>
            <span className="mono shrink-0 text-ink-faint">{f.code}</span>
            <span className="text-ink-dim">{f.message}</span>
          </button>
        ))}
        {active.length === 0 && <div className="px-3 py-2 text-[11px] text-ink-faint">None.</div>}
      </div>
    </div>
  );
}
