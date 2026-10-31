import { inLanguages } from '../lib/languages.js';
import { artistKey, creditedArtists } from '../shared/identity.js';
import type { UnifiedSong } from '../types.js';

/** The catalog calls a radio needs, narrow so tests can fake them. */
export interface RadioCatalog {
  getSong(id: string): Promise<UnifiedSong>;
  getSuggestions(id: string, limit: number, languages?: readonly string[]): Promise<UnifiedSong[]>;
  getArtist(name: string): Promise<{ readonly songs: readonly UnifiedSong[] }>;
}

export type RadioCandidateSource = 'similar' | 'artist' | 'taste';

export interface RadioCandidate {
  readonly song: UnifiedSong;
  readonly source: RadioCandidateSource;
  /** Position in its source list, best first. */
  readonly rank: number;
}

export interface RadioTasteSummary {
  readonly artists: { readonly name: string; readonly score: number }[];
  readonly languages: string[];
}

export interface RadioPool {
  readonly candidates: RadioCandidate[];
  /** The listener's long-term taste, for the client's ranker. Null for guests and when learning is off. */
  readonly taste: RadioTasteSummary | null;
}

export interface RadioListener {
  readonly taste: RadioTasteSummary | null;
  /** The listener's language setting: a hard filter. Empty means every language. */
  readonly languages: readonly string[];
}

const SIMILAR_LIMIT = 30;
const SEED_ARTIST_SONGS = 10;
const TASTE_ARTISTS = 3;
const SONGS_PER_TASTE_ARTIST = 6;

/**
 * Candidates for a song radio. The catalog says which songs go with the seed (its suggestions)
 * and what the seed's artist is known for; the listener's taste adds their own artists, in the
 * seed's language. Ranking is the client's job (`packages/shared/radio.ts`): it alone sees what
 * the listener skips and finishes while the radio plays. Every source is optional, so one slow
 * provider call leaves a smaller pool rather than none.
 */
export class RadioService {
  public constructor(private readonly catalog: RadioCatalog) {}

  public async pool(seedId: string, listener: RadioListener): Promise<RadioPool> {
    const [seed, similar] = await Promise.all([
      safeOne(() => this.catalog.getSong(seedId)),
      safe(() => this.catalog.getSuggestions(seedId, SIMILAR_LIMIT, listener.languages))
    ]);
    const language = seed?.language?.toLowerCase();
    const leadArtist = seed ? creditedArtists(seed.artist)[0] : undefined;
    const seedArtistKeys = new Set(seed ? creditedArtists(seed.artist).map(artistKey) : []);
    const tasteArtists = (listener.taste?.artists ?? [])
      .filter((artist) => artist.score > 0 && !seedArtistKeys.has(artistKey(artist.name)))
      .slice(0, TASTE_ARTISTS);

    const [artistSongs, ...tasteSongs] = await Promise.all([
      leadArtist ? safe(async () => [...(await this.catalog.getArtist(leadArtist)).songs]) : Promise.resolve([] as UnifiedSong[]),
      ...tasteArtists.map((artist) => safe(async () => [...(await this.catalog.getArtist(artist.name)).songs]))
    ]);

    const fits = (song: UnifiedSong): boolean => inLanguages(song, listener.languages) && (!language || !song.language || song.language.toLowerCase() === language);
    const candidates: RadioCandidate[] = [];
    const add = (songs: readonly UnifiedSong[], source: RadioCandidateSource, limit: number): void => {
      songs.filter((song) => song.id !== seedId && fits(song)).slice(0, limit).forEach((song, rank) => candidates.push({ song, source, rank }));
    };
    add(similar, 'similar', SIMILAR_LIMIT);
    add(artistSongs ?? [], 'artist', SEED_ARTIST_SONGS);
    tasteSongs.forEach((songs) => add(songs, 'taste', SONGS_PER_TASTE_ARTIST));
    return { candidates, taste: listener.taste };
  }
}

async function safe(load: () => Promise<readonly UnifiedSong[]>): Promise<UnifiedSong[]> {
  try {
    return [...await load()];
  } catch {
    return [];
  }
}

async function safeOne(load: () => Promise<UnifiedSong>): Promise<UnifiedSong | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}
