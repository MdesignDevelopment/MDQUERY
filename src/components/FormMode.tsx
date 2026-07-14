'use client';

import { useMemo, useState } from 'react';
import type { QueryParamDef } from '@/lib/types';
import { resolveBinds } from '@/lib/params';

/**
 * Form Mode (§2.2): bind variables rendered as labeled inputs so values can
 * be filled without touching raw SQL. Same underlying query — switching modes
 * never mutates the body.
 */
export default function FormMode({ body, params, values, onValues, onCopyResolved, onTypeChange }: {
  body: string;
  params: QueryParamDef[];
  values: Record<string, string>;
  onValues: (v: Record<string, string>) => void;
  onCopyResolved: (resolved: string) => void;
  onTypeChange?: (name: string, dataType: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const resolved = useMemo(() => resolveBinds(body, values, params), [body, values, params]);

  function set(name: string, v: string) {
    onValues({ ...values, [name]: v });
  }

  async function copy() {
    await navigator.clipboard.writeText(resolved);
    onCopyResolved(resolved);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (params.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
        No bind variables (:name) detected — Form Mode applies to parameterized queries.
      </div>
    );
  }

  return (
    <div className="flex flex-1 gap-0 overflow-hidden">
      <div className="w-72 shrink-0 space-y-3 overflow-y-auto border-r border-edge p-4">
        <div className="text-[10px] uppercase tracking-widest text-ink-faint">Parameters</div>
        {params.map((p) => (
          <label key={p.name} className="block">
            <span className="mb-1 flex items-center justify-between">
              <span className="mono text-[11px] text-[var(--accent-hi)]">:{p.name}</span>
              {onTypeChange && (
                <select
                  className="mono rounded-sm border border-edge bg-bg px-1 py-0.5 text-[10px] text-ink-faint"
                  value={p.data_type}
                  onChange={(e) => onTypeChange(p.name, e.target.value)}
                  aria-label={`Input type for ${p.name}`}
                >
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="date">date</option>
                </select>
              )}
            </span>
            {p.label && <span className="mb-1 block text-[10px] text-ink-faint">{p.label}</span>}
            {p.data_type === 'enum' && p.enum_options ? (
              <select className="input" value={values[p.name] ?? p.default_value ?? ''} onChange={(e) => set(p.name, e.target.value)}>
                <option value="">— pick —</option>
                {p.enum_options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="input mono"
                type={p.data_type === 'number' ? 'number' : p.data_type === 'date' ? 'date' : 'text'}
                value={values[p.name] ?? p.default_value ?? ''}
                onChange={(e) => set(p.name, e.target.value)}
                placeholder={p.data_type}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-ink-faint">Resolved preview — values substituted as Oracle literals</span>
          <button className="btn btn-primary" onClick={copy}>{copied ? '✓ Copied' : 'Copy resolved'}</button>
        </div>
        <pre className="mono flex-1 overflow-auto whitespace-pre-wrap bg-bg p-3 text-xs leading-5">{resolved}</pre>
      </div>
    </div>
  );
}
