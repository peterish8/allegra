/**
 * What the Stream header's Songs / Playlists switch shows: the six most recent of either. Pure, so the order and the
 * count are tested. Songs are the feed's "keep listening" list (already newest first); playlists sort here.
 */
import type { Playlist } from '../../types/song';

export const RECENT_COUNT = 6;
export type RecentView = 'songs' | 'playlists';

const stamp = (playlist: Pick<Playlist, 'dateModified' | 'dateCreated'>): number => {
  const modified = Date.parse(playlist.dateModified);
  if (Number.isFinite(modified)) return modified;
  const created = Date.parse(playlist.dateCreated);
  return Number.isFinite(created) ? created : 0;
};

/** The playlists changed most recently, newest first, at most `limit`. Ties keep their stored order. */
export function recentPlaylists<T extends Pick<Playlist, 'dateModified' | 'dateCreated'>>(
  playlists: readonly T[],
  limit = RECENT_COUNT,
): T[] {
  return playlists
    .map((playlist, index) => ({ playlist, index, at: stamp(playlist) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.playlist);
}

/** "12 songs" / "1 song" / "Empty". */
export function playlistMeta(count: number | undefined): string {
  if (!count) return 'Empty';
  return `${count} ${count === 1 ? 'song' : 'songs'}`;
}
