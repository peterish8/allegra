/**
 * Plays catalog songs straight from the provider CDN through the normal player
 * queue (on Android the Kotlin queue engine holds it and Media3 plays remote URLs), and keeps
 * a streaming session alive the way Echo Music does:
 *
 *   - synced lyrics are fetched for the playing stream song (Echo cascade),
 *   - the queue auto-extends before it runs out ("autoplay") with YouTube
 *     Music's automix for the song, resolved to catalog audio (recommend.ts),
 *   - a search hit starts a song radio that re-ranks as the listener skips and
 *     finishes (`packages/shared/radio.ts`),
 *   - every stream is recorded to seed the home feed.
 */
import { creditedArtists } from '@shared/identity';
import type { ListenVerdict } from '@shared/listenSignal';
import { RadioSession, type RadioTaste } from '@shared/radio';
import { withUpcoming } from '../../../../../packages/connect/src/queueStager';
import { prepareNextInQueue, usePlayerStore, usesNativeQueue } from '../../store/playerStore';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import type { RepeatMode } from '../../../../../packages/connect/src/types';
import { useSettingsStore } from '../../store/settingsStore';
import { currentQueueTag, fire, nativeQueue, onQueueLow } from '../../playback/nativeQueue';
import { useStreamHistoryStore } from '../../store/streamHistoryStore';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { Song, UnifiedSong } from '../../types/song';
import { recommendFor } from './recommend';
import { getRecommendations } from '../MultiSourceSearchService';
import { lyricaService } from '../LyricaService';
import {
  dedupeStreamable,
  isStreamSongId,
  STREAM_QUEUE_ID,
  toStreamSong,
} from './streamSong';

/** Catalog metadata for each stream id, so radio and history can find the source song. */
const catalog = new Map<string, UnifiedSong>();
const remember = (songs: UnifiedSong[]) => {
  for (const s of songs) catalog.set(toStreamSong(s).id, s);
};

/** The song radio a search hit or the Radio menu started. Null once another queue is played. */
let radio: RadioSession<UnifiedSong> | null = null;
/** Its candidate fetch in flight, shared so a refill never asks twice. */
let radioLoad: Promise<void> = Promise.resolve();
/** Stream ids the listener queued with Play next: they stay ahead of radio picks. */
const userQueued = new Set<string>();
/** Stream ids skipped early: going back to one takes the skip back. */
const skipped = new Set<string>();
/** Stream ids that started under the current radio: only their endings teach it. */
const radioHeard = new Set<string>();
/** Radio songs kept ready after the current one. */
const RADIO_UPCOMING = 10;

type QueueRouter = (songs: UnifiedSong[], next: boolean) => boolean;
const queueRouters = new Set<QueueRouter>();

/**
 * Lets Connect send "play next" and queue additions to the device that is playing. The router
 * answers true when it took them; this phone's own queue is then left alone.
 */
export function setStreamQueueRouter(router: QueueRouter | null): () => void {
  if (router) queueRouters.add(router);
  return () => { if (router) queueRouters.delete(router); };
}

function routed(songs: UnifiedSong[], next: boolean): boolean {
  for (const router of queueRouters) {
    try { if (router(songs, next)) return true; }
    catch { /* A later router may still own this command. */ }
  }
  return false;
}

export const StreamService = {
  /** Replace the queue with `songs` and start playing at `index`. */
  play(songs: UnifiedSong[], index = 0, autoplay = true): void {
    radio = null;
    const playable = dedupeStreamable(songs);
    if (playable.length === 0) return;
    const target = songs[index];
    const startIndex = Math.max(0, target ? playable.findIndex(s => s.id === target.id && s.source === target.source) : 0);
    remember(playable);
    const queue = playable.map(s => toStreamSong(s));
    usePlayerStore.getState().setPlaylistQueue(STREAM_QUEUE_ID, queue, startIndex, autoplay);
  },

  /** Adds songs right after the current one (or starts playback when idle). */
  playNext(song: UnifiedSong): void {
    if (routed([song], true)) return;
    const state = usePlayerStore.getState();
    if (!state.playlistQueue || state.currentPlaylistId !== STREAM_QUEUE_ID) {
      StreamService.play([song], 0);
      return;
    }
    remember([song]);
    const item = toStreamSong(song);
    userQueued.add(item.id);
    if (usesNativeQueue()) {
      // The engine puts it right after the playing song (shuffle-aware) and the screen follows its report.
      fire(nativeQueue.insert([item], 'next').then(() => state.reconcileNativeQueue()));
      return;
    }
    const queue = state.playlistQueue.filter(s => s.id !== item.id);
    const at = Math.max(0, queue.findIndex(s => s.id === state.currentSongId)) + 1;
    queue.splice(at, 0, item);
    state.updateQueue(queue);
    // Media3 may already have staged the old "next" for gapless advance.
    prepareNextInQueue();
  },

  /** Adds songs to the end of the stream queue (a list still resolving in the background). */
  append(songs: UnifiedSong[]): void {
    if (songs.length > 0 && routed(songs, false)) return;
    const state = usePlayerStore.getState();
    if (!state.playlistQueue || state.currentPlaylistId !== STREAM_QUEUE_ID) return;
    const queued = state.playlistQueue.flatMap(s => [s.id, `${s.title.trim().toLowerCase()}|${(s.artist ?? '').trim().toLowerCase()}`]);
    const fresh = dedupeStreamable(songs, queued);
    if (fresh.length === 0) return;
    remember(fresh);
    if (usesNativeQueue()) {
      fire(nativeQueue.insert(fresh.map(s => toStreamSong(s)), 'end').then(() => state.reconcileNativeQueue()));
      return;
    }
    state.updateQueue([...state.playlistQueue, ...fresh.map(s => toStreamSong(s))]);
    prepareNextInQueue();
  },

  /**
   * A search hit: plays it and starts its song radio (Spotify's rule), never the rest of the
   * results. Songs the listener queued stay next. With "keep playing similar songs" off it plays
   * that one song and stops.
   */
  playFromSearch(song: UnifiedSong): void {
    const state = usePlayerStore.getState();
    const queue = state.playlistQueue ?? [];
    const at = queue.findIndex(s => s.id === state.currentSongId);
    const mine = queue.slice(at + 1).flatMap(s => (userQueued.has(s.id) ? catalog.get(s.id) ?? [] : []));
    if (!(useSettingsStore.getState().autoQueueRefill ?? true)) {
      remember([song]);
      state.setPlaylistQueue('search', [toStreamSong(song)], 0);
      return;
    }
    StreamService.play([song, ...mine], 0);
    const session = new RadioSession(song, localTaste());
    radio = session;
    radioHeard.clear();
    radioLoad = gather(session, song);
    fire(radioLoad.then(() => extendRadio(toStreamSong(song).id, true)));
  },

  /** How a song ended (the listen tracker): the radio learns and re-ranks what follows. */
  radioOutcome(streamId: string, verdict: ListenVerdict): void {
    const session = activeRadio();
    const song = catalog.get(streamId);
    if (!session || !song || !radioHeard.has(streamId)) return;
    session.record(song, verdict);
    if (verdict === 'early-skip' || verdict === 'instant-skip') skipped.add(streamId);
    rerank(session);
  },

  /**
   * "Save" for a streamed song: queue it for download so it lands in the
   * library with lyrics and art. Returns false when the song is unknown.
   */
  save(songOrStreamId: UnifiedSong | string): boolean {
    const meta = typeof songOrStreamId === 'string' ? catalog.get(songOrStreamId) : songOrStreamId;
    if (!meta) return false;
    useDownloadQueueStore.getState().addToQueue([meta]);
    return true;
  },

  /** Makes songs queued from elsewhere (synced playlists and likes) known here: likes, lyrics and history work on them. */
  register(songs: UnifiedSong[]): void {
    remember(songs);
  },

  catalogFor(streamId: string): UnifiedSong | undefined {
    return catalog.get(streamId);
  },

  /**
   * Player menu → Radio: keep the current song playing and replace what
   * follows with YouTube Music's automix for it (catalog audio). Works for a
   * song on the phone too — it becomes the head of a stream queue.
   * Resolves to how many songs were queued (0 = nothing found).
   */
  async startRadio(song: Song): Promise<number> {
    const seed: UnifiedSong = catalog.get(song.id) ?? {
      id: song.id,
      title: song.title,
      artist: song.artist ?? '',
      highResArt: song.coverImageUri ?? '',
      downloadUrl: song.audioUri ?? 'local',
      source: 'Local',
      duration: song.duration,
    };
    const recs = await recommendFor(seed, 25).catch(() => [] as UnifiedSong[]);
    const state = usePlayerStore.getState();
    if (state.currentSongId !== song.id) return 0; // skipped while it loaded
    const fresh = dedupeStreamable(recs, [song.id, `${song.title.trim().toLowerCase()}|${(song.artist ?? '').trim().toLowerCase()}`]);
    if (fresh.length === 0) return 0;
    remember(fresh);
    const current = state.currentSong ?? song;
    const queue = [current, ...fresh.map(s => toStreamSong(s))];
    usePlayerStore.setState({
      playlistQueue: queue,
      currentPlaylistId: STREAM_QUEUE_ID,
      currentQueueIndex: 0,
    });
    // The engine keeps the song playing and makes the queue this list (it is now a stream queue).
    if (usesNativeQueue()) {
      fire(nativeQueue.replace(queue, STREAM_QUEUE_ID).then(() => state.reconcileNativeQueue()));
    }
    // From here it re-ranks as the listener skips and finishes, like a search radio.
    const session = new RadioSession(seed, localTaste());
    session.add(fresh, 'mix', seed);
    radio = session;
    radioHeard.clear();
    radioHeard.add(current.id);
    radioLoad = Promise.resolve();
    prepareNextInQueue();
    return fresh.length;
  },

  /**
   * Called whenever the current song changes. Records history, loads lyrics
   * and tops up the radio. Safe to call repeatedly for the same song.
   */
  async onSongChanged(streamId: string | null): Promise<void> {
    if (!isStreamSongId(streamId) || !streamId) return;
    userQueued.delete(streamId);
    const meta = catalog.get(streamId);
    const session = activeRadio();
    if (session && meta) {
      if (skipped.delete(streamId)) session.undoSkip(meta);
      session.markPlayed(meta);
      radioHeard.add(streamId);
    }
    if (meta) useStreamHistoryStore.getState().recordPlay(meta);
    await Promise.all([loadLyrics(streamId, meta), extendRadio(streamId)]);
    warmNextLyrics();
  },
};

const lyricsInFlight = new Set<string>();

async function loadLyrics(streamId: string, meta: UnifiedSong | undefined): Promise<void> {
  const current = usePlayerStore.getState().currentSong;
  if (!current || current.id !== streamId || current.lyrics.length > 0 || lyricsInFlight.has(streamId)) return;
  lyricsInFlight.add(streamId);
  try {
    const result = await lyricaService.fetchLyrics(current.title, current.artist ?? '', false, meta?.duration ?? current.duration);
    if (!result) return;
    const lyrics = lyricaService.parseLrc(result.lyrics, meta?.duration ?? current.duration);
    if (lyrics.length === 0) return;
    const state = usePlayerStore.getState();
    // A skip while fetching must not paint these lyrics on the next song.
    if (state.currentSong?.id === streamId) state.updateCurrentSong({ lyrics, lyricSource: result.source });
    if (state.playlistQueue) {
      state.updateQueue(state.playlistQueue.map(s => (s.id === streamId ? { ...s, lyrics, lyricSource: result.source } : s)));
    }
  } catch {
    // Lyrics are a nice-to-have for a stream; playback carries on without them.
  } finally {
    lyricsInFlight.delete(streamId);
  }
}

/** Fetches the next song's lyrics ahead, so a skip finds them ready instead of starting the cascade. */
function warmNextLyrics(): void {
  const { playlistQueue, currentQueueIndex } = usePlayerStore.getState();
  const next = playlistQueue?.[currentQueueIndex + 1];
  if (!next || next.lyrics.length > 0) return;
  lyricaService.warm(next.title, next.artist ?? '', catalog.get(next.id)?.duration ?? next.duration);
}

const RADIO_THRESHOLD = 2; // extend when this few songs remain after the current one
let radioInFlight = false;

/** A shared room's queue belongs to its host: never topped up here. */
const NOT_OURS = new Set(['listen-together', 'luv-link-legacy', 'luv-link']);

/**
 * Whether a queue should be topped up now (Echo Music's "auto load more"). A Stream radio always keeps going; any
 * other queue this phone plays (Library, a playlist, search results, one handed over by another device through
 * Connect, as Spotify's autoplay carries on wherever the music is) does when the listener has it on (Settings →
 * Playback → Keep playing similar songs). Never with repeat-one (the song loops), never for a shared room's queue.
 * `force` is the engine saying the queue is running low by its own rule; otherwise it is the song-change safety net.
 */
export function shouldRefillQueue(p: {
  playlistId: string | null;
  repeat: RepeatMode;
  enabled: boolean;
  remaining: number;
  force: boolean;
}): boolean {
  if (!p.playlistId || NOT_OURS.has(p.playlistId) || p.repeat === 'one') return false;
  if (p.playlistId !== STREAM_QUEUE_ID && !p.enabled) return false;
  return p.force || p.remaining <= RADIO_THRESHOLD;
}

/** A song from the queue as a recommendation seed: the catalog's own entry when streamed, else its title and artist. */
function seedFor(song: Song): UnifiedSong {
  return catalog.get(song.id) ?? {
    id: song.id,
    title: song.title,
    artist: song.artist ?? '',
    highResArt: song.coverImageUri ?? '',
    downloadUrl: '',
    source: 'Local',
  };
}

/**
 * Tops the queue up with songs like `songId` (YouTube Music's automix, resolved to catalog audio) before it runs
 * out. The answer carries the tag of the queue it was found for, so it never lands in a queue loaded since.
 */
async function extendRadio(songId: string, force = false): Promise<void> {
  const state = usePlayerStore.getState();
  if (state.currentPlaylistId === 'luv-link') return;
  const queue = state.playlistQueue;
  if (!queue || radioInFlight) return;
  const idx = queue.findIndex(s => s.id === songId);
  if (idx < 0) return;
  const refill = shouldRefillQueue({
    playlistId: state.currentPlaylistId,
    repeat: usePlaybackModesStore.getState().repeatMode,
    enabled: useSettingsStore.getState().autoQueueRefill ?? true,
    remaining: queue.length - 1 - idx,
    force,
  });
  if (!refill) return;
  const playlistId = state.currentPlaylistId;
  const seed = seedFor(queue[idx]);
  if (!seed.title) return;

  // The queue this answer is for. If another queue has been loaded by the time the songs arrive, they are dropped.
  const tag = currentQueueTag();
  radioInFlight = true;
  try {
    const recs = await radioPicks(seed, queue);
    const latest = usePlayerStore.getState();
    if (!latest.playlistQueue || latest.currentPlaylistId !== playlistId) return;
    if (usesNativeQueue() && currentQueueTag() !== tag) return;
    const queued = latest.playlistQueue.flatMap(s => [s.id, `${s.title.trim().toLowerCase()}|${(s.artist ?? '').trim().toLowerCase()}`]);
    const fresh = dedupeStreamable(recs, queued);
    if (fresh.length === 0) return;
    remember(fresh);
    if (usesNativeQueue()) {
      // The engine refuses these if its queue is no longer the one they were found for.
      await nativeQueue.insert(fresh.map(s => toStreamSong(s)), 'end', tag);
      await latest.reconcileNativeQueue();
      return;
    }
    latest.updateQueue([...latest.playlistQueue, ...fresh.map(s => toStreamSong(s))]);
    prepareNextInQueue();
  } catch {
    // No suggestions this time: the queue ends (or repeats) as it would have.
  } finally {
    radioInFlight = false;
  }
}

// The engine says when the queue is running low (and the screen asks again when it comes back to the front).
onQueueLow(({ mediaId }) => {
  if (mediaId) fire(extendRadio(mediaId, true));
});

/** The song radio, while its stream queue is still the one playing (any other queue ends it). */
function activeRadio(): RadioSession<UnifiedSong> | null {
  if (radio && usePlayerStore.getState().currentPlaylistId !== STREAM_QUEUE_ID) radio = null;
  return radio;
}

/**
 * Candidates for `from`: the catalog's own suggestions (one call, usually first) and YouTube
 * Music's automix resolved to catalog audio (slower, closer). Resolves once either added songs.
 */
function gather(session: RadioSession<UnifiedSong>, from: UnifiedSong): Promise<void> {
  const similar = from.source === 'Saavn'
    ? getRecommendations(from.id).then(songs => session.add(songs, 'similar', from)).catch(() => 0)
    : Promise.resolve(0);
  const mix = recommendFor(from, 25).then(songs => session.add(songs, 'mix', from)).catch(() => 0);
  return new Promise(resolve => {
    let pending = 2;
    const settle = (added: number): void => {
      pending -= 1;
      if (added > 0 || pending === 0) resolve();
    };
    fire(similar.then(settle));
    fire(mix.then(settle));
  });
}

/** What follows `seed`: ranked by the search radio when one runs, else the automix as before. */
async function radioPicks(seed: UnifiedSong, queue: readonly Song[]): Promise<UnifiedSong[]> {
  const session = activeRadio();
  if (!session) return recommendFor(seed);
  await radioLoad;
  if (session.needsMore) {
    radioLoad = gather(session, session.refillSeed);
    await radioLoad;
  }
  const queued = queue.flatMap(s => catalog.get(s.id)?.id ?? []);
  return session.next(RADIO_UPCOMING, { exclude: queued }).map(pick => pick.song);
}

/** Everything after the listener's own queued songs, re-ranked. Played songs stay for Previous. */
function rerank(session: RadioSession<UnifiedSong>): void {
  const state = usePlayerStore.getState();
  const queue = state.playlistQueue;
  const current = queue?.find(s => s.id === state.currentSongId);
  if (!queue || !current || state.currentPlaylistId !== STREAM_QUEUE_ID) return;
  const mine = queue.slice(queue.indexOf(current) + 1).filter(s => userQueued.has(s.id));
  const ranked = session.next(RADIO_UPCOMING, { exclude: mine.flatMap(s => catalog.get(s.id)?.id ?? []), after: catalog.get(current.id) ?? null })
    .map(pick => pick.song);
  if (ranked.length === 0) return;
  remember(ranked);
  state.updateQueue(withUpcoming(queue, current, [...mine, ...ranked.map(s => toStreamSong(s))]));
  prepareNextInQueue();
}

/** The listener's taste as this phone knows it: the artists and languages it streams most. */
function localTaste(): RadioTaste {
  const artists = new Map<string, number>();
  const languages = new Map<string, number>();
  for (const { song, plays } of useStreamHistoryStore.getState().plays) {
    const lead = creditedArtists(song.artist)[0];
    if (lead) artists.set(lead, (artists.get(lead) ?? 0) + plays);
    if (song.language) languages.set(song.language, (languages.get(song.language) ?? 0) + plays);
  }
  const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1]);
  return {
    artists: top(artists).slice(0, 20).map(([name, score]) => ({ name, score })),
    languages: top(languages).slice(0, 3).map(([name]) => name),
  };
}
