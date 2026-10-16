/** Short-lived in-memory cache for integration reads (per integration + key). */
const cache = new Map<string, { at: number; value: unknown }>()

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return value
}

export function uncache(key: string) {
  cache.delete(key)
}
