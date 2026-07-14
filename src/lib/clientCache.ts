/**
 * Tiny client-side stale-while-revalidate cache.
 *
 * Pattern: render cached data instantly (no skeleton), fetch fresh in the
 * background, update state + cache when it lands. Data is only ever one
 * fetch behind, and only for the instant it takes the revalidation to finish.
 */

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function getCache<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCache(key: string, data: unknown): void {
  cache.set(key, data);
  if (cache.size > 300) {
    // drop oldest entries (Map preserves insertion order)
    for (const k of cache.keys()) {
      if (cache.size <= 200) break;
      cache.delete(k);
    }
  }
}

export function clearCache(prefix?: string): void {
  if (!prefix) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** Warm the cache for a URL (e.g. on row hover) — dedupes concurrent calls. */
export function prefetchJson(url: string): void {
  if (cache.has(url) || inflight.has(url)) return;
  const p = fetch(url)
    .then(async (r) => {
      if (r.ok) setCache(url, await r.json());
    })
    .catch(() => {})
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
}

/** Fetch JSON and store it under its URL. */
export async function fetchJsonCached<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const d = (await r.json()) as T;
  if (r.ok) setCache(url, d);
  return d;
}
