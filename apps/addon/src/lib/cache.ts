/**
 * The TTL caches in front of the API.
 *
 * Caches for genuinely global data (genres, RPDB config, the spoiler-protection
 * preference) stay unkeyed. Anything derived from a profile-scoped endpoint —
 * the manifest, which lists that profile's lists, the enabled-catalog config,
 * and the discovery catalogs, which include personal recommendations — is
 * keyed by profile so one profile never serves another's rows.
 */

export type CacheEntry<T> = { data: T; expiry: number };

export const cacheKeyFor = (profileId: string | null) => profileId ?? "-";

// Profile ids reaching these maps are UUID-shaped but not verified to exist, so
// bound the maps rather than let unknown ids accumulate entries indefinitely.
const MAX_CACHE_ENTRIES = 512;

export const cacheSet = <T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>) => {
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    // Map iterates in insertion order, so this drops the least recently added.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
};
