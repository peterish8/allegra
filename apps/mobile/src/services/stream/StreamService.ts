/**
 * Plays catalog songs straight from the provider CDN through the normal player
 * queue (on Android the Kotlin queue engine holds it and Media3 plays remote URLs), and keeps
 * a streaming session alive the way Echo Music does:
 *
 *   - synced lyrics are fetched for the playing stream song (Echo cascade),
 *   - the queue auto-extends before it runs out ("autoplay") with YouTube
 *     Music's automix for the song, resolved to catalog audio (recommend.ts),
 *   - every stream is recorded to seed the home feed.
 */
import { prepareNextInQueue, usePlayerStore, usesNativeQueue } from '../../store/playerStore';
import { usePlaybackModesStore } from '../../store/playbackModesStore';
import type { RepeatMode } from '../../../../../packages/connect/src/types';
import { useSettingsStore } from '../../store/settingsStore';
import { currentQueueTag, fire, nativeQueue, onQueueLow } from '../../playback/nativeQueue';
import { useStreamHistoryStore } from '../../store/streamHistoryStore';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { Song, UnifiedSong } from '../../types/song';
import { recommendFor } from './recommend';
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

type QueueRouter = (songs: UnifiedSong[], next: boolean) => boolean;
let queueRouter: QueueRouter | null = null;

/**
 * Lets Connect send "play next" and queue additions to the device that is playing. The router
 * answers true when it took them; this phone's own queue is then left alone.
 */
export function setStreamQueueRouter(router: QueueRouter | null): () => void {
  queueRouter = router;
  return () => { if (queueRouter === router) queueRouter = null; };
}

function routed(songs: UnifiedSong[], next: boolean): boolean {
  try {
    return queueRouter?.(songs, next) ?? false;
  } catch {
    // Keep the phone's own queue working if Connect cannot build the command.
    return false;
  }
}

export const StreamService = {
  /** Replace the queue with `songs` and start playing at `index`. */
  play(songs: UnifiedSong[], index = 0): void {
    const playable = dedupeStreamable(songs);
    if (playable.length === 0) return;
    const target = songs[index];
    const startIndex = Math.max(0, target ? playable.findIndex(s => s.id === target.id && s.source === target.source) : 0);
    remember(playable);
    const queue = playable.map(s => toStreamSong(s));
    usePlayerStore.getState().setPlaylistQueue(STREAM_QUEUE_ID, queue, startIndex);
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
    const radio = [current, ...fresh.map(s => toStreamSong(s))];
    usePlayerStore.setState({
      playlistQueue: radio,
      currentPlaylistId: STREAM_QUEUE_ID,
      currentQueueIndex: 0,
    });
    // The engine keeps the song playing and makes the queue this list (it is now a stream queue).
    if (usesNativeQueue()) {
      fire(nativeQueue.replace(radio, STREAM_QUEUE_ID).then(() => state.reconcileNativeQueue()));
    }
    prepareNextInQueue();
    return fresh.length;
  },

  /**
   * Called whenever the current song changes. Records history, loads lyrics
   * and tops up the radio. Safe to call repeatedly for the same song.
   */
  async onSongChanged(streamId: string | null): Promise<void> {
    if (!isStreamSongId(streamId) || !streamId) return;
    const meta = catalog.get(streamId);
    if (meta) useStreamHistoryStore.getState().recordPlay(meta);
    await Promise.all([loadLyrics(streamId, meta), extendRadio(streamId)]);
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

const RADIO_THRESHOLD = 2; // extend when this few songs remain after the current one
let radioInFlight = false;

/** Queues that belong to someone else (the device playing over Connect, a shared room): never topped up here. */
const NOT_OURS = new Set(['connect', 'listen-together']);

/**
 * Whether a queue should be topped up now (Echo Music's "auto load more"). A Stream radio always keeps going; any
 * other queue of ours (Library, a playlist, search results) does when the listener has it on (Settings → Playback →
 * Keep playing similar songs). Never with repeat-one (the song loops), never for a queue that is not ours. `force` is
 * the engine saying the queue is running low by its own rule; otherwise it is the song-change safety net.
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
    const recs = await recommendFor(seed);
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
