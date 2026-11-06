/**
 * Downloading a whole playlist so it plays with no connection (1.41.0), as plain decisions with no I/O, so every edge
 * case is a unit test. `offlinePlaylist.ts` carries them out.
 *
 * A playlist holds songs on the phone (`playlist_songs`) and songs that only stream (`playlist_online_songs`). To
 * make it offline, every streaming entry needs a copy on the phone:
 *   - a copy the phone already has (the same catalog song, or the same title and lead artist) is linked, never
 *     downloaded again;
 *   - anything else is downloaded as playlist-only: it stays out of the Library list and the Downloads list.
 */
import { matchKey } from '@shared/songRef';

/** What a phone copy needs for the decisions: its identity and whether it has audio on the phone. */
export interface PhoneCopy {
  id: string;
  title: string;
  artist?: string;
  audioUri?: string;
  originId?: string;
  playlistOnly?: boolean;
  isHidden?: boolean;
}

/** A streaming entry of the playlist (`playlist_online_songs`). */
export interface StreamingEntry {
  ref: string;
  title: string;
  artist?: string;
  /** Its place in the playlist, for the downloaded copy's order. */
  order: number;
}

/** True for audio stored on this phone (a downloaded or imported file); a stream address is not offline. */
export const hasLocalAudio = (song: Pick<PhoneCopy, 'audioUri'>): boolean =>
  typeof song.audioUri === 'string' && /^(file|content):/i.test(song.audioUri);

/** The phone's copy of a song: the same catalog song first, else the same title and lead artist, with local audio. */
export const findPhoneCopy = (
  wanted: { ref?: string | null; title: string; artist?: string | null },
  phone: readonly PhoneCopy[],
): PhoneCopy | undefined => {
  const usable = phone.filter(s => hasLocalAudio(s) && !s.isHidden);
  if (wanted.ref) {
    const exact = usable.find(s => s.originId === wanted.ref);
    if (exact) return exact;
  }
  const key = matchKey(wanted.title, wanted.artist);
  return usable.find(s => matchKey(s.title, s.artist) === key);
};

export interface OfflinePlan {
  /** Phone copies to put in the playlist (no download): song id and order. */
  link: { songId: string; order: number }[];
  /** Streaming entries to download as playlist-only. */
  download: StreamingEntry[];
  /** Entries already on the phone and in the playlist. */
  ready: number;
  /** Every distinct song in the playlist. */
  total: number;
}

/**
 * What to do for a playlist. `inPlaylist` are its songs on the phone now; `streaming` its streaming entries; `phone`
 * every song on the phone (Library songs and playlist-only ones). A streaming entry a song in the playlist already
 * stands for counts once, as ready. Two entries for the same song download once.
 */
export const planOfflinePlaylist = (
  inPlaylist: readonly PhoneCopy[],
  streaming: readonly StreamingEntry[],
  phone: readonly PhoneCopy[],
): OfflinePlan => {
  const linked = new Set(inPlaylist.map(s => s.id));
  const playlistKeys = new Set(inPlaylist.filter(hasLocalAudio).map(s => matchKey(s.title, s.artist)));
  const playlistRefs = new Set(inPlaylist.filter(hasLocalAudio).flatMap(s => (s.originId ? [s.originId] : [])));
  const plan: OfflinePlan = { link: [], download: [], ready: inPlaylist.filter(hasLocalAudio).length, total: inPlaylist.length };
  const planned = new Set<string>();
  for (const entry of streaming) {
    const key = matchKey(entry.title, entry.artist);
    // The playlist already holds a phone copy of this song: nothing to do, and it is not a second song.
    if (playlistRefs.has(entry.ref) || playlistKeys.has(key)) continue;
    if (planned.has(key)) continue;
    planned.add(key);
    plan.total += 1;
    const copy = findPhoneCopy(entry, phone);
    if (copy && !linked.has(copy.id)) {
      plan.link.push({ songId: copy.id, order: entry.order });
      linked.add(copy.id);
    } else if (!copy) {
      plan.download.push(entry);
    }
  }
  return plan;
};

/**
 * A download about to start: is it already on the phone? Then nothing is fetched. `promote` is set when the listener
 * asked for a song the phone holds only for a playlist: it joins the Library instead of downloading again.
 */
export const reuseBeforeDownload = (
  wanted: { ref?: string | null; title: string; artist?: string | null; playlistOnly: boolean },
  phone: readonly PhoneCopy[],
): { copy: PhoneCopy; promote: boolean } | null => {
  const copy = findPhoneCopy(wanted, phone);
  if (!copy) return null;
  return { copy, promote: !wanted.playlistOnly && copy.playlistOnly === true };
};

/**
 * Removing a playlist's download: the playlist-only copies it can stream again leave it. A copy whose streaming
 * entry is gone (removed on another device) stays, so removing a download never removes a song from a playlist.
 */
export const copiesToUnlink = <T extends PhoneCopy>(
  inPlaylist: readonly T[],
  streaming: readonly { ref: string; title: string; artist?: string }[],
): T[] => {
  const refs = new Set(streaming.map(s => s.ref));
  const keys = new Set(streaming.map(s => matchKey(s.title, s.artist)));
  return inPlaylist.filter(s => s.playlistOnly === true && hasLocalAudio(s)
    && ((s.originId !== undefined && refs.has(s.originId)) || keys.has(matchKey(s.title, s.artist))));
};

/** Streaming entries the playlist doesn't already hold a phone copy of: a song is listed once, as its copy. */
export const withoutCopies = <R extends { ref: string; title: string; artist?: string }>(
  inPlaylist: readonly PhoneCopy[],
  streaming: readonly R[],
): R[] => {
  const copies = inPlaylist.filter(hasLocalAudio);
  const refs = new Set(copies.flatMap(s => (s.originId ? [s.originId] : [])));
  const keys = new Set(copies.map(s => matchKey(s.title, s.artist)));
  return streaming.filter(r => !refs.has(r.ref) && !keys.has(matchKey(r.title, r.artist)));
};

export type OfflineState =
  | { kind: 'none' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'partial'; done: number; total: number }
  | { kind: 'ready'; total: number };

/**
 * The playlist page's download control. `marked`: the listener downloaded it (new songs follow). `queued`: its
 * playlist-only downloads still waiting or running.
 */
export const offlineState = (marked: boolean, ready: number, total: number, queued: number): OfflineState => {
  if (!marked) return { kind: 'none' };
  if (queued > 0) return { kind: 'downloading', done: Math.min(ready, total), total };
  if (total > 0 && ready >= total) return { kind: 'ready', total };
  return { kind: 'partial', done: Math.min(ready, total), total };
};

/** The playlist page's line for that state. */
export const offlineLabel = (state: OfflineState): string => {
  switch (state.kind) {
    case 'none': return 'Download';
    case 'downloading': return `Downloading ${state.done} of ${state.total}`;
    case 'partial': return `${state.done} of ${state.total} offline`;
    case 'ready': return 'Downloaded';
  }
};
