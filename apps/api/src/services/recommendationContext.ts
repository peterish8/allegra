import type { CatalogService } from '../catalog/catalog.js';
import { parseLanguages } from '../lib/languages.js';
import type { UnifiedSong } from '../types.js';
import type { UserData } from '../user/store.js';
import { unifiedSongFromSnapshot } from '../user/libraryOps.js';
import type { TasteContext } from './recommendations.js';

export interface RecommendationInput {
  readonly context: TasteContext;
  readonly excludeIds: ReadonlySet<string>;
  readonly excludeSongs: UnifiedSong[];
}

/** The listener's language setting (`settings.languages`, stored as "hindi,tamil"). Empty = all. */
export function userLanguages(user: Pick<UserData, 'settings'>): string[] {
  return parseLanguages(user.settings.languages);
}

/**
 * Turns a stored user (likes, recent plays, learned taste, language setting) into what
 * `RecommendationService.recommend` needs. Shared by the HTTP route and the MCP tool so the two
 * surfaces can never drift apart.
 */
export async function buildRecommendationInput(catalog: CatalogService, user: UserData, currentId?: string | null): Promise<RecommendationInput> {
  const recent = [...user.recentlyPlayed].sort((left, right) => right.playedAt.localeCompare(left.playedAt)).slice(0, 20);
  const recentIds = recent.map((entry) => entry.songRef?.startsWith('gaana:')
    ? entry.songRef
    : entry.songRef?.startsWith('saavn:') ? entry.songRef.slice('saavn:'.length) : entry.songId);
  const likedIds = user.likedSongIds.slice(0, 20);
  const allIds = [...new Set([...(currentId ? [currentId] : []), ...recentIds, ...likedIds])];
  let songs: UnifiedSong[] = [];
  try {
    songs = allIds.length > 0 ? await catalog.getSongs(allIds) : [];
  } catch {
    songs = [];
  }
  const byId = new Map(songs.flatMap((song) => [[song.id, song], [song.source === 'Gaana' ? `gaana:${song.id}` : song.id, song]] as const));
  for (const entry of recent) {
    if (!entry.song) continue;
    const snapshot = unifiedSongFromSnapshot(entry.song);
    if (snapshot) byId.set(snapshot.id, snapshot);
  }
  // Now playing, then the two latest plays, then the two most recent likes.
  const seedIds = [...(currentId ? [currentId] : []), ...recentIds.slice(0, 2), ...likedIds.slice(0, 2)];
  const seeds = seedIds.map((id) => byId.get(id)).filter((song): song is UnifiedSong => Boolean(song));

  const context: TasteContext = {
    seeds,
    favoriteArtists: user.taste?.artists.map((entry) => ({ name: entry.name, score: entry.score })) ?? [],
    favoriteLanguages: user.taste?.languages.map((entry) => entry.name) ?? [],
    languages: userLanguages(user)
  };

  return { context, excludeIds: new Set([...likedIds, ...recentIds]), excludeSongs: [...new Set(byId.values())].filter((song) => song.id !== currentId) };
}
