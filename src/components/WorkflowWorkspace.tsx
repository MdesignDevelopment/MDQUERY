'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import RiskBadge from './RiskBadge';
import ShareDialog from './ShareDialog';
import { SkeletonWorkspace } from './Skeleton';
import { useDialogs } from './Dialogs';
import { fetchJsonCached, getCache, setCache } from '@/lib/clientCache';
import { resolveBinds } from '@/lib/params';
import type { User, WorkflowRow, WorkflowStepRow } from '@/lib/types';

type StepDraft = {
  query_id: number;
  param_bindings: Record<string, { source: string }>;
  note: string | null;
  query?: WorkflowStepRow['query'];
};

/**
 * Workflow builder (§2.10): ordered steps, explicit visual source → target
 * param mapping, run view with manual value entry (execution always happens
 * outside the platform), and a resolved ordered script as the output.
 */
export default function WorkflowWorkspace({ id, user }: { id: number; user: User }) {
  const router = useRouter();
  const [wf, setWf] = useState<WorkflowRow | null>(null);
  const [meta, setMeta] = useState({ tag: '', title: '', description: '', client_label: '' });
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'build' | 'run'>('build');
  const [values, setValues] = useState<Record<number, Record<string, string>>>({}); // stepIndex(1-based) -> param -> value
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<'sqldev' | 'sqlplus'>('sqldev');

  const { confirm, dialogs } = useDialogs();
  const isCurator = user.role === 'curator' || user.role === 'admin';
  const editable = wf ? (!wf.is_public ? wf.owner_id === user.id : isCurator) : false;

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    const url = `/api/workflows/${id}`;
    const applyData = (d: any) => {
      setWf(d.workflow);
      setMeta({ tag: d.workflow.tag, title: d.workflow.title, description: d.workflow.description ?? '', client_label: d.workflow.client_label ?? '' });
      setSteps((d.workflow.steps ?? []).map((s: WorkflowStepRow) => ({ query_id: s.query_id, param_bindings: s.param_bindings ?? {}, note: s.note, query: s.query })));
      setDirty(false);
      // Fresh workflow: open the step picker right away so the next action is obvious
      if ((d.workflow.steps ?? []).length === 0 && !d.workflow.is_public) setPickerOpen(true);
    };
    const cached = getCache<any>(url);
    if (cached?.workflow) applyData(cached);
    try {
      const d = await fetchJsonCached<any>(url);
      if (d.error) {
        if (!cached) setNotice(d.error);
        return;
      }
      if (!cached || !dirtyRef.current) applyData(d);
    } catch {
      if (!cached) setNotice('Failed to load');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!pickerOpen) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const [priv, pub] = await Promise.all([
          fetch(`/api/queries?scope=private&q=${encodeURIComponent(pickerQ)}`, { signal: ctrl.signal }).then((r) => r.json()),
          fetch(`/api/queries?scope=public&q=${encodeURIComponent(pickerQ)}`, { signal: ctrl.signal }).then((r) => r.json()),
        ]);
        setPickerResults([...(pub.queries ?? []), ...(priv.queries ?? [])].slice(0, 20));
      } catch {
        /* aborted — newer keystroke owns the results */
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [pickerQ, pickerOpen]);

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(''), 2500); }

  async function save() {
    if (!editable || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...meta, client_label: meta.client_label || null, steps: steps.map((s) => ({ query_id: s.query_id, param_bindings: s.param_bindings, note: s.note })) }),
      });
      const d = await r.json();
      if (!r.ok) return flash(d.error ?? 'Save failed');
      setWf(d.workflow);
      setSteps((d.workflow.steps ?? []).map((s: WorkflowStepRow) => ({ query_id: s.query_id, param_bindings: s.param_bindings ?? {}, note: s.note, query: s.query })));
      setDirty(false);
      setCache(`/api/workflows/${id}`, { workflow: d.workflow });
      flash('Saved ✓');
    } finally {
      setSaving(false);
    }
  }

  async function addStep(q: any) {
    const r = await fetch(`/api/queries/${q.id}`);
    const d = await r.json();
    setSteps([...steps, { query_id: q.id, param_bindings: {}, note: null, query: d.query }]);
    setPickerOpen(false);
    setPickerQ('');
    setDirty(true);
  }

  function move(i: number, dir: -1 | 1) {
    const next = [...steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
    setDirty(true);
  }

  function setBinding(stepIdx: number, param: string, source: string) {
    const next = [...steps];
    const b = { ...next[stepIdx].param_bindings };
    if (source === '') delete b[param];
    else b[param] = { source };
    next[stepIdx] = { ...next[stepIdx], param_bindings: b };
    setSteps(next);
    setDirty(true);
  }

  /** Effective value for a step param: bound source value, else manual entry. */
  function effectiveValue(stepIdx1: number, param: string): string {
    const step = steps[stepIdx1 - 1];
    const binding = step?.param_bindings?.[param];
    if (binding?.source) {
      const m = /^step_(\d+)\.(.+)$/.exec(binding.source);
      if (m) {
        const src = values[Number(m[1])]?.[m[2]];
        if (src !== undefined && src !== '') return src;
      }
    }
    return values[stepIdx1]?.[param] ?? '';
  }

  const resolvedScript = useMemo(() => {
    if (!wf) return '';
    const parts = steps.map((s, i) => {
      const q = s.query!;
      const vals: Record<string, string> = {};
      for (const p of q.params ?? []) {
        const v = effectiveValue(i + 1, p.name);
        if (v !== '') vals[p.name] = v;
      }
      const body = resolveBinds(q.body, vals, q.params ?? []).trimEnd();
      return `-- STEP ${i + 1}/${steps.length} — ${q.tag}: ${q.title}${s.note ? `\n-- ${s.note}` : ''}\n${body}${/[;/]\s*$/.test(body) ? '' : ';'}`;
    });
    return `-- Workflow: ${meta.tag} — ${meta.title}\n-- Run in order; feed results of each step into the next before continuing.\n\n${parts.join('\n\n')}\n`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, values, meta, wf]);

  async function copyScript() {
    await navigator.clipboard.writeText(resolvedScript);
    flash('Resolved script copied — ready for the client environment.');
  }

  async function toggleFavorite() {
    if (!wf) return;
    setWf({ ...wf, favorited: !wf.favorited });
    await fetch('/api/favorites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_type: 'workflow', item_id: wf.id }) });
  }

  async function promote() {
    if (dirty) return flash('Save first, then promote.');
    const r = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_type: 'workflow', item_id: id, request_type: 'new_promotion' }),
    });
    const d = await r.json();
    flash(r.ok ? 'Promotion request submitted for peer review.' : d.error ?? 'Failed');
  }

  async function del() {
    if (!wf) return;
    const ok = await confirm({
      title: `Delete workflow "${wf.tag}"?`,
      message: 'The step queries themselves stay in your dictionary — only the chain is deleted.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
    if (r.ok) router.push('/workflows');
  }

  if (!wf) {
    if (notice) return <div className="p-6 text-xs text-ink-faint">{notice}</div>;
    return <SkeletonWorkspace />;
  }

  const exportValues = () => {
    const out: Record<number, Record<string, string>> = {};
    steps.forEach((s, i) => {
      const vals: Record<string, string> = {};
      for (const p of s.query?.params ?? []) {
        const v = effectiveValue(i + 1, p.name);
        if (v !== '') vals[p.name] = v;
      }
      out[i + 1] = vals;
    });
    return encodeURIComponent(JSON.stringify(out));
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-1.5 text-[11px]">
        <Link href="/workflows" className="text-ink-faint hover:text-ink">Workflows</Link>
        <span className="text-ink-faint">/</span>
        <span className="mono text-[var(--accent-hi)]">{wf.tag}</span>
        <span className="badge" style={wf.is_public ? { color: 'var(--accent-hi)', border: '1px solid var(--accent)', background: 'rgba(14,99,156,.15)' } : { color: 'var(--ink-dim)', border: '1px solid var(--edge)' }}>
          {wf.is_public ? '⌸ PUBLIC' : '⌂ PRIVATE'}
        </span>
        {wf.risk_level && <RiskBadge level={wf.risk_level} />}
        <span className="text-[10px] text-ink-faint">risk = highest-risk step</span>
        <span className="flex-1" />
        {notice && <span className="text-[var(--risk-safe)]">{notice}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-panel px-4 py-2">
        <input className="input mono w-44" value={meta.tag} disabled={!editable} onChange={(e) => { setMeta({ ...meta, tag: e.target.value }); setDirty(true); }} aria-label="Workflow tag" />
        <input className="input w-56" value={meta.title} disabled={!editable} onChange={(e) => { setMeta({ ...meta, title: e.target.value }); setDirty(true); }} aria-label="Workflow title" />
        {!wf.is_public && (
          <input className="input mono w-32" value={meta.client_label} disabled={!editable} placeholder="client label" onChange={(e) => { setMeta({ ...meta, client_label: e.target.value }); setDirty(true); }} aria-label="Client label" />
        )}
        <div className="mono flex rounded-sm border border-edge text-[11px]">
          {(['build', 'run'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-2.5 py-0.5 ${view === v ? 'bg-panel-2 text-ink' : 'text-ink-faint'}`}>{v}</button>
          ))}
        </div>
        <span className="flex-1" />
        <button className={`btn ${wf.favorited ? 'text-[var(--risk-warn)]' : ''}`} onClick={toggleFavorite} aria-label="Toggle favorite">★</button>
        <button className="btn" onClick={copyScript} title="Copy the resolved, ordered script">⧉ Copy script</button>
        <span className="flex items-stretch">
          <a className="btn whitespace-nowrap rounded-r-none" href={`/api/workflows/${id}/export?target=${exportTarget}&values=${exportValues()}`} title="Export annotated .sql">⭳ Export .sql</a>
          <select className="input w-auto rounded-l-none border-l-0" value={exportTarget} onChange={(e) => setExportTarget(e.target.value as any)} aria-label="Export format target">
            <option value="sqldev">SQL Developer</option>
            <option value="sqlplus">SQL*Plus</option>
          </select>
        </span>
        {!wf.is_public && (
          <>
            <button className="btn" onClick={() => setShareOpen(true)} aria-label="Share workflow">⇉ Share</button>
            <button className="btn" onClick={promote}>⇪ Promote</button>
          </>
        )}
        {editable && <button className="btn" onClick={del} aria-label="Delete workflow">🗑</button>}
        {editable && <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Steps column */}
        <div className="flex w-1/2 min-w-[380px] flex-col overflow-y-auto border-r border-edge">
          {steps.map((s, i) => {
            const q = s.query!;
            const priorParams = steps.slice(0, i).flatMap((ps, pi) => (ps.query?.params ?? []).map((p) => `step_${pi + 1}.${p.name}`));
            return (
              <div key={i} className="border-b border-edge p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="mono rounded-sm bg-panel-2 px-1.5 py-0.5 text-[10px]">STEP {i + 1}</span>
                  <Link href={`/queries/${q.id}`} className="mono text-xs text-[var(--accent-hi)] hover:underline">{q.tag}</Link>
                  <span className="truncate text-[11px] text-ink-dim">{q.title}</span>
                  <RiskBadge level={q.risk_level} />
                  <span className="flex-1" />
                  {editable && (
                    <>
                      <button className="btn px-1.5" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move step up">↑</button>
                      <button className="btn px-1.5" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move step down">↓</button>
                      <button className="btn px-1.5" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Remove step">✕</button>
                    </>
                  )}
                </div>
                {editable ? (
                  <input
                    className="mb-2 w-full bg-transparent text-[11px] text-ink-dim outline-none placeholder:text-ink-faint"
                    placeholder="Step note…"
                    value={s.note ?? ''}
                    onChange={(e) => { const next = [...steps]; next[i] = { ...s, note: e.target.value }; setSteps(next); setDirty(true); }}
                  />
                ) : (
                  s.note && <div className="mb-2 text-[11px] text-ink-dim">{s.note}</div>
                )}

                {view === 'build' ? (
                  (q.params ?? []).length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-widest text-ink-faint">Parameter mapping (source → target)</div>
                      {(q.params ?? []).map((p) => (
                        <div key={p.name} className="flex items-center gap-2 text-[11px]">
                          <select
                            className="input mono w-48"
                            disabled={!editable}
                            value={s.param_bindings[p.name]?.source ?? ''}
                            onChange={(e) => setBinding(i, p.name, e.target.value)}
                            aria-label={`Source for ${p.name}`}
                          >
                            <option value="">manual entry at run time</option>
                            {priorParams.map((src) => <option key={src} value={src}>{src}</option>)}
                          </select>
                          <span className="text-ink-faint">→</span>
                          <span className="mono text-[var(--accent-hi)]">:{p.name}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="space-y-1.5">
                    {(q.params ?? []).map((p) => {
                      const bound = s.param_bindings[p.name]?.source;
                      return (
                        <label key={p.name} className="flex items-center gap-2 text-[11px]">
                          <span className="mono w-36 shrink-0 text-[var(--accent-hi)]">:{p.name}</span>
                          <input
                            className="input mono"
                            type={p.data_type === 'number' ? 'number' : p.data_type === 'date' ? 'date' : 'text'}
                            placeholder={bound ? `from ${bound} (override here)` : 'paste the value from your external run'}
                            value={values[i + 1]?.[p.name] ?? ''}
                            onChange={(e) => setValues({ ...values, [i + 1]: { ...values[i + 1], [p.name]: e.target.value } })}
                          />
                          {bound && effectiveValue(i + 1, p.name) !== (values[i + 1]?.[p.name] ?? '') && (
                            <span className="mono shrink-0 text-[10px] text-[var(--risk-safe)]" title={`carried from ${bound}`}>⇐ {effectiveValue(i + 1, p.name)}</span>
                          )}
                        </label>
                      );
                    })}
                    {(q.params ?? []).length === 0 && <div className="text-[11px] text-ink-faint">No parameters.</div>}
                  </div>
                )}
              </div>
            );
          })}
          {editable && (
            <div className="p-3">
              {steps.length === 0 && (
                <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
                  Build the chain: add each query in run order (public or from your private dictionary). After adding a
                  step, you can map its parameters to values from earlier steps — then Save.
                </p>
              )}
              {pickerOpen ? (
                <div className="rounded-sm border border-edge">
                  <input className="input border-0 border-b border-edge" placeholder="Search public + your private queries…" autoFocus value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} />
                  <div className="max-h-48 overflow-y-auto">
                    {pickerResults.map((q) => (
                      <button key={q.id} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-panel-2" onClick={() => addStep(q)}>
                        <span className="mono text-[var(--accent-hi)]">{q.tag}</span>
                        <span className="flex-1 truncate text-ink-dim">{q.title}</span>
                        <span className="text-[10px] uppercase text-ink-faint">{q.is_public ? 'public' : 'private'}</span>
                        <RiskBadge level={q.risk_level} compact />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button className="btn" onClick={() => setPickerOpen(true)}>+ Add step</button>
              )}
            </div>
          )}
          {steps.length === 0 && !editable && <div className="p-4 text-xs text-ink-faint">No steps.</div>}
        </div>

        {/* Resolved script preview */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-ink-faint">Resolved ordered script — the workflow’s output (§2.10)</span>
            <button className="btn btn-primary" onClick={copyScript}>⧉ Copy</button>
          </div>
          <pre className="mono flex-1 overflow-auto whitespace-pre-wrap bg-bg p-3 text-xs leading-5">{resolvedScript}</pre>
        </div>
      </div>

      {dialogs}
      {shareOpen && (
        <ShareDialog
          itemLabel={wf.tag}
          onClose={() => setShareOpen(false)}
          onShare={async (ids) => {
            const r = await fetch(`/api/workflows/${id}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to_user_ids: ids }) });
            flash(r.ok ? 'Workflow shared (steps included as copies).' : (await r.json()).error ?? 'Share failed');
          }}
        />
      )}
    </div>
  );
}
