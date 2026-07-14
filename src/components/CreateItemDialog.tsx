'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateTag } from '@/lib/params';

/** Turn a title into a tag suggestion: "Delete a sheath" → "delete-a-sheath". */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Creation dialog for queries and workflows: title first, tag auto-suggested
 * (editable), live tag validation, inline server errors (e.g. tag already in
 * use) instead of browser prompt/alert.
 */
export default function CreateItemDialog({ kind, onClose }: { kind: 'query' | 'workflow'; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('');
  const [tagTouched, setTagTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [clientLabel, setClientLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveTag = tagTouched ? tag : slugify(title);
  const tagError = effectiveTag ? validateTag(effectiveTag) : null;
  const ready = title.trim().length > 0 && effectiveTag.length > 0 && !tagError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    const r = await fetch(kind === 'workflow' ? '/api/workflows' : '/api/queries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag: effectiveTag,
        title: title.trim(),
        description: description.trim(),
        client_label: clientLabel.trim() || null,
        ...(kind === 'query' ? { body: '' } : {}),
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error ?? 'Creation failed.');
      setBusy(false);
      return;
    }
    const id = kind === 'workflow' ? d.workflow.id : d.query.id;
    router.push(kind === 'workflow' ? `/workflows/${id}` : `/queries/${id}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form className="w-[460px] rounded-md border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="mb-1 text-sm font-semibold">New {kind}</h2>
        <p className="mb-3 text-[11px] text-ink-faint">
          {kind === 'workflow'
            ? 'A workflow is an ordered chain of queries from your dictionary — you add and map the steps in the builder next.'
            : 'Created in your private dictionary — you write the SQL in the editor next.'}
        </p>

        <label className="mb-2 block text-xs">
          <span className="mb-1 block text-ink-dim">Title</span>
          <input
            className="input"
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'workflow' ? 'e.g. Delete a sheath (full cleanup)' : 'e.g. Check feature associations'}
          />
        </label>

        <label className="mb-2 block text-xs">
          <span className="mb-1 flex items-center justify-between text-ink-dim">
            <span>Tag <span className="text-ink-faint">— the unique identifier used in search</span></span>
            {!tagTouched && effectiveTag && <span className="text-[10px] text-ink-faint">auto from title</span>}
          </span>
          <input
            className="input mono"
            value={effectiveTag}
            onChange={(e) => { setTag(e.target.value); setTagTouched(true); }}
            placeholder="letters-digits-hyphens_underscores"
            aria-invalid={!!tagError}
          />
          {tagError && <span className="mt-1 block text-[11px]" style={{ color: 'var(--risk-high)' }}>{tagError}</span>}
        </label>

        <label className="mb-2 block text-xs">
          <span className="mb-1 block text-ink-dim">Description <span className="text-ink-faint">(optional)</span></span>
          <textarea
            className="input h-14 resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What it's for, and any caveats…"
          />
        </label>

        <label className="mb-3 block text-xs">
          <span className="mb-1 block text-ink-dim">Client / engagement label <span className="text-ink-faint">(optional — metadata only, no connection)</span></span>
          <input className="input mono" value={clientLabel} onChange={(e) => setClientLabel(e.target.value)} placeholder="e.g. mro-genk-01" />
        </label>

        {error && (
          <div className="mb-3 rounded-sm border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)', background: 'rgba(241,76,76,.06)' }} role="alert">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={!ready || busy}>
            {busy ? 'Creating…' : kind === 'workflow' ? 'Create & open builder' : 'Create & open editor'}
          </button>
        </div>
      </form>
    </div>
  );
}
