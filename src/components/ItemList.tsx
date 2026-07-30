'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import RiskBadge from './RiskBadge';
import { SkeletonRows } from './Skeleton';
import { getCache, prefetchJson, setCache } from '@/lib/clientCache';
import type { RiskLevel } from '@/lib/types';

export interface ListItem {
  id: number;
  kind: 'query' | 'workflow';
  tag: string;
  title: string;
  description?: string;
  department?: string | null;
  client_label?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  risk_level?: RiskLevel;
  is_public: boolean;
  flagged_stale?: boolean;
  favorited?: boolean;
  owner_name?: string | null;
  shared_from?: unknown;
  source_query_id?: number | null;
  step_count?: number;
  updated_at?: string;
}

/**
 * File-explorer-style list (§3): favorites pinned on top in their own section
 * (§2.7), compact rows, tags rendered like file labels.
 */
export default function ItemList({ items, onToggleFavorite, emptyText, loading }: {
  items: ListItem[];
  onToggleFavorite: (item: ListItem) => void;
  emptyText: string;
  loading?: boolean;
}) {
  const favs = items.filter((i) => i.favorited);
  const rest = items.filter((i) => !i.favorited);

  if (loading && items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <SkeletonRows rows={9} />
      </div>
    );
  }

  const Row = ({ item }: { item: ListItem }) => (
    <div
      className="group flex items-center gap-2 border-b border-edge px-3 py-1.5 hover:bg-panel-2"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '32px' } as React.CSSProperties}
      onMouseEnter={() => prefetchJson(item.kind === 'workflow' ? `/api/workflows/${item.id}` : `/api/queries/${item.id}`)}
    >
      <button
        onClick={() => onToggleFavorite(item)}
        className={item.favorited ? 'text-[var(--risk-warn)]' : 'text-ink-faint opacity-40 hover:opacity-100'}
        title={item.favorited ? 'Unstar' : 'Star'}
        aria-label={item.favorited ? `Remove ${item.tag} from favorites` : `Add ${item.tag} to favorites`}
      >
        ★
      </button>
      <span className="text-ink-faint">{item.kind === 'workflow' ? '⛓' : '≡'}</span>
      <Link
        href={item.kind === 'workflow' ? `/workflows/${item.id}` : `/queries/${item.id}`}
        className="mono shrink-0 text-xs text-[var(--accent-hi)] hover:underline"
      >
        {item.tag}
      </Link>
      <span className="truncate text-xs text-ink-dim">{item.title}</span>
      <span className="flex-1" />
      {item.flagged_stale && (
        <span className="badge" style={{ color: 'var(--risk-warn)', border: '1px solid var(--risk-warn)', background: 'rgba(215,186,125,.1)' }} title="Flagged as possibly stale">
          ⚠ stale?
        </span>
      )}
      {item.shared_from != null && <span className="badge border border-edge text-ink-faint" title="Shared to you by a colleague">shared-in</span>}
      {item.source_query_id != null && <span className="badge border border-edge text-ink-faint" title="Cloned from the Public Dictionary">clone</span>}
      {item.client_label && <span className="badge border border-edge text-ink-faint">{item.client_label}</span>}
      {item.category_name && <span className="badge" style={{ color: 'var(--accent-hi)', border: '1px solid var(--accent)', background: 'rgba(14,99,156,.1)' }}>{item.category_name}</span>}
      {item.department && <span className="hidden text-[10px] uppercase text-ink-faint md:inline">{item.department}</span>}
      {typeof item.step_count === 'number' && <span className="mono text-[10px] text-ink-faint">{item.step_count} steps</span>}
      {item.risk_level && <RiskBadge level={item.risk_level} />}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {favs.length > 0 && (
        <>
          <div className="sticky top-0 border-b border-edge bg-panel px-3 py-1 text-[10px] uppercase tracking-widest text-ink-faint">
            ★ Favorites
          </div>
          {favs.map((i) => <Row key={`${i.kind}-${i.id}`} item={i} />)}
          <div className="border-b border-edge bg-panel px-3 py-1 text-[10px] uppercase tracking-widest text-ink-faint">All</div>
        </>
      )}
      {rest.map((i) => <Row key={`${i.kind}-${i.id}`} item={i} />)}
      {items.length === 0 && !loading && <div className="px-4 py-8 text-center text-xs text-ink-faint">{emptyText}</div>}
    </div>
  );
}

/**
 * Shared list-page controller: search box (debounced), favorite toggle, and
 * stale-while-revalidate — revisiting a page paints the last known list
 * instantly, then refreshes it in the background.
 */
export function useItemList(fetcher: (q: string) => Promise<ListItem[]>, cacheKey?: string) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ListItem[]>(() => (cacheKey ? getCache<ListItem[]>(`list:${cacheKey}:`) ?? [] : []));
  const [loading, setLoading] = useState(items.length === 0);

  useEffect(() => {
    let cancelled = false;
    const key = cacheKey ? `list:${cacheKey}:${q}` : null;
    const cached = key ? getCache<ListItem[]>(key) : undefined;
    if (cached) {
      setItems(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const t = setTimeout(async () => {
      const data = await fetcher(q);
      if (!cancelled) {
        setItems(data);
        setLoading(false);
        if (key) setCache(key, data);
      }
    }, q ? 200 : 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggleFavorite = useMemo(
    () => async (item: ListItem) => {
      setItems((prev) => prev.map((i) => (i.id === item.id && i.kind === item.kind ? { ...i, favorited: !i.favorited } : i)));
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item_type: item.kind, item_id: item.id }),
      });
    },
    [],
  );

  return { q, setQ, items, setItems, loading, toggleFavorite };
}
