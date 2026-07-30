'use client';

import { useState } from 'react';
import ItemList, { useItemList, type ListItem } from '@/components/ItemList';
import CategoryFilterSelect from '@/components/CategoryFilterSelect';

export default function PublicDictionaryPage() {
  const [dept, setDept] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('recent');
  const { q, setQ, items, loading, toggleFavorite } = useItemList(async (q) => {
    const params = new URLSearchParams({ scope: 'public', q, sort });
    if (dept) params.set('department', dept);
    if (category) params.set('category', category);
    const r = await fetch(`/api/queries?${params}`);
    const d = await r.json();
    return (d.queries ?? []).map((x: any) => ({ ...x, kind: 'query' }) as ListItem);
  }, `public:${dept}:${category}:${sort}`);

  return (
    <div className="flex h-full flex-col" key={`${dept}-${category}-${sort}`}>
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">Public Dictionary</h1>
        <span className="badge border border-edge text-ink-faint">company-wide · curated</span>
        <input className="input max-w-md" placeholder="Search by tag, title, body…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search public queries" />
        <span className="flex-1" />
        <CategoryFilterSelect scope="public" value={category} onChange={setCategory} />
        <select className="input w-auto shrink-0" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          <option>Dev</option>
          <option>Support</option>
          <option>Data</option>
        </select>
        <select className="input w-auto shrink-0" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="recent">Recent</option>
          <option value="popular">Popular</option>
          <option value="tag">Tag A–Z</option>
        </select>
      </header>
      <ItemList items={items} loading={loading} onToggleFavorite={toggleFavorite} emptyText="No public queries match." />
    </div>
  );
}
