/**
 * @fileoverview Copies the library into the listener's downloads folder and reads it back. Everything goes
 * through a `FolderPort` (the native Storage Access Framework one in `nativeFolderPort.ts`), so the rules here
 * are tested without a phone.
 *
 * Saving only ever adds what is missing and never deletes: the folder is the copy that survives an uninstall, so
 * it must not be able to lose a song because of a bug or a half-finished run. Restoring is idempotent: a song
 * already in the library (same id) is left alone.
 */
import type { LyricLine, Song } from '../../types/song';
import {
  ALL_SONGS_FOLDER,
  PLAYLISTS_FILE,
  PLAYLISTS_FOLDER,
  baseOf,
  playlistFolderName,
  uniqueBases,
} from './folderNames';
import { buildPlaylistsFile, buildSidecar, lyricsToLrc, parsePlaylistsFile, parseSidecar } from './folderSidecar';

export interface FolderEntry {
  name: string;
  uri: string;
  isDirectory: boolean;
}

/** What the library needs from the chosen folder. Paths are below the folder the listener picked. */
export interface FolderPort {
  /** What a folder holds; empty when it is not there. */
  list(path: string[]): Promise<FolderEntry[]>;
  readText(uri: string): Promise<string>;
  /** Writes a file, replacing one of that name; resolves to its uri. */
  write(path: string[], name: string, mime: string, source: { uri: string } | { text: string }): Promise<string>;
}

/** A song as the folder needs it. */
export type FolderSong = Pick<
  Song,
  'id' | 'title' | 'artist' | 'album' | 'duration' | 'originId' | 'coverRemoteUri' | 'coverImageUri' | 'audioUri' | 'lyrics'
>;

export interface FolderPlaylist {
  name: string;
  songIds: string[];
}

export interface SaveReport {
  /** Songs copied into the folder this run. */
  saved: number;
  /** Songs that were already there. */
  alreadyThere: number;
  /** Songs with no file on the phone to copy, or whose copy failed. */
  failed: number;
  /** Playlist copies made this run. */
  playlistCopies: number;
}

const isLocalCover = (uri: string | undefined): uri is string => !!uri && (uri.startsWith('file://') || uri.startsWith('content://'));

const namesIn = (entries: readonly FolderEntry[]): Map<string, FolderEntry> => new Map(entries.map(entry => [entry.name, entry]));

/**
 * Copies every song that is not yet in `All songs/`, then mirrors each playlist into `Playlists/<name>/`.
 * One song failing never stops the rest. `onProgress` gets (done, total) over songs and playlist copies.
 */
export async function saveLibraryToFolder(
  port: FolderPort,
  songs: readonly FolderSong[],
  playlists: readonly FolderPlaylist[],
  onProgress?: (done: number, total: number) => void,
): Promise<SaveReport> {
  const report: SaveReport = { saved: 0, alreadyThere: 0, failed: 0, playlistCopies: 0 };
  const withAudio = songs.filter(song => !!song.audioUri);
  const bases = uniqueBases(withAudio);
  const byId = new Map(withAudio.map(song => [song.id, song]));

  const playlistWork = playlists.map(playlist => ({
    name: playlist.name,
    songs: playlist.songIds.map(id => byId.get(id)).filter((song): song is FolderSong => !!song),
  }));
  const total = withAudio.length + playlistWork.reduce((sum, p) => sum + p.songs.length, 0);
  let done = 0;
  const tick = (): void => onProgress?.(++done, total);

  const existing = namesIn(await port.list([ALL_SONGS_FOLDER]));

  for (const song of withAudio) {
    const base = bases.get(song.id)!;
    try {
      if (existing.has(`${base}.json`) && existing.has(`${base}.mp3`)) {
        report.alreadyThere += 1;
      } else {
        const audioUri = song.audioUri!;
        const audio = await port.write([ALL_SONGS_FOLDER], `${base}.mp3`, 'audio/mpeg', { uri: audioUri });
        existing.set(`${base}.mp3`, { name: `${base}.mp3`, uri: audio, isDirectory: false });
        let hasCover = existing.has(`${base}.jpg`);
        if (!hasCover && isLocalCover(song.coverImageUri)) {
          try {
            await port.write([ALL_SONGS_FOLDER], `${base}.jpg`, 'image/jpeg', { uri: song.coverImageUri });
            hasCover = true;
          } catch {
            // A missing cover is not a missing song.
          }
        }
        const sidecar = buildSidecar(
          {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            duration: song.duration,
            originId: song.originId,
            coverRemoteUri: song.coverRemoteUri,
            lyrics: lyricsToLrc(song.lyrics),
          },
          base,
          hasCover,
        );
        // Last, so a song only counts as saved once everything about it is there.
        await port.write([ALL_SONGS_FOLDER], `${base}.json`, 'application/json', { text: sidecar });
        report.saved += 1;
      }
    } catch {
      report.failed += 1;
    }
    tick();
  }

  for (const playlist of playlistWork) {
    const path = [PLAYLISTS_FOLDER, playlistFolderName(playlist.name)];
    let inFolder: Map<string, FolderEntry>;
    try {
      inFolder = namesIn(await port.list(path));
    } catch {
      inFolder = new Map();
    }
    for (const song of playlist.songs) {
      const base = bases.get(song.id)!;
      try {
        if (!inFolder.has(`${base}.mp3`)) {
          const source = existing.get(`${base}.mp3`)?.uri ?? song.audioUri!;
          await port.write(path, `${base}.mp3`, 'audio/mpeg', { uri: source });
          report.playlistCopies += 1;
        }
      } catch {
        report.failed += 1;
      }
      tick();
    }
  }

  // Always rewritten: it is small, and it is what rebuilds the playlists on a fresh install.
  try {
    await port.write([], PLAYLISTS_FILE, 'application/json', {
      text: buildPlaylistsFile(playlists.map(p => ({ name: p.name, songIds: p.songIds }))),
    });
  } catch {
    // Songs are the part that matters; the next run writes it again.
  }
  return report;
}

export interface RestoredLibrary {
  songs: Song[];
  playlists: FolderPlaylist[];
}

/**
 * Reads the folder back. Returns the songs it holds that `knownIds` does not (each with its audio and cover
 * pointing into the folder) and the playlists listed in `playlists.json` with only ids that exist after the restore.
 */
export async function restoreLibraryFromFolder(
  port: FolderPort,
  knownIds: ReadonlySet<string>,
  parseLrc: (lrc: string, duration: number) => LyricLine[],
  now: string = new Date().toISOString(),
): Promise<RestoredLibrary> {
  const entries = await port.list([ALL_SONGS_FOLDER]);
  const byName = namesIn(entries);
  const songs: Song[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory || baseOf(entry.name, 'json') === null) continue;
    let raw: string;
    try {
      raw = await port.readText(entry.uri);
    } catch {
      continue;
    }
    const sidecar = parseSidecar(raw);
    if (!sidecar || seen.has(sidecar.id)) continue;
    const audio = byName.get(sidecar.file);
    if (!audio) continue;
    seen.add(sidecar.id);
    if (knownIds.has(sidecar.id)) continue;
    const cover = sidecar.cover ? byName.get(sidecar.cover) : undefined;
    songs.push({
      id: sidecar.id,
      title: sidecar.title,
      artist: sidecar.artist,
      album: sidecar.album,
      duration: sidecar.duration,
      audioUri: audio.uri,
      coverImageUri: cover?.uri ?? sidecar.coverRemoteUri,
      coverRemoteUri: sidecar.coverRemoteUri,
      originId: sidecar.originId,
      playCount: 0,
      dateCreated: now,
      dateModified: now,
      lyrics: sidecar.lyrics ? parseLrc(sidecar.lyrics, sidecar.duration) : [],
      gradientId: '0',
    });
  }

  let playlists: FolderPlaylist[] = [];
  try {
    const file = (await port.list([])).find(entry => entry.name === PLAYLISTS_FILE);
    if (file) {
      const present = new Set<string>([...knownIds, ...seen]);
      playlists = parsePlaylistsFile(await port.readText(file.uri))
        .map(p => ({ name: p.name, songIds: p.songIds.filter(id => present.has(id)) }));
    }
  } catch {
    playlists = [];
  }
  return { songs, playlists };
}
