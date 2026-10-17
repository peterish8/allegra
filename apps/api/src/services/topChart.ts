/**
 * Today's top songs for a country, as songs Allegra can play: a public most-played chart read for
 * its titles and artists, each found in the catalog with the import matcher's scoring. Entries the
 * catalog does not carry are skipped, so the chart keeps its order with gaps closed.
 */
import type { CatalogService } from '../catalog/catalog.js';
import { cacheKey, type CacheStore } from '../lib/cache.js';
import { songIdentity } from '../lib/normalize.js';
import type { ChartEntry, ChartFeed } from '../providers/appleRss.js';
import { creditedArtists } from '../shared/identity.js';
import type { UnifiedSong } from '../types.js';
import { scoreCandidate } from './importMatch.js';

export interface TopChartPayload {
  readonly storefront: string;
  /** False when the chart could not be read or too few of its songs are in the catalog. */
  readonly available: boolean;
  readonly updatedAt: string | null;
  readonly songs: readonly UnifiedSong[];
}

export const TOP_CHART = {
  /** How far down the chart to look for songs the catalog carries. */
  scan: 20,
  size: 10,
  /** Fewer matches than this and the chart is not worth showing. */
  minimum: 5,
  concurrency: 4,
  searchLimit: 8,
  ttlSeconds: 3_600
} as const;

export interface ChartSource {
  mostPlayedSongs(storefront: string): Promise<ChartFeed | null>;
}

export class TopChartService {
  public constructor(
    private readonly source: ChartSource,
    private readonly catalog: Pick<CatalogService, 'search'>,
    private readonly cache: CacheStore
  ) {}

  public async get(storefront: string): Promise<TopChartPayload> {
    // v1: Apple's most-played feed, matched with the import scorer (exact or close).
    const key = cacheKey('top-chart-v1', storefront);
    const cached = await this.cache.get<TopChartPayload>(key);
    if (cached) return cached;

    const feed = await this.source.mostPlayedSongs(storefront);
    if (!feed) return { storefront, available: false, updatedAt: null, songs: [] };
    const matched = await this.matchAll(feed.entries.slice(0, TOP_CHART.scan));
    const seen = new Set<string>();
    const songs: UnifiedSong[] = [];
    for (const song of matched) {
      if (!song || seen.has(songIdentity(song))) continue;
      seen.add(songIdentity(song));
      songs.push(song);
      if (songs.length === TOP_CHART.size) break;
    }
    const available = songs.length >= TOP_CHART.minimum;
    const payload: TopChartPayload = { storefront, available, updatedAt: feed.updatedAt, songs: available ? songs : [] };
    // A thin match is usually a slow or failing catalog, so only a full chart is remembered.
    if (available) await this.cache.set(key, payload, TOP_CHART.ttlSeconds);
    return payload;
  }

  /** Chart order is kept: result i belongs to entry i. */
  private async matchAll(entries: readonly ChartEntry[]): Promise<(UnifiedSong | null)[]> {
    const results: (UnifiedSong | null)[] = new Array<UnifiedSong | null>(entries.length).fill(null);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < entries.length) {
        const index = next;
        next += 1;
        const entry = entries[index];
        if (entry) results[index] = await this.find(entry);
      }
    };
    await Promise.all(Array.from({ length: TOP_CHART.concurrency }, worker));
    return results;
  }

  private async find(entry: ChartEntry): Promise<UnifiedSong | null> {
    try {
      const lead = creditedArtists(entry.artist)[0] ?? entry.artist;
      const { results } = await this.catalog.search(`${entry.title} ${lead}`, TOP_CHART.searchLimit, 0, { enrich: false });
      let close: UnifiedSong | null = null;
      for (const song of results) {
        if (!song.streamUrl) continue;
        const confidence = scoreCandidate(entry, song);
        if (confidence === 'exact') return song;
        if (confidence === 'close') close ??= song;
      }
      return close;
    } catch {
      return null;
    }
  }
}
