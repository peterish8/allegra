import { fromMobileId } from '@shared/songRef';
import type { Song } from '../types/song';

export { canonicalSongRef } from '../utils/songIdentity';

export type SaveableSong = Pick<Song, 'id' | 'title'> & Partial<Pick<Song, 'artist' | 'album' | 'duration' | 'coverImageUri' | 'coverRemoteUri'>>;

export interface SavedSongRoute {
  name: 'AddToPlaylist';
  params: {
    songId: string;
    songMetadata?: { id: string; title: string; artist?: string; album?: string; duration: number; coverImageUri?: string; coverRemoteUri?: string };
  };
}

/** The Saved sheet needs only an addressable song with a usable title. */
export function savedSongRoute(song: SaveableSong | null | undefined): SavedSongRoute | null {
  if (!song?.id.trim() || !song.title.trim()) return null;
  const songMetadata = fromMobileId(song.id)
    ? {
        id: song.id,
        title: song.title,
        ...(song.artist !== undefined ? { artist: song.artist } : {}),
        ...(song.album !== undefined ? { album: song.album } : {}),
        duration: song.duration ?? 0,
        ...(song.coverImageUri !== undefined ? { coverImageUri: song.coverImageUri } : {}),
        ...(song.coverRemoteUri !== undefined ? { coverRemoteUri: song.coverRemoteUri } : {}),
      }
    : undefined;
  return { name: 'AddToPlaylist', params: { songId: song.id, ...(songMetadata ? { songMetadata } : {}) } };
}

export function routeSongToSaved(
  song: SaveableSong | null | undefined,
  navigate: (route: SavedSongRoute) => void,
): boolean {
  const route = savedSongRoute(song);
  if (!route) return false;
  navigate(route);
  return true;
}

export function isSongAlreadySaved(locally: boolean, online: boolean): boolean {
  return locally || online;
}

/** The UI stores only changes from the loaded membership snapshot. */
export function desiredPlaylistMembership(id: string, existingIds: ReadonlySet<string>, changedIds: ReadonlySet<string>): boolean {
  return existingIds.has(id) !== changedIds.has(id);
}

/** Apply changed memberships in order, stopping at the first failure so completed work can be retained. */
export async function applyPlaylistMembershipChanges(
  changedIds: readonly string[],
  existingIds: ReadonlySet<string>,
  add: (playlistId: string) => Promise<void>,
  remove: (playlistId: string) => Promise<void>,
): Promise<{ changed: Array<{ id: string; present: boolean }>; failed: boolean }> {
  const changed: Array<{ id: string; present: boolean }> = [];
  for (const id of changedIds) {
    const present = !existingIds.has(id);
    try {
      await (present ? add : remove)(id);
      changed.push({ id, present });
    } catch {
      return { changed, failed: true };
    }
  }
  return { changed, failed: false };
}

/** Save selected targets one at a time, stopping on failure and remembering completed ones for retry. */
export async function saveSelectedPlaylists(
  selectedIds: readonly string[],
  existingIds: ReadonlySet<string>,
  save: (playlistId: string) => Promise<void>,
): Promise<{ saved: string[]; failed: boolean }> {
  const saved: string[] = [];
  for (const id of selectedIds) {
    if (existingIds.has(id)) continue;
    try {
      await save(id);
      saved.push(id);
    } catch {
      return { saved, failed: true };
    }
  }
  return { saved, failed: false };
}
