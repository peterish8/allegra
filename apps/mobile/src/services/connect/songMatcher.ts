import { matchKey, parseSongRef, type SongSnapshot } from '@shared/songRef';

import type { AllegraSong } from '../account/allegraApi';
import { getAllegraSongs, toPlayableAllegraSong } from '../account/allegraApi';
import { searchOfficial } from '../stream/officialSearch';
import { isOnDevice } from '../stream/streamSong';
import type { Song, UnifiedSong } from '../../types/song';

export interface SongMatcherDeps {
  readonly localSongs: () => readonly Song[];
  readonly getCatalogSong: (ref: string, token: string) => Promise<AllegraSong | null>;
  readonly searchCatalog: (query: string, artist: string) => Promise<UnifiedSong[]>;
  readonly token: () => string | null;
}

export type MatchedSong = { readonly kind: 'local'; readonly song: Song } | { readonly kind: 'catalog'; readonly song: UnifiedSong };

const defaults: SongMatcherDeps = {
  localSongs: () => [],
  getCatalogSong: async () => null,
  searchCatalog: query => searchOfficial(query, 12),
  token: () => null,
};

/** Finds the exact downloaded copy first, then the exact catalog recording. */
export async function matchConnectSong(snapshot: SongSnapshot, deps: SongMatcherDeps = defaults): Promise<MatchedSong | null> {
  const parsed = parseSongRef(snapshot.ref);
  if (!parsed) return null;
  const wanted = matchKey(snapshot.title, snapshot.artist);
  const local = deps.localSongs().find(song => song.originId === snapshot.ref || matchKey(song.title, song.artist) === wanted);
  if (local?.audioUri && isOnDevice(local.audioUri)) return { kind: 'local', song: local };

  const token = deps.token();
  if (token) {
    const exact = await deps.getCatalogSong(snapshot.ref, token).catch(() => null);
    if (exact) {
      const playable = toPlayableAllegraSong(exact);
      if (playable && playable.id === parsed.id && playable.source.toLowerCase() === parsed.source) return { kind: 'catalog', song: playable };
    }
  }

  const candidates = await deps.searchCatalog(`${snapshot.title} ${snapshot.artist}`.trim(), snapshot.artist).catch(() => []);
  const exactRef = candidates.find(song => song.id === parsed.id && song.source.toLowerCase() === parsed.source);
  const exactMetadata = candidates.find(song => song.source.toLowerCase() === parsed.source
    && song.title.trim().toLocaleLowerCase() === snapshot.title.trim().toLocaleLowerCase()
    && (song.artist ?? '').trim().toLocaleLowerCase() === snapshot.artist.trim().toLocaleLowerCase());
  const match = exactRef ?? exactMetadata;
  return match && (match.streamUrl || match.downloadUrl) ? { kind: 'catalog', song: match } : null;
}

export const getAllegraSongById = async (ref: string, token: string): Promise<AllegraSong | null> => {
  const parsed = parseSongRef(ref);
  if (!parsed) return null;
  return (await getAllegraSongs(token, [ref]))?.find(song => song.id === parsed.id && song.source.toLowerCase() === parsed.source) ?? null;
};

export async function matchQueue(
  snapshots: readonly SongSnapshot[],
  deps: SongMatcherDeps = defaults,
  parallel = 2,
): Promise<Song[]> {
  const songs: (Song | null)[] = new Array(snapshots.length).fill(null);
  const lookups = new Map<string, Promise<MatchedSong | null>>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < snapshots.length) {
      const index = cursor++;
      const snapshot = snapshots[index];
      let lookup = lookups.get(snapshot.ref);
      if (!lookup) {
        lookup = matchConnectSong(snapshot, deps);
        lookups.set(snapshot.ref, lookup);
      }
      const match = await lookup;
      if (match) songs[index] = match.kind === 'local' ? match.song : toMobileSong(match.song);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, parallel), snapshots.length) }, worker));
  return songs.filter((song): song is Song => song !== null);
}

export function toMobileSong(song: UnifiedSong): Song {
  const now = new Date().toISOString();
  return {
    id: `stream:${song.source.toLowerCase()}:${song.id}`,
    title: song.title,
    artist: song.artist,
    gradientId: 'dynamic',
    duration: song.duration ?? 0,
    dateCreated: now,
    dateModified: now,
    playCount: 0,
    lyrics: [],
    coverImageUri: song.highResArt || song.thumbnail || undefined,
    audioUri: song.streamUrl || song.downloadUrl,
    originId: `${song.source.toLowerCase()}:${song.id}`,
  };
}
