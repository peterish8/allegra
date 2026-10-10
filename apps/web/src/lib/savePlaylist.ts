import type { UnifiedSong } from '@shared/types';

import type { LibraryRecord } from './api';

export interface PlaylistSaveActions {
  readonly create: (name: string) => Promise<LibraryRecord | null>;
  readonly addSongs: (libraryId: string, songs: readonly UnifiedSong[]) => Promise<boolean>;
  readonly remove: (libraryId: string) => Promise<boolean>;
}

export type PlaylistSaveResult =
  | { readonly ok: true; readonly playlist: LibraryRecord }
  | { readonly ok: false; readonly error: string };

/** Create a library playlist, add the complete ordered list, and remove the empty shell on failure. */
export async function savePlaylistWithSongs(
  name: string,
  songs: readonly UnifiedSong[],
  actions: PlaylistSaveActions
): Promise<PlaylistSaveResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Give your playlist a name.' };
  if (songs.length === 0) return { ok: false, error: 'There are no songs to save yet.' };

  let playlist: LibraryRecord | null;
  try {
    playlist = await actions.create(trimmed);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That playlist could not be created.' };
  }
  if (!playlist) return { ok: false, error: 'That playlist could not be created.' };

  try {
    if (await actions.addSongs(playlist.id, songs)) return { ok: true, playlist };
  } catch {
    // The playlist context owns the user-facing write error; this helper handles the rollback.
  }

  let removed = false;
  try {
    removed = await actions.remove(playlist.id);
  } catch {
    // Keep the cleanup result visible below even when the delete itself throws.
  }
  return {
    ok: false,
    error: removed
      ? 'The songs could not be saved. The empty playlist was removed, so you can try again.'
      : 'The songs could not be saved, and the playlist could not be removed. You can remove it from Your library.'
  };
}
