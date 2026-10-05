/**
 * Finds imported tracks (titles and artists from a Spotify data download or a CSV) in Allegra's
 * catalog. The only place catalog-matching rules for Import live (PLAN.md I3).
 *
 * Results are not personal, so they are cached for everyone under the track's identity key. Only
 * Saavn rows can match: a Blend or a library row that will not play is a broken promise (D15).
 */
import type { CatalogService } from '../catalog/catalog.js';
import { cacheKey, cachedLookup, type CacheStore } from '../lib/cache.js';
import { creditedArtists, identityKey } from '../shared/identity.js';
import type { ImportedTrack } from '../shared/importParse.js';
import type { SongSnapshot } from '../shared/songRef.js';
import type { UnifiedSong } from '../types.js';
import { snapshotOf } from '../user/libraryOps.js';

export type MatchConfidence = 'exact' | 'close' | 'none';

export interface MatchResult {
  readonly index: number;
  readonly song: SongSnapshot | null;
  readonly confidence: MatchConfidence;
  readonly retryable?: boolean;
}

export const IMPORT_MATCH = {
  batchMax: 50,
  concurrency: 4,
  hitTtl: 30 * 86_400,
  missTtl: 7 * 86_400,
  durationToleranceSec: 5,
  closeSimilarity: 0.85,
  searchLimit: 8
} as const;

const BATCH_DEADLINE_MS = 12_000;
const releaseEvidence = (title: string): string =>
  (title.toLowerCase().match(/\b(live|acoustic|remix|remaster(?:ed)?|instrumental|radio edit|clean|explicit|cover)\b/gu) ?? []).sort().join(' ');

interface CachedMatch {
  readonly song: SongSnapshot;
  readonly confidence: 'exact' | 'close';
}

/** Thrown inside a load so an empty or failed search is not remembered as a week-long miss. */
class Uncacheable extends Error {}

/**
 * The normalised words of a title or name: bracketed trailers dropped, punctuation flattened.
 * A Spotify-style " - Remastered 2011" / " - From "Film"" suffix is dropped too, on both sides.
 */
export function normalText(value: string): string {
  const head = value.split(' - ')[0] ?? value;
  return head.normalize('NFKC').toLowerCase().replace(/[([][^)\]]*[)\]]/gu, ' ').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function leadArtist(artist: string): string {
  return normalText(creditedArtists(artist)[0] ?? '');
}

function artistSet(artist: string): Set<string> {
  return new Set(creditedArtists(artist).map(normalText).filter(Boolean));
}

/** Dice coefficient over character bigrams: 1 for equal strings, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2);
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const count = bigrams.get(pair) ?? 0;
    if (count > 0) {
      bigrams.set(pair, count - 1);
      shared += 1;
    }
  }
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/** Same album, or one name is the other plus more words ("Brahmastra" / "Brahmastra Part One Shiva"). */
function albumsAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && ` ${long} `.includes(` ${short} `);
}

/** Pure: how well a catalog row matches an imported track. */
export function scoreCandidate(track: ImportedTrack, song: UnifiedSong): MatchConfidence {
  if (song.source !== 'Saavn') return 'none';
  const title = normalText(track.title);
  const candidateTitle = normalText(song.title);
  if (!title || !candidateTitle) return 'none';
  const lead = leadArtist(track.artist);
  const sameLead = lead !== '' && lead === leadArtist(song.artist);
  const sameTitle = title === candidateTitle;
  const durationFits = track.durationSec === undefined || !(song.duration > 0)
    || Math.abs(track.durationSec - song.duration) <= IMPORT_MATCH.durationToleranceSec;

  const releaseFits = releaseEvidence(track.title) === releaseEvidence(song.title);
  const albumFits = !track.album || !song.album || albumsAgree(normalText(track.album), normalText(song.album));
  const theirs = artistSet(song.artist);
  const overlap = [...artistSet(track.artist)].some((name) => theirs.has(name));
  // Credit order differs by catalog (Spotify often lists the composer first, Saavn the singer), so a
  // shared artist stands in for the same lead, but only when a known length agrees too.
  const knownLength = track.durationSec !== undefined && song.duration > 0;
  const sameArtist = sameLead || (overlap && knownLength);
  if (sameTitle && sameArtist && durationFits && releaseFits && albumFits) return 'exact';
  if (sameTitle && overlap) return 'close';
  if (sameLead && similarity(title, candidateTitle) >= IMPORT_MATCH.closeSimilarity) return 'close';
  return 'none';
}

/** At most `slots` of the returned function's tasks run at once. */
function limit(slots: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= slots) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

export class ImportMatcher {
  private readonly slot = limit(IMPORT_MATCH.concurrency);

  public constructor(
    private readonly catalog: Pick<CatalogService, 'search'>,
    private readonly cache: CacheStore,
    private readonly deadlineMs = BATCH_DEADLINE_MS
  ) {}

  public async match(tracks: readonly ImportedTrack[]): Promise<MatchResult[]> {
    const deadline = Date.now() + this.deadlineMs;
    return Promise.all(tracks.map(async (track, index): Promise<MatchResult> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = cachedLookup<CachedMatch>(this.cache, {
          key: cacheKey('import-match-v3', identityKey(track.title, track.artist), track.album ?? '', releaseEvidence(track.title), String(track.durationSec ?? '')),
          hitTtlSeconds: IMPORT_MATCH.hitTtl,
          missTtlSeconds: IMPORT_MATCH.missTtl,
          load: () => this.slot(() => {
            if (Date.now() >= deadline) throw new Uncacheable('deadline');
            return this.find(track);
          })
        });
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Uncacheable('deadline')), Math.max(0, deadline - Date.now())); });
        const found = await Promise.race([work, timeout]);
        return found ? { index, song: found.song, confidence: found.confidence } : { index, song: null, confidence: 'none' };
      } catch {
        // A provider failure is "not found this time", never a failed batch; nothing is cached.
        return { index, song: null, confidence: 'none', retryable: true };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));
  }

  private async find(track: ImportedTrack): Promise<CachedMatch | null> {
    const lead = creditedArtists(track.artist)[0] ?? track.artist;
    const { results } = await this.catalog.search(`${track.title.split(' - ')[0] ?? track.title} ${lead}`.trim(), IMPORT_MATCH.searchLimit, 1, { enrich: false });
    if (results.length === 0) throw new Uncacheable('empty search');
    let close: CachedMatch | null = null;
    for (const song of results) {
      const confidence = scoreCandidate(track, song);
      if (confidence === 'none') continue;
      const snapshot = snapshotOf(song);
      if (!snapshot) continue;
      if (confidence === 'exact') return { song: snapshot, confidence };
      close ??= { song: snapshot, confidence };
    }
    return close;
  }
}
