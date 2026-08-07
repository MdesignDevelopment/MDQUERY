'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Editor from './Editor';
import ValidationPanel from './ValidationPanel';
import FormMode from './FormMode';
import DocumentationEditor from './DocumentationEditor';
import AiSidebar from './AiSidebar';
import DiffView from './DiffView';
import RiskBadge from './RiskBadge';
import ShareDialog from './ShareDialog';
import ConfirmSaveDialog from './ConfirmSaveDialog';
import CategoryPicker from './CategoryPicker';
import { SkeletonWorkspace } from './Skeleton';
import { useDialogs } from './Dialogs';
import { validateSql } from '@/lib/validation';
import { fetchJsonCached, getCache, setCache } from '@/lib/clientCache';
import type { LintFinding, QueryRow, User, ValidationResult } from '@/lib/types';

export default function QueryWorkspace({ id, user }: { id: number; user: User }) {
  const router = useRouter();
  const [q, setQ] = useState<QueryRow | null>(null);
  const [sourceUpdate, setSourceUpdate] = useState<{ source_id: number; source_body: string } | null>(null);
  const [body, setBody] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [meta, setMeta] = useState<{ tag: string; title: string; description: string; client_label: string; category_id: number | null; category_name: string | null }>({ tag: '', title: '', description: '', client_label: '', category_id: null, category_name: null });
  const [mode, setMode] = useState<'editor' | 'form' | 'documentation'>('editor');
  const [findings, setFindings] = useState<LintFinding[]>([]);
  const [risk, setRisk] = useState<QueryRow['risk_level']>('safe');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docDirty, setDocDirty] = useState(false);
  const [docSaving, setDocSaving] = useState(false);
  const [confirmNeeded, setConfirmNeeded] = useState<{ missing: string[]; findings: LintFinding[] } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionBodies, setVersionBodies] = useState<Record<number, string>>({});
  const [showSourceDiff, setShowSourceDiff] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [exportTarget, setExportTarget] = useState<'sqldev' | 'sqlplus'>('sqldev');

  const { confirm, promptText, dialogs } = useDialogs();
  const isCurator = user.role === 'curator' || user.role === 'admin';
  const editable = q ? (!q.is_public ? q.owner_id === user.id : isCurator) : false;

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    const url = `/api/queries/${id}`;
    const applyData = (d: any) => {
      setQ(d.query);
      setSourceUpdate(d.source_update);
      setBody(d.query.body);
      setDocumentation(d.query.documentation ?? '');
      setMeta({ tag: d.query.tag, title: d.query.title, description: d.query.description ?? '', client_label: d.query.client_label ?? '', category_id: d.query.category_id ?? null, category_name: d.query.category_name ?? null });
      setRisk(d.query.risk_level);
      setDirty(false);
      setDocDirty(false);
    };
    // Stale-while-revalidate: paint cached data instantly (warmed by row-hover
    // prefetch), then refresh from the server in the background.
    const cached = getCache<any>(url);
    if (cached?.query) applyData(cached);
    try {
      const d = await fetchJsonCached<any>(url);
      if (d.error) {
        if (!cached) setNotice(d.error);
        return;
      }
      // Don't clobber edits the user started while revalidating
      if (!cached || !dirtyRef.current) applyData(d);
    } catch {
      if (!cached) setNotice('Failed to load');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Live static validation while typing — runs entirely in the browser (the
  // linter is pure TS), so there's zero network per keystroke. The server
  // re-runs the same rules authoritatively on save.
  useEffect(() => {
    if (q == null) return;
    const t = setTimeout(() => {
      const v = validateSql(body);
      setFindings(v.findings);
      setRisk(v.risk_level);
    }, 150);
    return () => clearTimeout(t);
  }, [body, q]);

  function flash(msg: string, isError = false) {
    setNotice(msg);
    setNoticeIsError(isError);
    setTimeout(() => setNotice(''), isError ? 6000 : 2500);
  }

  const save = useCallback(async (confirmations: string[] = [], changeSource: 'manual' | 'ai' = 'manual') => {
    if (!editable || saving) return;
    setSaving(true);
    try {
      let r: Response;
      try {
        r = await fetch(`/api/queries/${id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...meta,
            client_label: meta.client_label || null,
            body,
            confirmations,
            change_source: changeSource,
            params: q?.params?.map((p) => ({ name: p.name, data_type: p.data_type, default_value: p.default_value, label: p.label, enum_options: p.enum_options, is_list: p.is_list })),
          }),
        });
      } catch {
        flash('Save failed — network error. Your edits are still here; try again.', true);
        return;
      }
      let d: any;
      try {
        d = await r.json();
      } catch {
        flash(`Save failed — unexpected server response (${r.status}). Your edits are still here; try again.`, true);
        return;
      }
      if (r.status === 409 && d.missing) {
        setConfirmNeeded({ missing: d.missing, findings: d.validation?.findings ?? [] });
        return;
      }
      if (!r.ok) {
        flash(d.error ?? 'Save failed', true);
        if (d.validation) setFindings(d.validation.findings);
        return;
      }
      setQ(d.query);
      setRisk(d.query.risk_level);
      setDirty(false);
      setCache(`/api/queries/${id}`, { query: d.query, source_update: null });
      flash('Saved ✓ (version recorded)');
    } finally {
      setSaving(false);
    }
  }, [editable, saving, id, meta, body, q]);

  const saveDocumentation = useCallback(async () => {
    if (!isCurator || docSaving) return;
    setDocSaving(true);
    try {
      const r = await fetch(`/api/queries/${id}/documentation`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentation }),
      });
      const d = await r.json();
      if (!r.ok) {
        flash(d.error ?? 'Save failed', true);
        return;
      }
      setQ(d.query);
      setDocumentation(d.query.documentation ?? '');
      setDocDirty(false);
      setCache(`/api/queries/${id}`, { query: d.query, source_update: sourceUpdate });
      flash('Documentation saved ✓');
    } finally {
      setDocSaving(false);
    }
  }, [isCurator, docSaving, id, documentation, sourceUpdate]);

  async function uploadDocumentationImage(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const r = await fetch(`/api/queries/${id}/documentation/images`, { method: 'POST', body: form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? 'Image upload failed');
    return d.url as string;
  }

  const saveRef = useRef(save);
  saveRef.current = save;

  async function toggleFavorite() {
    if (!q) return;
    setQ({ ...q, favorited: !q.favorited });
    await fetch('/api/favorites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_type: 'query', item_id: q.id }) });
  }

  async function copyBody() {
    await navigator.clipboard.writeText(body);
    flash('Copied raw query to clipboard');
  }

  async function clone() {
    const r = await fetch(`/api/queries/${id}/clone`, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) return flash(d.error ?? 'Clone failed', true);
    router.push(`/queries/${d.query.id}`);
  }

  async function del() {
    if (!q) return;
    const ok = await confirm({
      title: `Delete ${q.is_public ? 'public entry' : 'private query'} "${q.tag}"?`,
      message: 'Its full version history is deleted with it. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/queries/${id}`, { method: 'DELETE' });
    if (r.ok) router.push(q.is_public ? '/public' : '/dictionary');
    else flash((await r.json()).error ?? 'Delete failed', true);
  }

  async function proposePromotion() {
    if (!q) return;
    if (dirty) return flash('Save your changes first, then promote.', true);
    const r = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_type: 'query', item_id: q.id, request_type: 'new_promotion' }),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error ?? 'Failed', true);
    flash('Promotion request submitted — a peer reviewer or curator must approve it.');
  }

  async function proposeEdit() {
    if (!q) return;
    const r = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item_type: 'query', item_id: q.id, request_type: 'update', target_public_id: q.id,
        proposed: { tag: meta.tag, title: meta.title, description: meta.description, body, department: q.department },
      }),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error ?? 'Failed', true);
    flash('Proposed edit submitted for review — the public entry is unchanged until approved.');
    setBody(q.body); // revert local buffer to published state
    setDirty(false);
  }

  async function flagStale() {
    const note = await promptText({
      title: 'Flag as possibly stale',
      message: 'The entry stays published — this adds an amber badge and puts it in the curators’ review queue.',
      label: 'What looks stale, and why?',
      placeholder: 'e.g. client renamed this column on the last engagement',
      multiline: true,
      minLength: 5,
      confirmLabel: 'Flag entry',
    });
    if (!note) return;
    const r = await fetch(`/api/queries/${id}/flag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'flag', note }) });
    if (r.ok) { flash('Flagged for curator attention (entry stays published).'); load(); }
    else flash((await r.json()).error ?? 'Failed', true);
  }

  async function resolveStale() {
    const ok = await confirm({
      title: 'Clear the stale flag?',
      message: `Current note: “${q?.stale_note ?? ''}”\n\nClearing means you've reviewed the concern and consider the entry fine.`,
      confirmLabel: 'Clear flag',
    });
    if (!ok) return;
    const r = await fetch(`/api/queries/${id}/flag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resolve' }) });
    if (r.ok) { flash('Stale flag cleared.'); load(); }
  }

  async function openVersions() {
    const r = await fetch(`/api/queries/${id}/versions`);
    const d = await r.json();
    setVersions(d.versions ?? []);
    setVersionsOpen(true);
  }

  /** Lazy-load one version's body the first time its row is expanded. */
  async function loadVersionBody(vid: number) {
    if (versionBodies[vid] !== undefined) return;
    const r = await fetch(`/api/queries/${id}/versions/${vid}`);
    if (!r.ok) return;
    const d = await r.json();
    setVersionBodies((prev) => ({ ...prev, [vid]: d.body_snapshot }));
  }

  async function restoreVersion(vid: number) {
    const r = await fetch(`/api/queries/${id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version_id: vid }) });
    const d = await r.json();
    if (r.status === 409 && d.missing) {
      flash('That version contains high-risk statements — open it, review, and save with confirmation.', true);
      return;
    }
    if (!r.ok) return flash(d.error ?? 'Restore failed', true);
    setVersionsOpen(false);
    load();
    flash('Version restored (recorded as a new version).');
  }

  if (!q) {
    if (notice) return <div className="p-6 text-xs text-ink-faint">{notice}</div>;
    return <SkeletonWorkspace />;
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Breadcrumb + dictionary indicator (§2.8) */}
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-1.5 text-[11px]">
        <Link href={q.is_public ? '/public' : '/dictionary'} className="text-ink-faint hover:text-ink">
          {q.is_public ? 'Public Dictionary' : 'My Private Dictionary'}
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="mono text-[var(--accent-hi)]">{q.tag}</span>
        <span
          className="badge"
          style={q.is_public
            ? { color: 'var(--accent-hi)', border: '1px solid var(--accent)', background: 'rgba(14,99,156,.15)' }
            : { color: 'var(--ink-dim)', border: '1px solid var(--edge)' }}
        >
          {q.is_public ? '⌸ PUBLIC — curated' : '⌂ PRIVATE — yours'}
        </span>
        {q.flagged_stale && (
          <span className="badge" style={{ color: 'var(--risk-warn)', border: '1px solid var(--risk-warn)', background: 'rgba(215,186,125,.12)' }} title={q.stale_note ?? ''}>
            ⚠ possibly stale{q.stale_note ? ` — ${q.stale_note}` : ''}
          </span>
        )}
        <RiskBadge level={risk} />
        <span className="flex-1" />
        {notice && <span style={{ color: noticeIsError ? 'var(--risk-high)' : 'var(--risk-safe)' }}>{notice}</span>}
      </div>

      {/* Meta + actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-panel px-4 py-2">
        <input className="input mono w-44" value={meta.tag} disabled={!editable} onChange={(e) => { setMeta({ ...meta, tag: e.target.value }); setDirty(true); }} aria-label="Tag" title="Tag — the primary identifier; renaming never breaks history or favorites" />
        <input className="input w-56" value={meta.title} disabled={!editable} onChange={(e) => { setMeta({ ...meta, title: e.target.value }); setDirty(true); }} aria-label="Title" placeholder="Title" />
        {!q.is_public && (
          <input className="input mono w-32" value={meta.client_label} disabled={!editable} onChange={(e) => { setMeta({ ...meta, client_label: e.target.value }); setDirty(true); }} aria-label="Client/engagement label" placeholder="client label" title="Organizational tag only — no connection or credentials attached" />
        )}
        <CategoryPicker
          value={meta.category_id}
          currentName={meta.category_name}
          isPublicTarget={q.is_public}
          disabled={!editable}
          onChange={(category_id) => { setMeta({ ...meta, category_id }); setDirty(true); }}
        />
        <span className="flex-1" />
        <button className={`btn ${q.favorited ? 'text-[var(--risk-warn)]' : ''}`} onClick={toggleFavorite} title="Star / unstar" aria-label="Toggle favorite">★</button>
        <button className="btn" onClick={copyBody} title="Copy raw query body">⧉ Copy</button>
        <span className="flex items-stretch">
          <a className="btn whitespace-nowrap rounded-r-none" href={`/api/queries/${id}/export?target=${exportTarget}`} title="Export annotated .sql">⭳ Export .sql</a>
          <select className="input w-auto rounded-l-none border-l-0" value={exportTarget} onChange={(e) => setExportTarget(e.target.value as any)} aria-label="Export format target">
            <option value="sqldev">SQL Developer</option>
            <option value="sqlplus">SQL*Plus</option>
          </select>
        </span>
        {q.is_public ? (
          <>
            <button className="btn btn-primary" onClick={clone} title="Copy into your private dictionary, keeping a link to this source">⎘ Clone to my dictionary</button>
            {!isCurator && dirty && <button className="btn" onClick={proposeEdit} title="Submit your edit for curator/peer approval">⇪ Propose edit</button>}
            {!q.flagged_stale && <button className="btn" onClick={flagStale} title="Flag as possibly stale">⚠ Flag</button>}
            {q.flagged_stale && isCurator && <button className="btn" onClick={resolveStale}>✓ Resolve flag</button>}
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setShareOpen(true)} title="Share a copy with a colleague" aria-label="Share">⇉ Share</button>
            <button className="btn" onClick={proposePromotion} title="Propose adding this to the Public Dictionary">⇪ Promote</button>
          </>
        )}
        <button className="btn" onClick={openVersions} title="Version history">⟲ History</button>
        {(editable || (!q.is_public && q.owner_id === user.id)) && (
          <button className="btn" onClick={del} title="Delete" aria-label="Delete query">🗑</button>
        )}
        {editable && (
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => save()} title="Save (Ctrl+S) — runs full validation">
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
        <button className="btn" onClick={() => setAiOpen(!aiOpen)} title="Toggle AI copilot" aria-label="Toggle AI copilot">✦</button>
      </div>

      {/* Public-source drift prompt (§2.1) */}
      {sourceUpdate && (
        <div className="border-b px-4 py-1.5 text-[11px]" style={{ borderColor: 'var(--accent)', background: 'rgba(14,99,156,.08)' }}>
          ↻ The public source of this clone has been updated since you cloned it.
          <button className="ml-2 underline" onClick={() => setShowSourceDiff(!showSourceDiff)}>{showSourceDiff ? 'Hide changes' : 'Review changes'}</button>
          <button className="ml-2 underline" onClick={async () => { await fetch(`/api/queries/${id}/mark-source-reviewed`, { method: 'POST' }); setSourceUpdate(null); setShowSourceDiff(false); }}>
            Mark reviewed
          </button>
          {showSourceDiff && (
            <div className="mt-2 pb-1">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">your clone → current public version</div>
              <DiffView oldText={body} newText={sourceUpdate.source_body} />
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Editor / Form mode tabs (§2.2) */}
          <div className="flex border-b border-edge bg-panel">
            <button className={`px-3 py-1 text-[11px] ${mode === 'editor' ? 'border-b-2 border-[var(--accent)] text-ink' : 'text-ink-faint'}`} onClick={() => setMode('editor')}>
              Editor
            </button>
            <button className={`px-3 py-1 text-[11px] ${mode === 'form' ? 'border-b-2 border-[var(--accent)] text-ink' : 'text-ink-faint'}`} onClick={() => setMode('form')}>
              Form {q.params && q.params.length > 0 && <span className="mono">({q.params.length})</span>}
            </button>
            <button className={`px-3 py-1 text-[11px] ${mode === 'documentation' ? 'border-b-2 border-[var(--accent)] text-ink' : 'text-ink-faint'}`} onClick={() => setMode('documentation')}>
              Documentation
            </button>
            {!editable && <span className="ml-auto px-3 py-1 text-[10px] text-ink-faint">read-only{q.is_public && !isCurator ? ' — edits become proposals' : ''}</span>}
          </div>

          {mode === 'editor' ? (
            <div className="min-h-0 flex-1">
              <Editor
                value={body}
                onChange={(v) => { setBody(v); setDirty(true); }}
                findings={findings}
                readOnly={!editable && !(q.is_public && !isCurator)}
                onSave={() => saveRef.current()}
              />
            </div>
          ) : mode === 'form' ? (
            <FormMode
              body={body}
              params={q.params ?? []}
              values={formValues}
              onValues={setFormValues}
              onCopyResolved={() => flash('Copied resolved query (values substituted)')}
              onVariableTypeChange={editable ? (name, dataType, isList) => {
                setQ({ ...q, params: q.params?.map((p) => (p.name === name ? { ...p, data_type: dataType, is_list: isList } : p)) });
                setDirty(true);
              } : undefined}
            />
          ) : (
            <DocumentationEditor
              value={documentation}
              onChange={(html) => { setDocumentation(html); setDocDirty(true); }}
              editable={isCurator}
              onUploadImage={uploadDocumentationImage}
              dirty={docDirty}
              saving={docSaving}
              onSave={saveDocumentation}
            />
          )}

          {mode !== 'documentation' && <ValidationPanel findings={findings} />}
        </div>

        {aiOpen && <AiSidebar body={body} editable={editable || (q.is_public && !isCurator)} onApply={(nb) => { setBody(nb); setDirty(true); }} />}
      </div>

      {/* Description strip */}
      <div className="border-t border-edge bg-panel px-4 py-1.5">
        <input
          className="w-full bg-transparent text-[11px] text-ink-dim outline-none placeholder:text-ink-faint"
          placeholder="Description — what this query is for, and any caveats…"
          value={meta.description}
          disabled={!editable}
          onChange={(e) => { setMeta({ ...meta, description: e.target.value }); setDirty(true); }}
          aria-label="Description"
        />
      </div>

      {dialogs}
      {confirmNeeded && (
        <ConfirmSaveDialog
          missing={confirmNeeded.missing}
          findings={confirmNeeded.findings}
          onCancel={() => setConfirmNeeded(null)}
          onConfirm={(c) => { setConfirmNeeded(null); save(c); }}
        />
      )}
      {shareOpen && (
        <ShareDialog
          itemLabel={q.tag}
          onClose={() => setShareOpen(false)}
          onShare={async (ids) => {
            const r = await fetch(`/api/queries/${id}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to_user_ids: ids }) });
            if (r.ok) flash('Shared — recipients will find it in their inbox.');
            else flash((await r.json()).error ?? 'Share failed', true);
          }}
        />
      )}
      {versionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setVersionsOpen(false)}>
          <div className="max-h-[70vh] w-[680px] overflow-y-auto rounded-md border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">Version history — <span className="mono text-[var(--accent-hi)]">{q.tag}</span></h2>
            {versions.map((v, i) => (
              <details key={v.id} className="mb-1 rounded-sm border border-edge" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadVersionBody(v.id); }}>
                <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[11px]">
                  <span className="mono text-ink-faint">#{versions.length - i}</span>
                  <span>{new Date(v.changed_at).toLocaleString()}</span>
                  <span className="text-ink-faint">by {v.changed_by_name ?? '—'}</span>
                  <span className="badge border border-edge text-ink-faint">{v.change_source}</span>
                  <RiskBadge level={v.risk_level} />
                  <span className="flex-1" />
                  {editable && i > 0 && (
                    <button className="btn" onClick={(e) => { e.preventDefault(); restoreVersion(v.id); }}>Restore</button>
                  )}
                </summary>
                <div className="border-t border-edge p-2">
                  {versionBodies[v.id] !== undefined ? (
                    <>
                      <DiffView oldText={versionBodies[v.id]} newText={body} />
                      <div className="mt-1 text-[10px] text-ink-faint">diff: this version → current buffer</div>
                    </>
                  ) : (
                    <div className="animate-pulse py-2 text-[11px] text-ink-faint">Loading version…</div>
                  )}
                </div>
              </details>
            ))}
            {versions.length === 0 && <div className="text-xs text-ink-faint">No versions recorded.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
