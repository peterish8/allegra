/**
 * Search that answers on every keystroke (Spotify's rule: each keystroke updates the results).
 *
 * The network cannot answer in a frame, so the screen answers from what it already knows first:
 * the longest typed prefix it has results for, narrowed to the rows that still match. The live
 * answer replaces it when it lands. The cache is bounded so a long session cannot grow it.
 */

/** Case-, accent-width- and spacing-insensitive form used as the cache key. */
export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function words(text: string): string[] {
  return normalizeQuery(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/**
 * Whether `text` still answers `query`: every typed word is the start of some word in the text.
 * "kesar ari" matches "Kesariya · Arijit Singh"; "ari kes" does too.
 */
export function matchesQuery(text: string, query: string): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const have = words(text);
  return wanted.every((word) => have.some((candidate) => candidate.startsWith(word)));
}

export interface InstantAnswer<T> {
  readonly items: readonly T[];
  /** True when these are the results for exactly this query, not a narrowed prefix. */
  readonly exact: boolean;
}

/** Results by normalized query, least recently used dropped first. */
export class PrefixCache<T> {
  private readonly entries = new Map<string, readonly T[]>();

  public constructor(private readonly capacity = 200) {}

  public get size(): number {
    return this.entries.size;
  }

  public get(query: string): readonly T[] | undefined {
    const key = normalizeQuery(query);
    const items = this.entries.get(key);
    if (items !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, items);
    }
    return items;
  }

  public set(query: string, items: readonly T[]): void {
    const key = normalizeQuery(query);
    if (!key) return;
    this.entries.delete(key);
    this.entries.set(key, items);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * The best thing to show for `query` right now: its own results when cached, else the
   * longest cached prefix narrowed to rows that still match. Null when nothing useful is known.
   */
  public instant(query: string, text: (item: T) => string): InstantAnswer<T> | null {
    const key = normalizeQuery(query);
    if (!key) return null;
    const own = this.get(key);
    if (own !== undefined) return { items: own, exact: true };
    for (let length = key.length - 1; length > 0; length -= 1) {
      const prefix = this.entries.get(key.slice(0, length).trimEnd());
      if (prefix === undefined) continue;
      return { items: prefix.filter((item) => matchesQuery(text(item), key)), exact: false };
    }
    return null;
  }
}

/** Debounce before asking the network: short enough that every pause in typing is answered. */
export const TYPEAHEAD_DEBOUNCE_MS = 90;
/** How many typeahead rows a screen asks for. */
export const TYPEAHEAD_LIMIT = 8;
