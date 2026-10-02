/**
 * A small least-recently-used cache for decoded cover images, with one load per key at a time.
 *
 * Pure (the loader is injected) so the rules can be tested without a native image library:
 *   - a hit comes back at once, and counts as use;
 *   - two callers asking for the same key while it loads share one load;
 *   - a failed load is not remembered, so the next ask tries again;
 *   - the least recently used entry goes first once the cache is full.
 */
export interface ImageCache<T> {
  /** The decoded image if it is already held; `undefined` when it is not. Counts as use. */
  peek(key: string): T | undefined;
  /** Resolves with the image, from the cache or from one shared load. `null` when it cannot be loaded. */
  load(key: string): Promise<T | null>;
}

export function createImageCache<T>(fetcher: (key: string) => Promise<T | null>, max = 6): ImageCache<T> {
  const held = new Map<string, T>();
  const loading = new Map<string, Promise<T | null>>();

  const remember = (key: string, value: T): void => {
    held.delete(key);
    held.set(key, value);
    while (held.size > max) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
  };

  const peek = (key: string): T | undefined => {
    const value = held.get(key);
    if (value !== undefined) remember(key, value);
    return value;
  };

  const load = (key: string): Promise<T | null> => {
    const hit = peek(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const inFlight = loading.get(key);
    if (inFlight) return inFlight;
    const started = fetcher(key)
      .then(value => {
        if (value !== null) remember(key, value);
        return value;
      })
      .catch(() => null)
      .finally(() => { loading.delete(key); });
    loading.set(key, started);
    return started;
  };

  return { peek, load };
}
