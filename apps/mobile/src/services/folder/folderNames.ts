/**
 * @fileoverview How the downloads folder is laid out and named. The listener picks one folder; inside it:
 *
 *   All songs/<Artist - Title>.mp3 + .jpg + .json   every song, with its cover and a small file about it
 *   Playlists/<Playlist name>/<Artist - Title>.mp3   a copy of each song in that playlist
 *   playlists.json                                   which songs each playlist holds, for a fresh install
 *
 * File names are for people (they read them in a file manager), so they say who and what; the song's id lives in
 * its `.json`. Pure: the native side (android/.../saf/SafLibrary.kt) writes whatever name it is handed.
 */

export const ALL_SONGS_FOLDER = 'All songs';
export const PLAYLISTS_FOLDER = 'Playlists';
export const PLAYLISTS_FILE = 'playlists.json';

/** What no common file system accepts in a name (FAT, exFAT and SD cards are the strictest). */
const FORBIDDEN = /[\\/:*?"<>|]/g;

/** Control characters (tabs, line breaks, NUL) become spaces too. */
const withoutControls = (raw: string): string => Array.from(raw, ch => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('');

/** Longest name part kept, so base + extension stays far below the 255-byte limit even in multi-byte scripts. */
const MAX_PART = 80;

/** A name safe to create as a file or folder: no separators or reserved characters, no edge dots or spaces, never empty. */
export function safeName(raw: string | null | undefined, fallback = 'Untitled'): string {
  const cleaned = withoutControls(raw ?? '')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PART)
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned || fallback;
}

/** The file name of a song without its extension: "Artist - Title", or just the title when no artist is known. */
export function songBase(title: string, artist?: string | null): string {
  const name = safeName(title);
  const by = (artist ?? '').trim();
  return by ? `${safeName(by, '')} - ${name}`.replace(/^ - /, '') : name;
}

/**
 * A base for each song that is unique among them: the first keeps its plain name, a later one with the same name
 * gets the tail of its id so two different songs never overwrite each other's file.
 */
export function uniqueBases(songs: readonly { id: string; title: string; artist?: string | null }[]): Map<string, string> {
  const taken = new Set<string>();
  const bases = new Map<string, string>();
  for (const song of songs) {
    let base = songBase(song.title, song.artist);
    if (taken.has(base.toLowerCase())) {
      base = `${base} (${safeName(song.id.slice(-6), 'copy')})`;
    }
    taken.add(base.toLowerCase());
    bases.set(song.id, base);
  }
  return bases;
}

/** The folder name for a playlist. */
export function playlistFolderName(name: string): string {
  return safeName(name, 'Playlist');
}

/** "Artist - Title.mp3" -> "Artist - Title"; null for a name with another extension. */
export function baseOf(fileName: string, extension: string): string | null {
  const suffix = `.${extension}`;
  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) : null;
}
