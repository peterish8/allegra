/**
 * A Map that keeps only its `max` most recently used entries (1.41.0 memory pass). Module-level caches (cover
 * palettes, glow colours, resolved online songs, the stream catalog) used to grow for as long as the app ran; a long
 * session of browsing kept every one. Reading an entry marks it used; adding past `max` drops the least recent.
 */
export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    // Re-inserting moves it to the newest end; Map keeps insertion order.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > Math.max(1, this.max)) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return this;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
