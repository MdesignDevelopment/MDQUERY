'use client';

import { useEffect, useState } from 'react';
import { useDialogs } from './Dialogs';
import { getCache, setCache } from '@/lib/clientCache';

interface Category {
  id: number;
  name: string;
  is_public: boolean;
}

/**
 * Category assignment control for a query/workflow's meta bar. Public items
 * may only use public categories; private items may use their owner's own
 * private categories or any public one — mirrors the server-side rule in
 * resolveCategoryId (§ store.ts).
 *
 * The current selection is known instantly (the parent already has it from
 * the query/workflow it just loaded), but the *list* of assignable categories
 * needs its own round trip. Without `currentName`, a controlled <select>
 * would show nothing until that fetch lands and finally contains a matching
 * <option> — e.g. "Support" flashing to blank on every page load, purely a
 * loading-order artifact, not the value actually changing. Rendering a
 * synthetic option for the current value up front closes that gap; the
 * client-side cache closes it for repeat visits within the session too.
 */
export default function CategoryPicker({ value, currentName, onChange, isPublicTarget, disabled }: {
  value: number | null;
  currentName?: string | null;
  onChange: (id: number | null) => void;
  isPublicTarget: boolean;
  disabled?: boolean;
}) {
  const cacheKey = `/api/categories?scope=${isPublicTarget ? 'public' : 'all'}`;
  const [categories, setCategories] = useState<Category[]>(() => getCache<Category[]>(cacheKey) ?? []);
  const [error, setError] = useState('');
  const { promptText, dialogs } = useDialogs();

  async function load() {
    const r = await fetch(cacheKey);
    const d = await r.json();
    const list = d.categories ?? [];
    setCategories(list);
    setCache(cacheKey, list);
  }

  useEffect(() => { load(); }, [isPublicTarget]);

  async function handleChange(raw: string) {
    if (raw === '__new__') {
      const name = await promptText({
        title: isPublicTarget ? 'New public category' : 'New category',
        message: isPublicTarget ? 'Visible platform-wide, usable by any public entry.' : 'Private to you — usable across your own dictionary, or promote it to public later by asking a curator.',
        label: 'Category name',
        placeholder: 'e.g. Sheath cleanup',
        minLength: 1,
        confirmLabel: 'Create',
      });
      if (!name) return;
      const r = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, is_public: isPublicTarget }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? 'Failed to create category');
        setTimeout(() => setError(''), 4000);
        return;
      }
      await load();
      onChange(d.category.id);
      return;
    }
    onChange(raw === '' ? null : Number(raw));
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        className="input w-auto shrink-0"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Category"
        title="Category"
      >
        <option value="">— no category —</option>
        {value != null && !categories.some((c) => c.id === value) && (
          <option value={value}>{currentName ?? '…'}</option>
        )}
        {categories.filter((c) => !c.is_public).length > 0 && (
          <optgroup label="My categories">
            {categories.filter((c) => !c.is_public).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        )}
        {categories.filter((c) => c.is_public).length > 0 && (
          <optgroup label="Public categories">
            {categories.filter((c) => c.is_public).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        )}
        {!disabled && <option value="__new__">+ New category…</option>}
      </select>
      {error && <span className="text-[11px]" style={{ color: 'var(--risk-high)' }} role="alert">{error}</span>}
      {dialogs}
    </span>
  );
}
