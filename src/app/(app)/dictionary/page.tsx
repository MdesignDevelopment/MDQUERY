'use client';

import { useState } from 'react';
import ItemList, { useItemList, type ListItem } from '@/components/ItemList';
import CreateItemDialog from '@/components/CreateItemDialog';

export default function PrivateDictionaryPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { q, setQ, items, loading, toggleFavorite } = useItemList(async (q) => {
    const r = await fetch(`/api/queries?scope=private&q=${encodeURIComponent(q)}`);
    const d = await r.json();
    return (d.queries ?? []).map((x: any) => ({ ...x, kind: 'query' }) as ListItem);
  }, 'dictionary');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">My Private Dictionary</h1>
        <span className="badge border border-edge text-ink-faint">private</span>
        <input
          className="input max-w-md"
          placeholder="Filter by tag, title, body…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter private queries"
        />
        <span className="flex-1" />
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New query</button>
      </header>
      <ItemList items={items} loading={loading} onToggleFavorite={toggleFavorite} emptyText="No private queries yet — create one or clone from the Public Dictionary." />
      {createOpen && <CreateItemDialog kind="query" onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
