/**
 * @fileoverview Copies the library into the listener's downloads folder and reads it back. Everything goes
 * through a `FolderPort` (the native Storage Access Framework one in `nativeFolderPort.ts`), so the rules here
 * are tested without a phone.
 *
 * A song is saved under its own name (`Title.mp3`) with its title, artist, album, cover and lyrics written into the
 * file, and a `Title.json` beside it that holds the library id. The id is what identifies a song: the same name can
 * belong to two different songs, and the file of a song saved by an older version is found by it too.
 *
 * Saving only ever adds what is missing and never deletes: the folder is the copy that survives an uninstall, so
 * it must not be able to lose a song because of a bug or a half-finished run. The one change to existing files is
 * the rename of a song 1.63.0 saved as "Artist - Title" to just its title, and only for a song whose own copy is on
 * the phone (a song the library plays from the folder keeps its name: its row points at that file).
 * Restoring is idempotent: a song already in the library (same id) is left alone.
 */
import type { LyricLine, Song } from '../../types/song';
import {
  ALL_SONGS_FOLDER,
  PLAYLISTS_FILE,
  PLAYLISTS_FOLDER,
  baseOf,
  legacyBase,
  nameCandidates,
  playlistFolderName,
  songBase,
} from './folderNames';
import { buildPlaylistsFile, buildSidecar, lyricsToLrc, parsePlaylistsFile, parseSidecar } from './folderSidecar';

export interface FolderEntry {
  name: string;
  uri: string;
  isDirectory: boolean;
}

/** A song as the native side copies it (SafLibrary.exportSong). */
export interface FolderSongInput {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** Seconds. */
  duration: number;
  originId?: string;
  coverRemoteUri?: string;
  /** Synced lyrics as LRC text. */
  lyrics?: string;
  /** The audio on the phone. */
  audioUri: string;
  /** The cover on the phone, when there is one. */
  coverUri?: string;
  /** The name to try first, without an extension. */
  base: string;
}

/** Where a song ended up: the name may differ from the one asked for when another song has it. */
export interface FolderSongOutcome {
  base: string;
  audioName: string;
  audioUri: string;
  coverName: string | null;
}

/** What the library needs from the chosen folder. Paths are below the folder the listener picked. */
export interface FolderPort {
  /** What a folder holds; empty when it is not there. */
  list(path: string[]): Promise<FolderEntry[]>;
  readText(uri: string): Promise<string>;
  /** Writes a file, replacing one of that name; resolves to its uri. */
  write(path: string[], name: string, mime: string, source: { uri: string } | { text: string }): Promise<string>;
  /** Copies a song into All songs/ under its own name, with its details written into the audio file. */
  exportSong(song: FolderSongInput): Promise<FolderSongOutcome>;
  /** Renames a file; false when the provider refuses or the new name is taken. */
  rename(path: string[], from: string, to: string): Promise<boolean>;
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
  /** Songs renamed from "Artist - Title" to their title. */
  renamed: number;
  /** Songs with no file on the phone to copy, or whose copy failed. */
  failed: number;
  /** Playlist copies made this run. */
  playlistCopies: number;
}

const isLocal = (uri: string | undefined): uri is string => !!uri && (uri.startsWith('file://') || uri.startsWith('content://'));

const namesIn = (entries: readonly FolderEntry[]): Map<string, FolderEntry> => new Map(entries.map(entry => [entry.name, entry]));

/** The song's details as the native side reads them. */
function inputOf(song: FolderSong, base: string): FolderSongInput {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? '',
    album: song.album || undefined,
    duration: Number.isFinite(song.duration) ? song.duration : 0,
    originId: song.originId || undefined,
    coverRemoteUri: song.coverRemoteUri || undefined,
    lyrics: lyricsToLrc(song.lyrics) || undefined,
    audioUri: song.audioUri!,
    coverUri: isLocal(song.coverImageUri) ? song.coverImageUri : undefined,
    base,
  };
}

interface Located {
  /** The name the song's files carry (no extension). */
  base: string;
  /** The audio file's real name, with its extension; empty when the details file is there but the audio is gone. */
  audioName: string;
  coverName?: string;
  /** What the details file says about the lyrics: lyrics found after the download are added to it later. */
  hasLyrics: boolean;
  /** Saved by 1.63.0 as "Artist - Title". */
  legacy: boolean;
}

/**
 * Finds a song's files in the folder by its id: under its title, then "Title (2)" ... and last under the name 1.63.0
 * gave it. Reads one details file per name tried, and none for a song that is not there.
 */
async function locate(port: FolderPort, entries: Map<string, FolderEntry>, song: FolderSong): Promise<Located | null> {
  const owns = async (base: string, legacy: boolean): Promise<Located | null> => {
    const json = entries.get(`${base}.json`);
    if (!json) return null;
    try {
      const sidecar = parseSidecar(await port.readText(json.uri));
      if (sidecar?.id === song.id) {
        return { base, audioName: entries.has(sidecar.file) ? sidecar.file : '', coverName: sidecar.cover, hasLyrics: !!sidecar.lyrics, legacy };
      }
    } catch {
      // Unreadable: not this song's.
    }
    return null;
  };

  for (const base of nameCandidates(songBase(song.title))) {
    if (!entries.has(`${base}.json`)) break;
    const found = await owns(base, false);
    if (found) return found;
  }
  const old = legacyBase(song.title, song.artist);
  return old ? owns(old, true) : null;
}

/**
 * Renames a legacy song's files to its title and rewrites its details file to match. Resolves to the new base, or
 * null when it could not (the files stay as they were, which still restores correctly).
 */
async function renameToTitle(port: FolderPort, entries: Map<string, FolderEntry>, song: FolderSong, from: Located): Promise<string | null> {
  const target = nameCandidates(songBase(song.title)).find(base => !entries.has(`${base}.json`) && !entries.has(`${base}.mp3`) && !entries.has(`${base}.m4a`));
  if (!target) return null;
  const extension = from.audioName.slice(from.audioName.lastIndexOf('.'));
  const audioName = `${target}${extension}`;
  const coverName = from.coverName ? `${target}${from.coverName.slice(from.coverName.lastIndexOf('.'))}` : undefined;

  if (!(await port.rename([ALL_SONGS_FOLDER], from.audioName, audioName))) return null;
  let renamedCover = coverName;
  if (from.coverName && coverName && !(await port.rename([ALL_SONGS_FOLDER], from.coverName, coverName))) {
    // The picture stays under its old name; the details file below points at it.
    renamedCover = from.coverName;
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
    { audio: audioName, cover: renamedCover },
  );
  // The details file moves to the new name and is rewritten there. If it cannot move, a second one is written beside it;
  // a restore reads both and keeps the song once (it goes by the library id).
  await port.rename([ALL_SONGS_FOLDER], `${from.base}.json`, `${target}.json`).catch(() => false);
  await port.write([ALL_SONGS_FOLDER], `${target}.json`, 'application/json', { text: sidecar });
  entries.delete(from.audioName);
  entries.delete(`${from.base}.json`);
  entries.set(audioName, { name: audioName, uri: '', isDirectory: false });
  entries.set(`${target}.json`, { name: `${target}.json`, uri: '', isDirectory: false });
  return target;
}

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
  const report: SaveReport = { saved: 0, alreadyThere: 0, renamed: 0, failed: 0, playlistCopies: 0 };
  const withAudio = songs.filter(song => !!song.audioUri);
  const byId = new Map(withAudio.map(song => [song.id, song]));

  const playlistWork = playlists.map(playlist => ({
    name: playlist.name,
    songs: playlist.songIds.map(id => byId.get(id)).filter((song): song is FolderSong => !!song),
  }));
  const total = withAudio.length + playlistWork.reduce((sum, p) => sum + p.songs.length, 0);
  let done = 0;
  const tick = (): void => onProgress?.(++done, total);

  const entries = namesIn(await port.list([ALL_SONGS_FOLDER]));
  /** Each song's audio file in All songs/, for the playlist copies. */
  const audioFiles = new Map<string, FolderEntry>();

  for (const song of withAudio) {
    try {
      const found = await locate(port, entries, song);
      if (found && found.audioName) {
        let audioName = found.audioName;
        // A song saved as "Artist - Title" whose own copy is on the phone takes its title as its name (its details file
        // is rewritten with the song's current details, lyrics included).
        const renamed = found.legacy && song.audioUri!.startsWith('file://') ? await renameToTitle(port, entries, song, found) : null;
        if (renamed) {
          audioName = `${renamed}${found.audioName.slice(found.audioName.lastIndexOf('.'))}`;
          report.renamed += 1;
        }
        // Lyrics usually arrive after the download: put them in the details file now, so a restore brings them back.
        const lrc = lyricsToLrc(song.lyrics);
        if (!renamed && lrc && !found.hasLyrics) {
          await port.write([ALL_SONGS_FOLDER], `${found.base}.json`, 'application/json', {
            text: buildSidecar(
              {
                id: song.id,
                title: song.title,
                artist: song.artist,
                album: song.album,
                duration: song.duration,
                originId: song.originId,
                coverRemoteUri: song.coverRemoteUri,
                lyrics: lrc,
              },
              { audio: audioName, cover: found.coverName },
            ),
          }).catch(() => undefined);
        }
        report.alreadyThere += 1;
        audioFiles.set(song.id, entries.get(audioName) ?? { name: audioName, uri: song.audioUri!, isDirectory: false });
      } else {
        // Not there yet, or its details are but its audio is gone (a half-saved song): copied again under its own name.
        const outcome = await port.exportSong(inputOf(song, found && !found.legacy ? found.base : songBase(song.title)));
        entries.set(`${outcome.base}.json`, { name: `${outcome.base}.json`, uri: '', isDirectory: false });
        entries.set(outcome.audioName, { name: outcome.audioName, uri: outcome.audioUri, isDirectory: false });
        audioFiles.set(song.id, { name: outcome.audioName, uri: outcome.audioUri, isDirectory: false });
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
      const file = audioFiles.get(song.id);
      try {
        if (file && !inFolder.has(file.name)) {
          const mime = file.name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg';
          await port.write(path, file.name, mime, { uri: file.uri || song.audioUri! });
          inFolder.set(file.name, { name: file.name, uri: '', isDirectory: false });
          report.playlistCopies += 1;
        } else if (!file) {
          report.failed += 1;
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
