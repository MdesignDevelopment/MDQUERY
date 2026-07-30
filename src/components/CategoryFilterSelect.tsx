'use client';

import { useEffect, useState } from 'react';

interface Category {
  id: number;
  name: string;
  is_public: boolean;
}

/** Category filter dropdown for list pages — populated from the categories available in the given scope. */
export default function CategoryFilterSelect({ scope, value, onChange }: {
  scope: 'private' | 'public' | 'all';
  value: string;
  onChange: (v: string) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch(`/api/categories?scope=${scope}`).then((r) => r.json()).then((d) => setCategories(d.categories ?? []));
  }, [scope]);

  return (
    <select className="input w-auto shrink-0" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by category">
      <option value="">All categories</option>
      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
