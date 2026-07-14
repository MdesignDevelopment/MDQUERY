'use client';

import ItemList, { useItemList, type ListItem } from '@/components/ItemList';

export default function FavoritesPage() {
  const { q, setQ, items, loading, toggleFavorite } = useItemList(async (q) => {
    const r = await fetch(`/api/favorites?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    return (d.items ?? []) as ListItem[];
  }, 'favorites');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">Favorites</h1>
        <input className="input max-w-md" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter favorites" />
      </header>
      <ItemList items={items} loading={loading} onToggleFavorite={toggleFavorite} emptyText="Nothing starred yet — hit ★ on any query or workflow." />
    </div>
  );
}
