/**
 * JavaScript's side of the native queue (Android).
 *
 * The Kotlin engine (`QueueEngine.kt`, Echo Music's design) owns the queue: order, shuffle, repeat, next and
 * previous. `playerStore` keeps `playlistQueue` / `currentQueueIndex` only as a *mirror* for the screens that
 * draw it, and forwards every command here. Nothing in JavaScript decides what plays next on Android.
 *
 *   JavaScript -> engine   commands (`NativeAudioPlayer`, run in order; each answer means "applied")
 *   engine -> JavaScript   `onQueueChanged` (ids in play order + current index), `onTrackAdvanced`, `onQueueLow`
 *
 * The pure pieces live at the top and are tested; the little module state below keeps the full `Song` objects
 * (the engine only holds id, address, title, artist, cover) and which queue the engine has.
 */
import type { Song } from '../types/song';
import { NativeAudioPlayer, NativeQueueItem, NativeQueueState, NativeRepeat } from '../services/NativeAudioPlayer';

/** Keep in step with `QueueMath.PREVIOUS_RESTART_MS` (Echo: past 3 s, "previous" starts the song over). */
export const PREVIOUS_RESTART_SECONDS = 3;
/** Keep in step with `QueueMath.LOAD_MORE_AT` (Echo: ask for more at the playing song plus four). */
export const LOAD_MORE_AT = 5;
/** Nobody lines up more than this; a library of thousands is cut around the song that was tapped. */
export const MAX_NATIVE_QUEUE = 1_500;

/** The engine needs somewhere to play from: a song with no address stays out of its queue. */
export const toNativeItem = (song: Song): NativeQueueItem | null => {
  if (!song.audioUri) return null;
  return {
    id: song.id,
    uri: song.audioUri,
    title: song.title || 'Unknown Title',
    artist: song.artist || 'Unknown Artist',
    album: song.album || '',
    artworkUri: song.coverImageUri || '',
  };
};

export const toNativeItems = (songs: readonly Song[]): NativeQueueItem[] =>
  songs.flatMap(song => {
    const item = toNativeItem(song);
    return item ? [item] : [];
  });

/**
 * At most `max` songs around `startIndex`, and where the start song sits in them. Songs without an address are
 * counted out first, so the start index always points at the song that was meant.
 */
export const windowAround = (songs: readonly Song[], startIndex: number, max = MAX_NATIVE_QUEUE): { songs: Song[]; start: number } => {
  const startId = songs[startIndex]?.id;
  const playable = songs.filter(song => !!song.audioUri);
  const at = Math.max(0, playable.findIndex(song => song.id === startId));
  if (playable.length <= max) return { songs: playable, start: at };
  const from = Math.min(Math.max(0, at - Math.floor(max / 4)), playable.length - max);
  return { songs: playable.slice(from, from + max), start: at - from };
};

/** A usable `Song` for something only the engine knows (a queue restored after the app was killed). */
export const songFromNative = (item: NativeQueueItem, now: string = new Date().toISOString()): Song => ({
  id: item.id,
  title: item.title,
  artist: item.artist || undefined,
  album: item.album || undefined,
  gradientId: 'dynamic',
  duration: 0,
  dateCreated: now,
  dateModified: now,
  playCount: 0,
  lyrics: [],
  coverImageUri: item.artworkUri || undefined,
  audioUri: item.uri,
});

/**
 * A queue's tag names it, so an edit made for one queue is refused once another has replaced it. `session`
 * counts queues set from here; the playlist id (`library`, `stream`, ...) rides in front.
 */
export const queueTag = (playlistId: string, session: number): string => `${playlistId}#${session}`;
export const playlistIdOf = (tag: string | null | undefined): string | null => {
  if (!tag) return null;
  const at = tag.lastIndexOf('#');
  return at > 0 ? tag.slice(0, at) : tag;
};

export const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The same rule the engine uses to ask for more songs (`QueueMath.runningLow`): the playing song and few after it. */
export const isRunningLow = (length: number, index: number): boolean => index >= 0 && length - index <= LOAD_MORE_AT;

/** Whether "previous" will start the song over (the engine's rule), so the screen need not change song. */
export const previousWillRestart = (positionSec: number, index: number, repeat: NativeRepeat): boolean =>
  positionSec > PREVIOUS_RESTART_SECONDS || !(index > 0 || repeat === 'all');

/** The queue's songs in play order from the ids the engine reports; null when one is unknown (ask for the details). */
export const mirrorOf = (ids: readonly string[], lookup: (id: string) => Song | undefined): Song[] | null => {
  const songs: Song[] = [];
  for (const id of ids) {
    const song = lookup(id);
    if (!song) return null;
    songs.push(song);
  }
  return songs;
};

/** Starts a promise nobody waits for. These commands answer `false` rather than reject; this keeps a stray rejection quiet. */
export const fire = (promise: Promise<unknown>): void => {
  promise.catch(() => undefined);
};

// -- State ----------------------------------------------------------------------------------------------------

/** Every song JavaScript has handed to the engine, for drawing the queue. Trimmed to the queue on each change. */
const known = new Map<string, Song>();
let session = 0;
let currentTag: string | null = null;
let engineIds: readonly string[] = [];

export const knownSong = (id: string): Song | undefined => known.get(id);

export const rememberSongs = (songs: readonly Song[]): void => {
  for (const song of songs) known.set(song.id, song);
};

const keepOnly = (ids: readonly string[]): void => {
  const keep = new Set(ids);
  for (const id of [...known.keys()]) if (!keep.has(id)) known.delete(id);
};

/** The tag edits must carry: the queue JavaScript believes the engine holds. */
export const currentQueueTag = (): string | null => currentTag;
export const engineHolds = (id: string): boolean => engineIds.includes(id);
export const engineQueueIds = (): readonly string[] => engineIds;

/** The engine's queue was reported (an event, a state read, a restore): remember what it holds. */
export const noteEngineQueue = (state: Pick<NativeQueueState, 'ids' | 'tag'>): void => {
  engineIds = state.ids;
  currentTag = state.tag;
  keepOnly(state.ids);
};

/** The service is gone: whatever JavaScript knew of its queue is stale. */
export const forgetEngineQueue = (): void => {
  engineIds = [];
  currentTag = null;
};

const lowHandlers = new Set<(event: { size: number; mediaId: string; tag: string | null }) => void>();
/** `StreamService` listens here to top the radio up; the engine only says that the queue is running low. */
export const onQueueLow = (handler: (event: { size: number; mediaId: string; tag: string | null }) => void): (() => void) => {
  lowHandlers.add(handler);
  return () => { lowHandlers.delete(handler); };
};
export const notifyQueueLow = (event: { size: number; mediaId: string; tag: string | null }): void => {
  for (const handler of [...lowHandlers]) handler(event);
};

// -- Commands (the store forwards here on Android) -------------------------------------------------------------

export const nativeQueue = {
  /** True when the Kotlin queue engine is there to take commands. */
  available: (): boolean => NativeAudioPlayer.hasQueue(),

  /** A new queue. Resolves true once the engine holds it and the playing song is `songs[startIndex]`. */
  async setQueue(songs: readonly Song[], startIndex: number, playlistId: string, play: boolean): Promise<boolean> {
    const { songs: windowed, start } = windowAround(songs, startIndex);
    if (windowed.length === 0) return false;
    const mine = ++session;
    const tag = queueTag(playlistId, mine);
    rememberSongs(windowed);
    // From this moment edits are meant for the new queue, even before the engine has applied it: commands run in
    // order, so one made now lands after it and must carry its tag.
    noteEngineQueue({ ids: windowed.map(s => s.id), tag });
    const ok = await NativeAudioPlayer.setQueue(toNativeItems(windowed), start, 0, play, tag);
    if (!ok && mine === session) forgetEngineQueue();
    return ok;
  },

  /**
   * The same songs in a new order, or with some taken out, without interrupting the playing one. With
   * `playlistId` the queue also becomes that list (Radio).
   */
  async replace(songs: readonly Song[], playlistId?: string): Promise<boolean> {
    rememberSongs(songs);
    const items = toNativeItems(songs);
    const ids = items.map(i => i.id);
    // Only the details changed (lyrics landed): the engine's queue is already right.
    if (!playlistId && sameIds(ids, engineIds)) return true;
    const expected = currentTag;
    const renamed = playlistId ? queueTag(playlistId, ++session) : null;
    // Later commands are meant for the queue this makes, even before the engine has applied it.
    if (renamed) noteEngineQueue({ ids, tag: renamed });
    const ok = await NativeAudioPlayer.replaceQueue(items, expected, renamed);
    if (ok && !renamed && expected === currentTag) engineIds = ids;
    if (!ok && renamed) forgetEngineQueue();
    return ok;
  },

  /**
   * Add songs after the playing one (`playNext`) or at the end, dropping any other copy of them. `expectTag`
   * is the queue the songs were found for: a radio answer that arrives after a newer queue was loaded is
   * refused by the engine instead of landing in the wrong list.
   */
  async insert(songs: readonly Song[], where: 'next' | 'end', expectTag: string | null = currentTag): Promise<boolean> {
    rememberSongs(songs);
    const items = toNativeItems(songs);
    if (items.length === 0) return false;
    return where === 'next'
      ? NativeAudioPlayer.playNext(items, true, expectTag)
      : NativeAudioPlayer.addToQueue(items, true, expectTag);
  },

  /**
   * Make `song` the playing item at `uri` (a first load, a fresh link for an expired one, a reload after the
   * player was lost). The queue it belongs to is kept; when the engine does not hold the song (a service that
   * restarted) it is handed the screen's queue again. The caller decides whether to play.
   */
  async load(song: Song, uri: string, queue: readonly Song[] | null, playlistId: string | null): Promise<void> {
    const at = queue ? queue.findIndex(s => s.id === song.id) : -1;
    if (queue && queue.length > 1 && at >= 0 && !engineHolds(song.id)) {
      const songs = queue.map((s, i) => (i === at ? { ...s, audioUri: uri } : s));
      await nativeQueue.setQueue(songs, at, playlistId ?? 'queue', false);
      return;
    }
    rememberSongs([{ ...song, audioUri: uri }]);
    await NativeAudioPlayer.load(uri, {
      title: song.title || 'Unknown Title',
      artist: song.artist || 'Unknown Artist',
      album: song.album || '',
      artworkUri: song.coverImageUri || '',
      mediaId: song.id,
    });
  },

  remove: (id: string): Promise<boolean> => NativeAudioPlayer.removeFromQueue(id, currentTag),
  clear: (): Promise<boolean> => NativeAudioPlayer.clearQueue(),
  next: (): Promise<boolean> => NativeAudioPlayer.skipToNext(),
  previous: (): Promise<boolean> => NativeAudioPlayer.skipToPrevious(),
  skipTo: (position: number): Promise<boolean> => NativeAudioPlayer.skipToIndex(position),
  setShuffle: (on: boolean): Promise<boolean> => NativeAudioPlayer.setShuffle(on),
  setRepeat: (mode: NativeRepeat): Promise<boolean> => NativeAudioPlayer.setRepeatMode(mode),
};
