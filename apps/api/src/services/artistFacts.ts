/**
 * What the Blend score needs to know about an artist (PLAN.md §4.5): how popular they are, their
 * main language and similar artists. From the catalog's artist profile, cached and shared between
 * listeners because none of it is personal. A missing fact degrades the score; it never fails it.
 */
import type { CatalogService } from '../catalog/catalog.js';
import type { CacheStore } from '../lib/cache.js';
import type { ArtistFacts } from '../shared/blendTypes.js';
import { artistKey } from '../shared/identity.js';
import type { ArtistProfile } from '../types.js';

export const ARTIST_FACTS = {
  hitTtl: 30 * 86_400,
  missTtl: 86_400,
  concurrency: 4,
  budgetMs: 3000,
  maxSimilar: 10,
  fallbackPopularity: 0.5
} as const;

const fallback = (key: string): ArtistFacts => ({ key, popularity: ARTIST_FACTS.fallbackPopularity, similar: [] });

/** Pure: facts from a catalog artist profile. */
export function factsFromProfile(key: string, profile: ArtistProfile): ArtistFacts {
  const followers = profile.followerCount;
  const popularity = followers === null || !Number.isFinite(followers)
    ? ARTIST_FACTS.fallbackPopularity
    : Math.min(1, Math.max(0, Math.log10(1 + Math.max(0, followers)) / 7));
  const languages = new Map<string, number>();
  for (const song of profile.songs) {
    const language = song.language?.trim().toLowerCase();
    if (language) languages.set(language, (languages.get(language) ?? 0) + 1);
  }
  // Most songs wins; a tie goes to the alphabetically first language, so the answer is stable.
  const language = [...languages].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
  const similar = [...new Set(profile.similar.map((artist) => artistKey(artist.name)).filter(Boolean))].slice(0, ARTIST_FACTS.maxSimilar);
  return { key, popularity, ...(language ? { language } : {}), similar };
}

export class ArtistFactsService {
  public constructor(
    private readonly catalog: Pick<CatalogService, 'getArtist'>,
    private readonly cache: CacheStore
  ) {}

  /** Facts for each key, within the budget; anything unfinished gets the fallback (not cached). */
  public async facts(keys: readonly string[], budgetMs: number = ARTIST_FACTS.budgetMs): Promise<Map<string, ArtistFacts>> {
    const unique = [...new Set(keys.map(artistKey).filter(Boolean))];
    const found = new Map<string, ArtistFacts>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < unique.length) {
        const key = unique[next++] as string;
        found.set(key, await this.one(key));
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
    try {
      await Promise.race([
        Promise.all(Array.from({ length: Math.min(ARTIST_FACTS.concurrency, unique.length) }, worker)),
        budget
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const result = new Map<string, ArtistFacts>();
    for (const key of unique) result.set(key, found.get(key) ?? fallback(key));
    // Stop the workers from starting more lookups after the budget ran out.
    next = unique.length;
    return result;
  }

  private async one(key: string): Promise<ArtistFacts> {
    const cacheKey = `artist-facts:${key}`;
    try {
      const cached = await this.cache.get<ArtistFacts>(cacheKey);
      if (cached) return cached;
    } catch {
      // A cache read failure is a miss.
    }
    let facts: ArtistFacts;
    let ttl: number = ARTIST_FACTS.hitTtl;
    try {
      facts = factsFromProfile(key, await this.catalog.getArtist(key));
    } catch {
      facts = fallback(key);
      ttl = ARTIST_FACTS.missTtl;
    }
    try {
      await this.cache.set(cacheKey, facts, ttl);
    } catch {
      // Not remembered this time; the next build asks again.
    }
    return facts;
  }
}
