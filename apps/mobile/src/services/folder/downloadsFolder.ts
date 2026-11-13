/**
 * @fileoverview The downloads folder as the listener uses it: choose it once (Settings → Library and data), and
 * from then on every download is copied there as well. Choosing a folder that already holds songs, for example
 * after reinstalling the app, brings those songs and playlists back.
 *
 * The rules (names, what is saved, what is restored) are in `libraryFolder.ts`; this file only connects them to the
 * phone: the picker, the settings store, the library and the playlists.
 */
import { useSettingsStore } from '../../store/settingsStore';
import { folderStillGranted, folderSupported, nativeFolderPort, pickDownloadsFolder } from './nativeFolderPort';
import { restoreLibraryFromFolder, saveLibraryToFolder, type FolderPlaylist, type RestoredLibrary, type SaveReport } from './libraryFolder';

export { folderSupported };

export interface FolderStatus {
  /** The folder's uri, or null when none is chosen. */
  uri: string | null;
  /** False when a folder is chosen but Android no longer lets the app use it (after a reinstall). */
  usable: boolean;
}

export function downloadsFolderStatus(): FolderStatus {
  const uri = useSettingsStore.getState().downloadDirectoryUri;
  return { uri, usable: uri !== null && folderStillGranted(uri) };
}

/** A folder's name for people: the last part of its path ("Music/LuvLyrics" → "LuvLyrics"). */
export function folderLabel(uri: string | null): string {
  if (!uri) return '';
  const id = decodeURIComponent(uri.split('/tree/')[1] ?? '').split('/document/')[0] ?? '';
  const last = id.split(/[:/]/).filter(Boolean).pop();
  return last ?? 'Chosen folder';
}

/** Puts the folder's songs and playlists into the library; resolves to what came back. */
async function applyRestored(restored: RestoredLibrary): Promise<{ songs: number; playlists: number }> {
  const [{ useSongsStore }, { usePlaylistStore }, playlistQueries] = await Promise.all([
    import('../../store/songsStore'),
    import('../../store/playlistStore'),
    import('../../database/playlistQueries'),
  ]);
  for (const song of restored.songs) {
    await useSongsStore.getState().addSong(song);
  }
  let playlists = 0;
  if (restored.playlists.length > 0) {
    const existing = await playlistQueries.getAllPlaylists();
    for (const playlist of restored.playlists) {
      if (playlist.songIds.length === 0) continue;
      const match = existing.find(p => p.name.trim().toLowerCase() === playlist.name.trim().toLowerCase());
      const id = match ? match.id : await usePlaylistStore.getState().createPlaylist(playlist.name);
      await playlistQueries.addSongsToPlaylist(id, playlist.songIds);
      playlists += 1;
    }
    await usePlaylistStore.getState().fetchPlaylists();
  }
  return { songs: restored.songs.length, playlists };
}

/** Brings back whatever the chosen folder holds that the library lacks. */
export async function restoreFromDownloadsFolder(uri: string): Promise<{ songs: number; playlists: number }> {
  const [{ getAllSongs }, { lyricaService }] = await Promise.all([
    import('../../database/queries'),
    import('../LyricaService'),
  ]);
  const known = new Set((await getAllSongs()).map(song => song.id));
  const restored = await restoreLibraryFromFolder(nativeFolderPort(uri), known, (lrc, duration) => lyricaService.parseLrc(lrc, duration));
  return applyRestored(restored);
}

/** Copies every song and playlist that is not in the folder yet. */
export async function saveToDownloadsFolder(uri: string, onProgress?: (done: number, total: number) => void): Promise<SaveReport> {
  const [{ getAllSongsWithLyrics }, playlistQueries] = await Promise.all([
    import('../../database/queries'),
    import('../../database/playlistQueries'),
  ]);
  const songs = await getAllSongsWithLyrics();
  const lists: FolderPlaylist[] = [];
  for (const playlist of await playlistQueries.getAllPlaylists()) {
    const members = await playlistQueries.getPlaylistSongs(playlist.id);
    if (members.length > 0) lists.push({ name: playlist.name, songIds: members.map(song => song.id) });
  }
  return saveLibraryToFolder(nativeFolderPort(uri), songs, lists, onProgress);
}

export interface ChooseResult {
  /** The folder was set (false when the listener cancelled the picker). */
  chosen: boolean;
  restored: { songs: number; playlists: number };
}

/** Opens the picker, remembers the folder, and brings back anything it already holds. */
export async function chooseDownloadsFolder(): Promise<ChooseResult> {
  const uri = await pickDownloadsFolder();
  if (!uri) return { chosen: false, restored: { songs: 0, playlists: 0 } };
  useSettingsStore.getState().setDownloadDirectory(uri);
  let restored = { songs: 0, playlists: 0 };
  try {
    restored = await restoreFromDownloadsFolder(uri);
  } catch {
    // The folder is set either way; Settings can run the copy again.
  }
  return { chosen: true, restored };
}
