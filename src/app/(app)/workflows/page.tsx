'use client';

import { useState } from 'react';
import ItemList, { useItemList, type ListItem } from '@/components/ItemList';
import CreateItemDialog from '@/components/CreateItemDialog';
import CategoryFilterSelect from '@/components/CategoryFilterSelect';

export default function WorkflowsPage() {
  const [scope, setScope] = useState<'private' | 'public'>('private');
  const [createOpen, setCreateOpen] = useState(false);
  const [category, setCategory] = useState('');
  const { q, setQ, items, loading, toggleFavorite } = useItemList(async (q) => {
    const params = new URLSearchParams({ scope, q });
    if (category) params.set('category', category);
    const r = await fetch(`/api/workflows?${params}`);
    const d = await r.json();
    return (d.workflows ?? []).map((x: any) => ({ ...x, kind: 'workflow' }) as ListItem);
  }, `workflows:${scope}:${category}`);

  return (
    <div className="flex h-full flex-col" key={`${scope}-${category}`}>
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">Workflows</h1>
        <div className="mono flex rounded-sm border border-edge text-[11px]">
          {(['private', 'public'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-2 py-0.5 ${scope === s ? 'bg-panel-2 text-ink' : 'text-ink-faint'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <input className="input max-w-md" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter workflows" />
        <CategoryFilterSelect scope={scope} value={category} onChange={setCategory} />
        <span className="flex-1" />
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New workflow</button>
      </header>
      <ItemList items={items} loading={loading} onToggleFavorite={toggleFavorite} emptyText="No workflows yet — chain queries into a repeatable, exportable script." />
      {createOpen && <CreateItemDialog kind="workflow" onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
