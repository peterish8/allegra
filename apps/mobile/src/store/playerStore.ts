import { create } from 'zustand';
import * as queries from '../database/queries';
import { Song } from '../types/song';
import { useSongsStore } from './songsStore';
import { useSettingsStore } from './settingsStore';
import { usePlaybackModesStore } from './playbackModesStore';
import { setPlaybackIntent } from '../playback/playbackIntent';
import { NativeAudioPlayer, isQueueBusy, whenQueueIdle, type NativeQueueState } from '../services/NativeAudioPlayer';
import { prefetchCover } from '../components/player/coverImages';
import {
  currentQueueTag,
  fire,
  forgetEngineQueue,
  isRunningLow,
  knownSong,
  mirrorOf,
  nativeQueue,
  noteEngineQueue,
  notifyQueueLow,
  playlistIdOf,
  previousWillRestart,
  rememberSongs,
  sameIds,
  songFromNative,
  toNativeItem,
} from '../playback/nativeQueue';

let pausedLoadSongId: string | null = null;

type PlaylistSelectionRouter = (input: { readonly playlistId: string; readonly songs: readonly Song[]; readonly startIndex: number }) => boolean;
let playlistSelectionRouter: PlaylistSelectionRouter | null = null;

/**
 * Lets Connect take a song the listener picks before this phone plays it. The router answers true
 * when the music is on another device: it sends the pick there (looking the song up first when
 * the phone cannot name it yet), or asks before playback moves here. False: play it here.
 */
export function setPlaylistSelectionRouter(router: PlaylistSelectionRouter | null): () => void {
  playlistSelectionRouter = router;
  return () => { if (playlistSelectionRouter === router) playlistSelectionRouter = null; };
}

/**
 * Which "hide the mini player" flags each screen may hold while it is the one in front. A flag still held
 * once another screen is in front has leaked (a screen that hid the pill and was left without clearing it:
 * tabs stay mounted, so a mount effect never runs its cleanup), and the pill would stay gone.
 */
const MINI_PLAYER_HIDES_ON: Readonly<Record<string, readonly string[]>> = {
  NowPlaying: ['NowPlaying'],
  EditLyrics: ['Editor'],
};

/** The flags that are still earned with `routeName` in front. Unknown (`undefined`) leaves them alone. */
export function liveMiniPlayerHides(sources: ReadonlySet<string>, routeName: string | undefined): Set<string> {
  if (!routeName) return new Set(sources);
  const allowed = MINI_PLAYER_HIDES_ON[routeName] ?? [];
  return new Set([...sources].filter(source => allowed.includes(source)));
}

/** A remote handoff may restore a track paused; both audio-load owners read this intent. */
export function shouldAutoPlayLoadedSong(songId: string): boolean {
  return pausedLoadSongId !== songId;
}

/**
 * Have the next song's cover downloaded and decoded before the skip, so Now Playing changes it with the title.
 * (It used to stage the next song in Media3 too. On Android the Kotlin queue engine holds the whole queue now,
 * so there is nothing to stage; callers still call this after they change the queue.)
 */
export function prepareNextInQueue(): void {
  const { playlistQueue, currentQueueIndex, currentSongId } = usePlayerStore.getState();
  if (!playlistQueue || playlistQueue.length < 2) return;
  if (usePlaybackModesStore.getState().repeatMode === 'off' && currentQueueIndex >= playlistQueue.length - 1) return;
  const next = playlistQueue[(currentQueueIndex + 1) % playlistQueue.length];
  if (!next || next.id === currentSongId) return;
  prefetchCover(next.coverImageUri);
}

// Module-level controls ref — written by PlayerContext at mount, read everywhere else.
// Keeps imperative player commands out of Zustand state so they don't trigger re-renders.
export const playerControls = {
  play: () => { if (__DEV__) console.warn('[playerControls] Player not initialized'); },
  pause: () => { if (__DEV__) console.warn('[playerControls] Player not initialized'); },
  seekTo: async (_pos: number) => { if (__DEV__) console.warn('[playerControls] Player not initialized'); },
  setVolume: (_volume: number) => { if (__DEV__) console.warn('[playerControls] Player not initialized'); },
  getVolume: () => 1,
  /** Seconds into the playing song (written by PlayerContext; the store does not import the UI position bus). */
  getPosition: () => 0,
};

// When the native player owns playback state (Android, via Media3), it echoes
// playWhenReady back the instant a command lands, so JS must NOT optimistically
// set isPlaying — there would be nothing for a status tick to contradict, and no
// need for the echo guard. iOS still drives expo-audio from JS and keeps both.
// PlayerContext sets this at mount.
let nativeOwnsPlaybackState = false;
export function setNativeOwnsPlaybackState(owns: boolean): void {
  nativeOwnsPlaybackState = owns;
}
export function isNativeOwningPlaybackState(): boolean {
  return nativeOwnsPlaybackState;
}

/**
 * Android with the Kotlin queue engine: the engine decides what plays next and `playlistQueue` is only its
 * mirror. Everywhere else (iPhone, tests) the queue is JavaScript's and the code below the native branches runs.
 */
export function usesNativeQueue(): boolean {
  return nativeOwnsPlaybackState && NativeAudioPlayer.hasQueue();
}

// Single owner for replace() calls. MiniPlayer and NowPlayingScreen both watch
// loadedAudioId and would otherwise both load the same track at once.
let audioLoadInFlight: string | null = null;
export function beginAudioLoad(songId: string): boolean {
  if (audioLoadInFlight === songId) return false;
  audioLoadInFlight = songId;
  return true;
}
export function endAudioLoad(songId: string): void {
  if (audioLoadInFlight === songId) audioLoadInFlight = null;
}

// The song restored at launch (last played) loads paused; every other load
// plays. Keyed to that song, so a fresh install's first tap still plays.
let restoredSongId: string | null = null;
/** True once, for the load of the song restored at launch. */
export function takeRestoredLoad(songId: string): boolean {
  if (restoredSongId !== songId) return false;
  restoredSongId = null;
  return true;
}

// Which way the last song change went, so titles and covers can move with it:
// 1 = forward (next, auto-advance), -1 = back (previous), 0 = a song picked.
let songDirection: -1 | 0 | 1 = 0;
export function lastSongDirection(): -1 | 0 | 1 {
  return songDirection;
}

// A reload that should carry on from where the song stopped (recovery after
// the player gave up, the menu's Refetch) rather than start from zero. The
// loader seeks before it plays, so there is no blip from the top.
let pendingResume: { songId: string; at: number } | null = null;
export function resumeNextLoadAt(songId: string, at: number): void {
  pendingResume = at > 0 ? { songId, at } : null;
}
/** Where the load of `songId` that just finished should start, once. */
export function takeResumePosition(songId: string): number | null {
  if (!pendingResume || pendingResume.songId !== songId) return null;
  const { at } = pendingResume;
  pendingResume = null;
  return at;
}

interface PlayerState {
  currentSongId: string | null;
  currentSong: Song | null;
  loadedAudioId: string | null; // Tracks what is actually loaded in the player
  showTransliteration: boolean;
  hideMiniPlayer: boolean;
  miniPlayerHiddenSources: Set<string>;
  
  // Playlist queue management
  playlistQueue: Song[] | null;
  currentPlaylistId: string | null;
  currentQueueIndex: number;
  
  // Playback State (for UI updates)
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  requestPlayback: (playing: boolean) => void;

  
  loadSong: (songId: string) => Promise<void>;
  setInitialSong: (song: Song) => void;
  setLoadedAudioId: (songId: string | null) => void;
  updateCurrentSong: (updates: Partial<Song>) => void;
  toggleShowTransliteration: () => void;
  setMiniPlayerHidden: (hidden: boolean) => void;
  setMiniPlayerHiddenSource: (source: string, hidden: boolean) => void;
  /** Drops hide flags the screen now in front does not own (see `liveMiniPlayerHides`). */
  reconcileMiniPlayerHides: (routeName: string | undefined) => void;
  // Playlist queue actions
  /**
   * `here`: the listener chose this phone ("Play on this phone"), so Connect is not asked where it
   * plays.
   */
  setPlaylistQueue: (playlistId: string, songs: Song[], startIndex: number, autoplay?: boolean, options?: { readonly here?: boolean }) => void;
  updateQueue: (songs: Song[]) => void;
  removeFromQueue: (songId: string) => void;
  nextInPlaylist: (automatic?: boolean) => Promise<void>;
  /** A tap on a row of Up next: `index` counts in the queue as shown (play order). */
  skipToQueueIndex: (index: number) => void;
  previousInPlaylist: () => void;
  /** The playing song changed under us (the engine advanced): update the queue cursor without reloading audio. */
  adoptPreparedTrack: (mediaId: string, index?: number) => void;
  /** The Kotlin engine reported its queue (Android): the screen's mirror follows it. */
  adoptNativeQueue: (state: NativeQueueState) => void;
  /** Read the engine's queue now and adopt it (back in the foreground, after a burst of commands). */
  reconcileNativeQueue: () => Promise<void>;
  /** Put the saved queue back at launch, paused where it was. False when there was none. */
  restoreNativeQueue: () => Promise<boolean>;
  clearPlaylistQueue: () => void;
  
  reset: () => void;
}

/**
 * What changes with the song on screen: the playlist's history, the library's "last played", and the full song
 * (lyrics) from the database. It never touches `loadedAudioId` — `loadSong` does, and a load replaces the
 * engine's queue.
 */
function noteTrackChange(song: Song): void {
  const playlistId = usePlayerStore.getState().currentPlaylistId;
  if (playlistId) useSettingsStore.getState().updatePlaylistHistory(playlistId, song.id);
  useSongsStore.getState().setCurrentSong(song);
  queries.getSongById(song.id).then(full => {
    if (full && usePlayerStore.getState().currentSongId === song.id) usePlayerStore.setState({ currentSong: full });
  }).catch(() => {});
}

/** Which way a change of place in the queue went (wrapping at the ends counts as forward / back). */
function directionOf(from: number, to: number, length: number): -1 | 0 | 1 {
  if (from < 0 || length < 2) return 0;
  const d = to - from;
  if (d === 1 || d === -(length - 1)) return 1;
  if (d === -1 || d === length - 1) return -1;
  return 0;
}

/**
 * The songs on screen for the ids the engine reports. A song already on screen keeps its full object (lyrics),
 * then what was handed to the engine, then the library, then what the engine itself knows (a restored queue).
 * Null when some id has no source: the details have to be asked for.
 */
function resolveMirror(state: NativeQueueState): Song[] | null {
  const shown = new Map<string, Song>();
  for (const song of usePlayerStore.getState().playlistQueue ?? []) shown.set(song.id, song);
  const items = state.items ? new Map(state.items.map(item => [item.id, item])) : null;
  let library: Map<string, Song> | null = null;
  return mirrorOf(state.ids, id => {
    const have = shown.get(id) ?? knownSong(id);
    if (have) return have;
    if (!library) library = new Map(useSongsStore.getState().songs.map(song => [song.id, song]));
    const fromLibrary = library.get(id);
    if (fromLibrary) return fromLibrary;
    const item = items?.get(id);
    return item ? songFromNative(item) : undefined;
  });
}

let hydrating = false;
let hydrateAgain: { withItems: boolean } | null = null;
/**
 * Reads the engine's queue and adopts it. Without `withItems` it is only the ids and the cursor. A request made
 * while a read is in flight is not dropped: that read may have started before the change that prompted it, so
 * one more follows it.
 */
async function hydrateFromEngine(withItems: boolean): Promise<void> {
  if (hydrating) {
    hydrateAgain = { withItems: withItems || (hydrateAgain?.withItems ?? false) };
    return;
  }
  hydrating = true;
  try {
    const state = await NativeAudioPlayer.getQueueState(withItems);
    if (state) applyNativeQueue(state);
  } finally {
    hydrating = false;
    const again = hydrateAgain;
    hydrateAgain = null;
    if (again) await hydrateFromEngine(again.withItems);
  }
}

/** Reads the engine's queue once no command is in flight, in case an event was set aside meanwhile. */
function scheduleReconcile(): void {
  whenQueueIdle(() => { fire(hydrateFromEngine(false)); });
}

/** Makes the screen's mirror match the engine. Does nothing when it already does (so it can never feed back). */
function applyNativeQueue(state: NativeQueueState): void {
  noteEngineQueue(state);
  // Shuffle and repeat can change from outside (Android Auto, a headset): the toggles follow.
  const modes = usePlaybackModesStore.getState();
  if (modes.shuffle !== state.shuffle || modes.repeatMode !== state.repeat) {
    usePlaybackModesStore.setState({ shuffle: state.shuffle, repeatMode: state.repeat, repeatOne: state.repeat === 'one' });
  }
  if (state.ids.length === 0) {
    if (usePlayerStore.getState().playlistQueue) usePlayerStore.setState({ playlistQueue: null, currentQueueIndex: -1 });
    return;
  }
  const songs = resolveMirror(state);
  if (!songs) {
    // Ids with no song behind them (a queue restored by the service): ask once for the details.
    if (!state.items) fire(hydrateFromEngine(true));
    return;
  }
  const prev = usePlayerStore.getState();
  const current = songs[state.index];
  const sameQueue = !!prev.playlistQueue && sameIds(prev.playlistQueue.map(song => song.id), state.ids);
  const songChanged = !!current && prev.currentSongId !== current.id;
  if (sameQueue && prev.currentQueueIndex === state.index && !songChanged) return;
  const patch: Partial<PlayerState> = { currentQueueIndex: state.index };
  if (!sameQueue) patch.playlistQueue = songs;
  const playlistId = playlistIdOf(state.tag);
  if (playlistId) patch.currentPlaylistId = playlistId;
  if (current && songChanged) {
    songDirection = directionOf(prev.currentQueueIndex, state.index, songs.length);
    patch.currentSong = current;
    patch.currentSongId = current.id;
    // The engine is already playing it: nothing may load it again (a load replaces the queue).
    patch.loadedAudioId = current.id;
  }
  usePlayerStore.setState(patch);
  if (current && songChanged) noteTrackChange(current);
}

/**
 * Hands a new queue to the engine. The shared load guard is held meanwhile: neither the mini player nor Now
 * Playing may load this song by itself (a load replaces the queue with one song). `loadedAudioId` only becomes
 * the song once the engine has really applied the queue.
 */
async function pushQueue(playlistId: string, songs: Song[], startIndex: number, autoplay: boolean): Promise<void> {
  const start = songs[startIndex];
  const claimed = beginAudioLoad(start.id);
  let applied = false;
  try {
    applied = await nativeQueue.setQueue(songs, startIndex, playlistId, autoplay);
    if (!applied) {
      // The engine did not take the queue: play the one song so a tap is never dead.
      const item = toNativeItem(start);
      if (item) {
        await NativeAudioPlayer.load(item.uri, { title: item.title, artist: item.artist, album: item.album, artworkUri: item.artworkUri, mediaId: item.id });
        applied = true;
      }
    }
  } finally {
    if (claimed) endAudioLoad(start.id);
  }
  if (applied && usePlayerStore.getState().currentSongId === start.id) usePlayerStore.setState({ loadedAudioId: start.id });
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSongId: null,
  currentSong: null,
  loadedAudioId: null,
  showTransliteration: false,
  hideMiniPlayer: false,
  miniPlayerHiddenSources: new Set(),
  
  // Playlist queue state
  playlistQueue: null,
  currentPlaylistId: null,
  currentQueueIndex: -1,
  
  isPlaying: false,
  
  // setIsPlaying is the raw setter — reserved for PlayerContext syncing native
  // status. UI buttons must use requestPlayback so the intent guard is armed.
  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

  requestPlayback: (playing: boolean) => {
    if (playing) pausedLoadSongId = null;
    if (nativeOwnsPlaybackState) {
      // Fire and let the player report back. playWhenReady flips synchronously
      // inside ExoPlayer, so the round trip is a couple of frames.
      if (playing) playerControls.play(); else playerControls.pause();
      return;
    }
    setPlaybackIntent(playing);
    if (get().isPlaying !== playing) set({ isPlaying: playing });
    if (playing) playerControls.play(); else playerControls.pause();
  },

  loadSong: async (songId: string) => {
    // 1. Optimistic Update: Get metadata + audioUri from Memory (Instant)
    // Save history if in a playlist
    const state = get();
    if (state.currentPlaylistId && songId) {
        useSettingsStore.getState().updatePlaylistHistory(state.currentPlaylistId, songId);
    }
    
    const cachedSong = useSongsStore.getState().songs.find(s => s.id === songId);

    if (cachedSong) {
        // Update UI & Audio immediately with cached data
        // Reset loadedAudioId to null to force MiniPlayer to sync new audio
        set({ currentSongId: songId, currentSong: cachedSong, loadedAudioId: null });
        
        // Update history in songsStore (triggers lastPlayed update)
        useSongsStore.getState().setCurrentSong(cachedSong);
    }

    // 2. Background Fetch: Get full lyrics from DB
    // This can take time, but UI/Audio are already running!
    try {
      const fullSong = await queries.getSongById(songId);
      if (fullSong && get().currentSongId === songId) {
        set({ currentSong: fullSong });
      }
    } catch (err) {
      if (__DEV__) console.warn('[playerStore] getSongById failed:', err);
    }
  },

  adoptPreparedTrack: (mediaId: string, index?: number) => {
    const state = get();
    if (usesNativeQueue()) {
      // A command of ours is still being applied: the engine's events describe a moving target, so the screen
      // waits and reads the settled queue instead.
      if (isQueueBusy()) { scheduleReconcile(); return; }
      const queue = state.playlistQueue;
      if (state.currentSongId === mediaId && (index === undefined || state.currentQueueIndex === index)) return;
      const at = queue && index !== undefined && queue[index]?.id === mediaId ? index : (queue?.findIndex(s => s.id === mediaId) ?? -1);
      if (!queue || at < 0) { scheduleReconcile(); return; }
      const song = queue[at];
      songDirection = directionOf(state.currentQueueIndex, at, queue.length);
      pausedLoadSongId = null;
      set({ currentQueueIndex: at, currentSong: song, currentSongId: song.id, loadedAudioId: song.id });
      noteTrackChange(song);
      return;
    }
    if (state.currentSongId === mediaId) {
      // nextInPlaylist already synced via seekToNextIfReady — still stage the one after.
      prepareNextInQueue();
      return;
    }
    pausedLoadSongId = null;
    const queue = state.playlistQueue;
    if (!queue) return;
    const idx = queue.findIndex(s => s.id === mediaId);
    if (idx < 0) return;
    const song = queue[idx];
    songDirection = 1;
    set({
      currentQueueIndex: idx,
      currentSong: song,
      currentSongId: song.id,
      loadedAudioId: song.id,
      isPlaying: true,
    });
    if (state.currentPlaylistId) {
      useSettingsStore.getState().updatePlaylistHistory(state.currentPlaylistId, song.id);
    }
    useSongsStore.getState().setCurrentSong(song);
    queries.getSongById(song.id).then(full => {
      if (full && get().currentSongId === song.id) set({ currentSong: full });
    }).catch(() => {});
    prepareNextInQueue();
  },

  setInitialSong: (song: Song) => {
      restoredSongId = song.id;
      set({ currentSongId: song.id, currentSong: song });
  },
  
  setLoadedAudioId: (id) => set({ loadedAudioId: id }),

  // ✅ Allow updating the current song (e.g. lyrics changed) without reloading audio
  updateCurrentSong: (updates: Partial<Song>) => set((state) => ({
    currentSong: state.currentSong ? { ...state.currentSong, ...updates } : null
  })),

  toggleShowTransliteration: () => set((state) => ({ showTransliteration: !state.showTransliteration })),
  
  setMiniPlayerHidden: (hidden: boolean) => {
      // Legacy support: treats as 'global' or 'manual' override
      get().setMiniPlayerHiddenSource('manual', hidden);
  },

  setMiniPlayerHiddenSource: (source: string, hidden: boolean) => set((state) => {
      const newSources = new Set(state.miniPlayerHiddenSources);
      if (hidden) {
          newSources.add(source);
      } else {
          newSources.delete(source);
      }
      return { 
          miniPlayerHiddenSources: newSources,
          hideMiniPlayer: newSources.size > 0
      };
  }),

  reconcileMiniPlayerHides: (routeName) => set((state) => {
      const live = liveMiniPlayerHides(state.miniPlayerHiddenSources, routeName);
      if (live.size === state.miniPlayerHiddenSources.size) return state;
      return { miniPlayerHiddenSources: live, hideMiniPlayer: live.size > 0 };
  }),

  adoptNativeQueue: (state: NativeQueueState) => {
    // Set aside while our own command is being applied; the settled queue is read when the last one is done.
    if (isQueueBusy()) { scheduleReconcile(); return; }
    applyNativeQueue(state);
  },

  reconcileNativeQueue: async () => {
    if (!usesNativeQueue()) return;
    await hydrateFromEngine(false);
    // The engine's "running low" is sent once per queue size, and JavaScript may have been asleep for it:
    // back in the foreground, ask again from what the queue is now.
    const { playlistQueue, currentQueueIndex, currentSongId } = get();
    if (playlistQueue && isRunningLow(playlistQueue.length, currentQueueIndex)) {
      notifyQueueLow({ size: playlistQueue.length, mediaId: currentSongId ?? '', tag: currentQueueTag() });
    }
  },

  restoreNativeQueue: async () => {
    if (!NativeAudioPlayer.hasQueue() || !NativeAudioPlayer.hasSavedQueue()) return false;
    const state = await NativeAudioPlayer.restoreQueue();
    if (!state || state.ids.length === 0) return false;
    // Adopted before any screen can ask for a load: the engine already holds the song, paused where it was.
    applyNativeQueue(state);
    return true;
  },

  // Silent Queue Update (for sorting/reordering)
  updateQueue: (newQueue: Song[]) => {
    set((state) => {
      // Try to find current song in new queue to keep index correct
      const currentId = state.currentSongId;
      let newIndex = state.currentQueueIndex;

      if (currentId) {
          const foundIndex = newQueue.findIndex(s => s.id === currentId);
          if (foundIndex !== -1) {
              newIndex = foundIndex;
          }
      }

      return {
          playlistQueue: newQueue,
          currentQueueIndex: newIndex
      };
    });
    // The engine reorders around the playing song without interrupting it.
    if (usesNativeQueue()) {
      rememberSongs(newQueue);
      fire(nativeQueue.replace(newQueue).then(() => scheduleReconcile()));
    }
  },

  // Playlist queue management
  setPlaylistQueue: (playlistId: string, songs: Song[], startIndex: number, autoplay = true, options) => {
    if (autoplay && !options?.here && playlistId !== 'connect' && playlistId !== 'listen-together') {
      try {
        if (playlistSelectionRouter?.({ playlistId, songs, startIndex })) return;
      } catch { /* Keep local playback available if Connect routing cannot build a command. */ }
    }
    songDirection = 0;
    const startSongId = songs[startIndex]?.id;
    pausedLoadSongId = startSongId && !autoplay ? startSongId : null;
    set({ 
      playlistQueue: songs,
      currentPlaylistId: playlistId,
      currentQueueIndex: startIndex,
      currentSong: songs[startIndex],
      currentSongId: startSongId || null,
    });
    if (__DEV__) {
      console.log(`[PLAYER] Set playlist queue: ${playlistId}, ${songs.length} songs, starting at ${startIndex}`);
    }
    
    // Android: the engine takes the whole queue and starts the song. (`loadSong` is not used here: it clears
    // `loadedAudioId`, and a load of one song would replace the queue the engine is being given.)
    const startSong = songs[startIndex];
    if (startSong?.audioUri && usesNativeQueue()) {
      noteTrackChange(startSong);
      get().requestPlayback(autoplay);
      fire(pushQueue(playlistId, songs, startIndex, autoplay));
      return;
    }

    // Fetch full song details (lyrics) for the starting song
    if (startSongId) {
        get().loadSong(startSongId);
        get().requestPlayback(autoplay);
    }
  },
  


  removeFromQueue: (songId: string) => {
    // ... existing implementation ...
    const state = get();
    if (!state.playlistQueue) return;

    if (usesNativeQueue()) {
      // The engine takes every copy out; if it was the playing song the engine moves on and says so. The
      // screen drops the others at once.
      if (state.currentSongId !== songId) {
        const kept = state.playlistQueue.filter(s => s.id !== songId);
        const at = state.currentSongId ? kept.findIndex(s => s.id === state.currentSongId) : -1;
        set({ playlistQueue: kept.length > 0 ? kept : null, currentQueueIndex: at >= 0 ? at : state.currentQueueIndex });
      }
      fire(nativeQueue.remove(songId).then(() => scheduleReconcile()));
      return;
    }
    
    const newQueue = state.playlistQueue.filter(s => s.id !== songId);
    const currentIndex = state.currentQueueIndex;
    
    // If currently playing song was removed, stop playback
    if (state.currentSong?.id === songId) {
      if (__DEV__) {
        console.log('[PLAYER] Currently playing song removed from queue, clearing');
      }
      set({ 
        playlistQueue: newQueue.length > 0 ? newQueue : null,
        currentSong: null,
        currentSongId: null,
        currentQueueIndex: -1
      });
      return;
    }
    
    // Adjust index if song before current was removed
    const removedIndex = state.playlistQueue.findIndex(s => s.id === songId);
    const newIndex = removedIndex < currentIndex ? currentIndex - 1 : currentIndex;
    
    set({ 
      playlistQueue: newQueue.length > 0 ? newQueue : null,
      currentQueueIndex: newIndex,
      currentPlaylistId: newQueue.length > 0 ? state.currentPlaylistId : null
    });
    
    if (__DEV__) {
      console.log(`[PLAYER] Removed ${songId} from queue, ${newQueue.length} songs remaining`);
    }
  },
  
  skipToQueueIndex: (index: number) => {
    const state = get();
    const queue = state.playlistQueue;
    if (!queue || index < 0 || index >= queue.length || index === state.currentQueueIndex) return;
    if (!usesNativeQueue()) {
      state.setPlaylistQueue(state.currentPlaylistId ?? 'queue', queue, index);
      return;
    }
    // The engine moves to that place in its queue; the screen moves at once.
    const song = queue[index];
    songDirection = directionOf(state.currentQueueIndex, index, queue.length);
    pausedLoadSongId = null;
    set({ currentQueueIndex: index, currentSong: song, currentSongId: song.id, loadedAudioId: song.id });
    noteTrackChange(song);
    fire(nativeQueue.skipTo(index).then(() => scheduleReconcile()));
  },

  nextInPlaylist: async (automatic = false) => {
    const state = get();

    // Android: the engine owns what plays next. The screen moves at once (it knows the order: its mirror is
    // the engine's queue in play order), the engine does the skip, and the settled state is read afterwards.
    if (usesNativeQueue()) {
      const queue = state.playlistQueue;
      if (!queue || queue.length === 0) {
        fire(nativeQueue.next().then(() => scheduleReconcile()));
        return;
      }
      songDirection = 1;
      const nextIndex = (state.currentQueueIndex + 1) % queue.length;
      const nextSong = queue[nextIndex];
      pausedLoadSongId = null;
      set({ currentQueueIndex: nextIndex, currentSong: nextSong, currentSongId: nextSong.id, loadedAudioId: nextSong.id });
      noteTrackChange(nextSong);
      fire(nativeQueue.next().then(() => scheduleReconcile()));
      return;
    }

    // Safety net: queue was never set (e.g. song launched via fallback path or Recently Played)
    // Rebuild from memory so auto-next still works. Read at call time: songsStore
    // must not import this module back at init (see songsStore.ts).
    if (!state.playlistQueue || state.playlistQueue.length === 0) {
      if (state.currentPlaylistId === 'library' && state.currentSongId) {
        const allSongs: Song[] = useSongsStore.getState().songs;
        if (allSongs.length > 0) {
          const idx = allSongs.findIndex((s: Song) => s.id === state.currentSongId);
          set({ playlistQueue: allSongs, currentQueueIndex: idx !== -1 ? idx : 0 });
        } else {
          return;
        }
      } else {
        return;
      }
    }

    const freshState = get();
    if (!freshState.playlistQueue) return;
    if (automatic && usePlaybackModesStore.getState().repeatMode === 'off' && freshState.currentQueueIndex >= freshState.playlistQueue.length - 1) {
      freshState.requestPlayback(false);
      return;
    }
    songDirection = 1;
    const nextIndex = (freshState.currentQueueIndex + 1) % freshState.playlistQueue.length;
    const nextSong = freshState.playlistQueue[nextIndex];
    pausedLoadSongId = null;

    // The screen answers first, in this same tick, so a skip shows at once and two quick taps do not both
    // read the same index. (JavaScript-owned queue: iPhone and tests. On Android the engine owns it, above.)
    set({
      currentQueueIndex: nextIndex,
      currentSong: nextSong,
      currentSongId: nextSong.id,
      loadedAudioId: nextSong.id,
      isPlaying: true,
    });

    // Have the audio loaded (MiniPlayer / NowPlaying see loadedAudioId unset and load it).
    set({ loadedAudioId: null });
    await get().loadSong(nextSong.id);
    if (get().currentSongId !== nextSong.id) return;
    setPlaybackIntent(true);
    playerControls.play();
    if (__DEV__) {
      console.log(`[PLAYER] Next in playlist: ${nextSong.title}`);
    }
  },

  previousInPlaylist: () => {
    const state = get();

    // Android: Echo's rule, applied by the engine - past 3 s (or with nothing before it) the song starts over,
    // otherwise it goes back one. The screen predicts the same rule so it only moves when the song does.
    if (usesNativeQueue()) {
      const queue = state.playlistQueue;
      const repeat = usePlaybackModesStore.getState().repeatMode;
      if (!queue || queue.length === 0 || previousWillRestart(playerControls.getPosition(), state.currentQueueIndex, repeat)) {
        fire(nativeQueue.previous().then(() => scheduleReconcile()));
        return;
      }
      songDirection = -1;
      const prevIndex = (state.currentQueueIndex - 1 + queue.length) % queue.length;
      const prevSong = queue[prevIndex];
      pausedLoadSongId = null;
      set({ currentQueueIndex: prevIndex, currentSong: prevSong, currentSongId: prevSong.id, loadedAudioId: prevSong.id });
      noteTrackChange(prevSong);
      fire(nativeQueue.previous().then(() => scheduleReconcile()));
      return;
    }

    if (!state.playlistQueue || state.playlistQueue.length === 0) return;

    songDirection = -1;
    const prevIndex = (state.currentQueueIndex - 1 + state.playlistQueue.length) % state.playlistQueue.length;
    const prevSong = state.playlistQueue[prevIndex];
    pausedLoadSongId = null;

    set({
      currentQueueIndex: prevIndex,
      currentSong: prevSong,
      currentSongId: prevSong.id,
      isPlaying: true // FORCE PLAY
    });

    // Trigger audio load
    get().loadSong(prevSong.id);
    setPlaybackIntent(true);
    playerControls.play();
    if (__DEV__) {
      console.log(`[PLAYER] Previous in playlist: ${prevSong.title}`);
    }
  },
  
  clearPlaylistQueue: () => {
    // The engine keeps the song that is playing and drops the rest.
    if (usesNativeQueue()) fire(nativeQueue.replace([]).then(() => scheduleReconcile()));
    set({ 
      playlistQueue: null,
      currentPlaylistId: null,
      currentQueueIndex: -1
    });
    if (__DEV__) {
      console.log('[PLAYER] Cleared playlist queue');
    }
  },

  reset: () => {
    pausedLoadSongId = null;
    // The song is gone (deleted, signed out): nothing may be left queued in the engine either.
    if (usesNativeQueue()) {
      fire(nativeQueue.clear());
      forgetEngineQueue();
    }
    set({
      currentSongId: null,
      currentSong: null,
      loadedAudioId: null,
      playlistQueue: null,
      currentPlaylistId: null,
      currentQueueIndex: -1,
    });
  },
}));
