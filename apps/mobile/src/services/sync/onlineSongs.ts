/**
 * Songs that are in the library but only online (liked or added on another device).
 * They show in Liked songs and playlists like any other song and play by streaming:
 * the catalog is asked for the song (by its exact id, else by the same title and lead
 * artist) when it is played, a few at a time, and remembered.
 */
import { fromMobileId, matchKey, parseSongRef, songRef, toMobileId, type SongRef } from '@shared/songRef';

import type { OnlineSongRow } from '../../database/syncQueries';
import { removeOnlinePlaylistSong } from '../../database/syncQueries';
import { ALLEGRA_API_URL } from '../account/config';
import { searchMusic } from '../MultiSourceSearchService';
import { StreamService } from '../stream/StreamService';
import { toStreamSong } from '../stream/streamSong';
import { prepareNextInQueue, usePlayerStore } from '../../store/playerStore';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import type { Song, UnifiedSong } from '../../types/song';
import { record } from './LibrarySync';
import { playlistItemOp } from './plan';

/** Played straight away; the rest of the list resolves behind it. */
const FIRST_WINDOW = 12;
const PARALLEL = 4;

const resolved = new Map<string, UnifiedSong>();
/**
 * When a song last found no match. The catalog search answers [] offline too, so a miss is only trusted for a
 * while: one tap on a bad network used to leave the song unplayable until the app restarted.
 */
const failedAt = new Map<string, number>();
const RETRY_MISS_MS = 10 * 60_000;
/** Bumped by every playList: a lookup that finishes after a newer pick never replaces it. */
let playRun = 0;

export const isOnlineSong = (song: { id: string; audioUri?: string }): boolean => song.id.startsWith('stream:') && !song.audioUri;

/** An online row as the lists show it: a stream song whose audio is found when it plays. */
export function onlineRowToSong(row: OnlineSongRow): Song {
  const ref = row.ref as SongRef;
  const cached = resolved.get(ref);
  return {
    ...(cached ? toStreamSong(cached) : {}),
    id: toMobileId(ref),
    title: row.title,
    artist: row.artist,
    album: row.album,
    gradientId: 'dynamic',
    duration: row.duration,
    dateCreated: new Date(row.at).toISOString(),
    dateModified: new Date(row.at).toISOString(),
    playCount: 0,
    lyrics: [],
    coverImageUri: row.artwork || cached?.highResArt || undefined,
    audioUri: cached ? toStreamSong(cached).audioUri : undefined,
  };
}

async function resolveOne(song: Song): Promise<UnifiedSong | null> {
  const ref = song.id.startsWith('stream:') ? (song.id.slice('stream:'.length) as SongRef) : null;
  if (!ref || !parseSongRef(ref)) return null;
  const hit = resolved.get(ref);
  if (hit) return hit;
  const missed = failedAt.get(ref);
  if (missed !== undefined && Date.now() - missed < RETRY_MISS_MS) return null;
  try {
    const key = matchKey(song.title, song.artist);
    const hits = await searchMusic(`${song.title} ${song.artist ?? ''}`.trim(), song.artist || undefined);
    const exact = hits.find(candidate => songRef(candidate.source, candidate.id) === ref);
    const same = exact ?? hits.find(candidate => matchKey(candidate.title, candidate.artist) === key);
    if (same && (same.streamUrl || same.downloadUrl)) {
      resolved.set(ref, same);
      return same;
    }
  } catch {
    // Offline: try again next time it is played.
    return null;
  }
  failedAt.set(ref, Date.now());
  return null;
}

/** Resolves songs a few at a time, keeping their order. Songs that cannot be found are left out. */
async function resolveAll(songs: readonly Song[]): Promise<Song[]> {
  const out: (Song | null)[] = new Array(songs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < songs.length) {
      const i = next++;
      const song = songs[i];
      if (!isOnlineSong(song)) {
        out[i] = song;
        continue;
      }
      const hit = await resolveOne(song);
      if (hit) {
        StreamService.register([hit]);
        out[i] = { ...song, ...toStreamSong(hit), id: song.id, title: song.title, artist: song.artist, coverImageUri: song.coverImageUri ?? toStreamSong(hit).coverImageUri };
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return out.filter((song): song is Song => song !== null);
}

/**
 * Plays a list that may hold online songs, starting at `index`. Downloaded-only lists
 * go straight to the queue as before. Resolves to false when nothing could be played.
 */
export async function playList(playlistId: string, songs: readonly Song[], index: number): Promise<boolean> {
  const run = ++playRun;
  const player = usePlayerStore.getState();
  if (!songs.some(isOnlineSong)) {
    player.setPlaylistQueue(playlistId, [...songs], index);
    return true;
  }
  const from = songs.slice(Math.max(0, index));
  // A tapped song that is already on the phone starts at once, with the songs after it that are too; the online
  // ones are looked up afterwards and join the queue. Waiting on the network first made a downloaded song sit
  // silent for a second or more.
  const ready = leadingPlayable(from);
  if (ready.length > 0) {
    player.setPlaylistQueue(playlistId, ready, 0);
    appendWhenResolved(playlistId, from.slice(ready.length));
    return true;
  }
  // The tapped song is online: it starts from its catalog id at once, and the songs after it are looked up behind
  // it. Looking up the first window (twelve title searches) before playing anything kept a tap silent, with the
  // last song still playing, for up to 40 s.
  const tapped = instantStreamSong(from[0]);
  if (tapped) {
    const following = leadingPlayable(from.slice(1));
    player.setPlaylistQueue(playlistId, [tapped, ...following], 0);
    appendWhenResolved(playlistId, from.slice(1 + following.length));
    return true;
  }
  const songBefore = player.currentSongId;
  const first = await resolveAll(from.slice(0, FIRST_WINDOW));
  // Something else was picked meanwhile (here or anywhere in the app): that pick stands.
  if (run !== playRun || usePlayerStore.getState().currentSongId !== songBefore) return false;
  if (first.length === 0) return false;
  usePlayerStore.getState().setPlaylistQueue(playlistId, first, 0);
  appendWhenResolved(playlistId, from.slice(FIRST_WINDOW));
  return true;
}

/**
 * An online song ready to play from its catalog id alone: Allegra's stream route (`/api/stream/:id`, the same one
 * Connect plays a ref through) finds the audio itself, so nothing is looked up first. A song looked up before
 * keeps its catalog link. Null for an id that names no catalog song. Should the route fail, playback recovery
 * finds the song in the catalog (`refreshStreamLink`).
 */
export function instantStreamSong(song: Song): Song | null {
  if (!isOnlineSong(song)) return song.audioUri ? song : null;
  const ref = fromMobileId(song.id);
  const parsed = ref ? parseSongRef(ref) : null;
  if (!ref || !parsed) return null;
  const known = resolved.get(ref);
  if (known) return { ...song, audioUri: toStreamSong(known).audioUri };
  const streamUrl = `${ALLEGRA_API_URL}/api/stream/${encodeURIComponent(parsed.source === 'gaana' ? ref : parsed.id)}`;
  // Remembered as a stream, so its lyrics and radio find it like any other.
  StreamService.register([{
    id: parsed.id,
    title: song.title,
    artist: song.artist ?? '',
    highResArt: song.coverImageUri ?? '',
    downloadUrl: streamUrl,
    streamUrl,
    source: parsed.source === 'gaana' ? 'Gaana' : 'Saavn',
    duration: song.duration,
  }]);
  return { ...song, audioUri: streamUrl };
}

/** The songs at the start of [songs] that need no lookup: up to the first online-only one. */
export function leadingPlayable(songs: readonly Song[]): Song[] {
  const end = songs.findIndex(isOnlineSong);
  return [...(end < 0 ? songs : songs.slice(0, end))];
}

/**
 * Resolves [rest] in the background and adds what it finds to the queue, if that queue is still playing: the
 * next few first, so the song after the playing one is ready long before the whole list is.
 */
function appendWhenResolved(playlistId: string, rest: readonly Song[]): void {
  if (rest.length === 0) return;
  resolveAll(rest.slice(0, FIRST_WINDOW))
    .then(more => {
      const state = usePlayerStore.getState();
      if (state.currentPlaylistId !== playlistId || !state.playlistQueue) return;
      if (more.length > 0) {
        const queued = new Set(state.playlistQueue.map(song => song.id));
        state.updateQueue([...state.playlistQueue, ...more.filter(song => !queued.has(song.id))]);
        prepareNextInQueue();
      }
      appendWhenResolved(playlistId, rest.slice(FIRST_WINDOW));
    })
    .catch(() => undefined);
}

/** Removes an online song from a playlist here and on the account. */
export async function removeOnlineFromPlaylist(playlistId: string, songId: string): Promise<void> {
  const ref = songId.slice('stream:'.length);
  if (!parseSongRef(ref)) return;
  const at = Date.now();
  await removeOnlinePlaylistSong(playlistId, ref);
  record(playlistItemOp(playlistId, ref as SongRef, false, at));
  useOnlineLibraryStore.getState().bumpPlaylists();
}
