/**
 * @fileoverview How the downloads folder is laid out and named. The listener picks one folder; inside it:
 *
 *   All songs/<Title>.mp3 + .jpg + .json            every song: the audio (title, artist, album, cover and lyrics are
 *                                                    written into the file itself), its cover, and a small file about it
 *   Playlists/<Playlist name>/<Title>.mp3            a copy of each song in that playlist
 *   playlists.json                                   which songs each playlist holds, for a fresh install
 *
 * A file is named for the song only. Who sings it and which album it is on live in the file's tags and in its `.json`
 * (the library id is there too, which is what ties a file back to its song). Two different songs with one name keep
 * their own files: the second becomes "Title (2)" (android/.../saf/SafLibrary.kt). Pure: the native side writes
 * whatever name it is handed.
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
    .replace(/"/g, '')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PART)
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned || fallback;
}

/** The file name of a song without its extension: its title. */
export function songBase(title: string): string {
  return safeName(title);
}

/**
 * The name 1.63.0 gave a song, "Artist - Title". Songs saved then are found by it and renamed to [songBase]
 * (libraryFolder.ts); nothing new is written under it.
 */
export function legacyBase(title: string, artist?: string | null): string | null {
  const by = (artist ?? '').trim();
  return by ? `${safeName(by, '')} - ${safeName(title)}` : null;
}

/** The names a song may take, in order: "Title", "Title (2)", "Title (3)" ... */
export function nameCandidates(base: string, count = 8): string[] {
  return Array.from({ length: count }, (_, index) => (index === 0 ? base : `${base} (${index + 1})`));
}

/** The folder name for a playlist. */
export function playlistFolderName(name: string): string {
  return safeName(name, 'Playlist');
}

/** "Title.mp3" -> "Title"; null for a name with another extension. */
export function baseOf(fileName: string, extension: string): string | null {
  const suffix = `.${extension}`;
  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) : null;
}
