import { Platform } from 'react-native';
import { EMPTY_SUB, getNativeModule, nativeAddListener } from './nativeModule';

/** One song as the Kotlin engine needs it (see `QueueItemSpec.kt`). The full song stays in JavaScript, keyed by `id`. */
export type NativeQueueItem = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  artworkUri: string;
};

export type NativeRepeat = 'off' | 'all' | 'one';

/** The queue as the engine holds it. `ids` and `index` are in play order (what "Up next" shows); seconds, not milliseconds. */
export type NativeQueueState = {
  ids: string[];
  index: number;
  shuffle: boolean;
  repeat: NativeRepeat;
  tag: string | null;
  positionSec: number;
  /** Only from `getQueueState` / `restoreQueue`. */
  items?: NativeQueueItem[];
};

type MainPlayerNative = {
  load: (uri: string, metadata: PlayerMetadata) => Promise<void>;
  /** False when the playback service is gone (older builds return nothing). */
  play: () => boolean | void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  updateMetadata: (metadata: PlayerMetadata) => void;
  destroy: () => void;
  getVolume?: () => number;
  setVolume?: (level: number) => void;
  openOutputSwitcher?: () => boolean;
  refreshStatus?: () => void;
  setPlaybackParameters?: (speed: number, pitch: number) => boolean;
  setRepeatOne?: (on: boolean) => boolean;
  openEqualizer?: () => boolean;
  setRingtone?: (path: string, title: string) => Promise<RingtoneResult>;
  // The queue engine (Echo Music's design, in Kotlin). Every answer is true only once the change was applied.
  setQueue?: (items: NativeQueueItem[], startIndex: number, positionSec: number, play: boolean, tag: string | null) => Promise<boolean>;
  replaceQueue?: (items: NativeQueueItem[], expectTag: string | null, newTag: string | null) => Promise<boolean>;
  playNextItems?: (items: NativeQueueItem[], dropDuplicates: boolean, expectTag: string | null) => Promise<boolean>;
  addToQueueItems?: (items: NativeQueueItem[], dropDuplicates: boolean, expectTag: string | null) => Promise<boolean>;
  removeQueueItem?: (mediaId: string, expectTag: string | null) => Promise<boolean>;
  clearQueue?: () => Promise<boolean>;
  skipToNext?: () => Promise<boolean>;
  skipToPrevious?: () => Promise<boolean>;
  skipToIndex?: (position: number) => Promise<boolean>;
  setShuffle?: (on: boolean) => Promise<boolean>;
  setRepeatMode?: (mode: NativeRepeat) => Promise<boolean>;
  getQueueState?: (withItems: boolean) => Promise<NativeQueueState | null>;
  hasSavedQueue?: () => boolean;
  restoreQueue?: () => Promise<NativeQueueState | null>;
  addListener: (event: string, cb: (data: any) => void) => { remove: () => void };
};

const MainPlayerModule = getNativeModule<MainPlayerNative>('MainPlayer');

export type RingtoneResult = 'ok' | 'permission' | 'unsupported' | 'missing' | 'error';

export type PlayerMetadata = {
  title: string;
  artist: string;
  album: string;
  artworkUri: string;
  mediaId?: string;
};

/**
 * Commands that change the queue run one after another, never side by side. The native module answers each on
 * its own thread, so two calls made back to back could otherwise land in either order (a "play next" before the
 * queue it belongs to). A command's answer means the change was applied.
 */
let chain: Promise<unknown> = Promise.resolve();
let inFlight = 0;
const idleWaiters: Array<() => void> = [];

function serial<T>(run: () => Promise<T>, failed: T): Promise<T> {
  inFlight += 1;
  const next = chain.then(run, run).catch(() => failed).then(result => {
    inFlight -= 1;
    if (inFlight === 0) idleWaiters.splice(0).forEach(fn => fn());
    return result;
  });
  chain = next;
  return next;
}

/** True while a queue command is still being applied. Native events that arrive meanwhile describe a moving target. */
export const isQueueBusy = (): boolean => inFlight > 0;

/** Calls `fn` once, when no queue command is in flight (now, if none is). */
export const whenQueueIdle = (fn: () => void): void => {
  if (inFlight === 0) fn();
  else idleWaiters.push(fn);
};

/**
 * Transport commands that must land after the queue command before them (a seek into the song a `setQueue` is
 * still loading) wait behind it. When nothing is in flight they go straight through, with no added delay.
 */
function afterQueue<T>(direct: () => T, whenBusy: T): T {
  if (inFlight === 0) return direct();
  serial(async () => { direct(); return true; }, false).catch(() => undefined);
  return whenBusy;
}

export const NativeAudioPlayer = {
  isAvailable(): boolean {
    return Platform.OS === 'android' && MainPlayerModule !== null;
  },

  /** True on a build whose native player owns the queue (Android with the queue engine). */
  hasQueue(): boolean {
    return Platform.OS === 'android' && !!MainPlayerModule && typeof MainPlayerModule.setQueue === 'function';
  },

  /**
   * Make this song the playing item. The queue stays: a song it already holds is replaced in place (a fresh link
   * for an expired one); any other becomes a queue of one. The caller decides whether to play.
   */
  async load(uri: string, metadata: PlayerMetadata) {
    if (!this.isAvailable() || !MainPlayerModule) return;
    return serial(async () => { await MainPlayerModule.load(uri, metadata); return true; }, false);
  },

  /** False when there was no player to play (the service is gone): reload the song. */
  play(): boolean {
    if (!this.isAvailable() || !MainPlayerModule) return true;
    const module = MainPlayerModule;
    return afterQueue(() => module.play() !== false, true);
  },

  pause() {
    if (!this.isAvailable() || !MainPlayerModule) return;
    const module = MainPlayerModule;
    afterQueue(() => { module.pause(); return true; }, true);
  },

  seekTo(seconds: number) {
    if (!this.isAvailable() || !MainPlayerModule) return;
    const module = MainPlayerModule;
    afterQueue(() => { module.seekTo(seconds); return true; }, true);
  },

  updateMetadata(metadata: PlayerMetadata) {
    if (!this.isAvailable() || !MainPlayerModule) return;
    MainPlayerModule.updateMetadata(metadata);
  },

  destroy() {
    if (!this.isAvailable() || !MainPlayerModule) return;
    MainPlayerModule.destroy();
  },

  // -- The queue ------------------------------------------------------------------------------------------------

  /** A new queue starting at `items[startIndex]`. `tag` names it; edits made for it carry the tag back (see `expectTag`). */
  setQueue(items: NativeQueueItem[], startIndex: number, positionSec: number, play: boolean, tag: string | null): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.setQueue) return Promise.resolve(false);
    return serial(async () => !!(await module.setQueue!(items, startIndex, positionSec, play, tag)), false);
  },

  /**
   * Reorder, remove or top up without interrupting the playing song. Refused if a newer queue than `expectTag` is
   * loaded. `newTag` renames the queue (Radio makes the same song the head of another list).
   */
  replaceQueue(items: NativeQueueItem[], expectTag: string | null, newTag: string | null = null): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.replaceQueue) return Promise.resolve(false);
    return serial(async () => !!(await module.replaceQueue!(items, expectTag, newTag)), false);
  },

  playNext(items: NativeQueueItem[], dropDuplicates: boolean, expectTag: string | null): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.playNextItems) return Promise.resolve(false);
    return serial(async () => !!(await module.playNextItems!(items, dropDuplicates, expectTag)), false);
  },

  addToQueue(items: NativeQueueItem[], dropDuplicates: boolean, expectTag: string | null): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.addToQueueItems) return Promise.resolve(false);
    return serial(async () => !!(await module.addToQueueItems!(items, dropDuplicates, expectTag)), false);
  },

  removeFromQueue(mediaId: string, expectTag: string | null): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.removeQueueItem) return Promise.resolve(false);
    return serial(async () => !!(await module.removeQueueItem!(mediaId, expectTag)), false);
  },

  clearQueue(): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.clearQueue) return Promise.resolve(false);
    return serial(async () => !!(await module.clearQueue!()), false);
  },

  skipToNext(): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.skipToNext) return Promise.resolve(false);
    return serial(async () => !!(await module.skipToNext!()), false);
  },

  /** Echo's rule, applied by the engine: past 3 s it starts the song over, otherwise goes back one. */
  skipToPrevious(): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.skipToPrevious) return Promise.resolve(false);
    return serial(async () => !!(await module.skipToPrevious!()), false);
  },

  /** A tap on a row of "Up next": `position` counts in play order. */
  skipToIndex(position: number): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.skipToIndex) return Promise.resolve(false);
    return serial(async () => !!(await module.skipToIndex!(position)), false);
  },

  setShuffle(on: boolean): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.setShuffle) return Promise.resolve(false);
    return serial(async () => !!(await module.setShuffle!(on)), false);
  },

  setRepeatMode(mode: NativeRepeat): Promise<boolean> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.setRepeatMode) return Promise.resolve(false);
    return serial(async () => !!(await module.setRepeatMode!(mode)), false);
  },

  /**
   * The queue as the engine holds it (ids and cursor in play order; with `withItems`, each song's details too).
   * Null when it is empty or there is no engine.
   */
  async getQueueState(withItems = false): Promise<NativeQueueState | null> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.getQueueState) return null;
    try { return (await module.getQueueState(withItems)) ?? null; } catch { return null; }
  },

  /** Whether a queue was saved by an earlier run (does not start the service). */
  hasSavedQueue(): boolean {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.hasSavedQueue) return false;
    try { return !!module.hasSavedQueue(); } catch { return false; }
  },

  /** Puts the saved queue back, paused where it was. Null when there is none. */
  async restoreQueue(): Promise<NativeQueueState | null> {
    const module = MainPlayerModule;
    if (!this.hasQueue() || !module?.restoreQueue) return null;
    try { return (await module.restoreQueue()) ?? null; } catch { return null; }
  },

  /** System media volume, 0..1 (null where the platform has no control). */
  getVolume(): number | null {
    if (!this.isAvailable() || !MainPlayerModule?.getVolume) return null;
    try { return MainPlayerModule.getVolume(); } catch { return null; }
  },

  setVolume(level: number) {
    if (!this.isAvailable() || !MainPlayerModule?.setVolume) return;
    try { MainPlayerModule.setVolume(Math.max(0, Math.min(1, level))); } catch { /* no volume control */ }
  },

  /** Ask native to re-send the playback status (app back in the foreground). */
  refreshStatus() {
    if (!this.isAvailable() || !MainPlayerModule?.refreshStatus) return;
    try { MainPlayerModule.refreshStatus(); } catch { /* older native build */ }
  },

  /** Opens the system output picker (speaker / Bluetooth / cast). */
  openOutputSwitcher(): boolean {
    if (!this.isAvailable() || !MainPlayerModule?.openOutputSwitcher) return false;
    try { return MainPlayerModule.openOutputSwitcher(); } catch { return false; }
  },

  /** Tempo and pitch (1 = normal). False on a build without the native call. */
  setPlaybackParameters(speed: number, pitch: number): boolean {
    if (!this.isAvailable() || !MainPlayerModule?.setPlaybackParameters) return false;
    try { return MainPlayerModule.setPlaybackParameters(speed, pitch); } catch { return false; }
  },

  /** Loop the current song natively (the engine's repeat "one"; off goes back to "all"). */
  setRepeatOne(on: boolean): boolean {
    if (!this.isAvailable() || !MainPlayerModule?.setRepeatOne) return false;
    try { return MainPlayerModule.setRepeatOne(on); } catch { return false; }
  },

  /** The phone's equalizer panel for our audio session. False when there is none. */
  openEqualizer(): boolean {
    if (!this.isAvailable() || !MainPlayerModule?.openEqualizer) return false;
    try { return MainPlayerModule.openEqualizer(); } catch { return false; }
  },

  /** Copies a saved song into Ringtones and makes it the phone's ringtone. */
  async setRingtone(path: string, title: string): Promise<RingtoneResult> {
    if (!this.isAvailable() || !MainPlayerModule?.setRingtone) return 'unsupported';
    try { return await MainPlayerModule.setRingtone(path, title); } catch { return 'error'; }
  },

  addListener(
    eventName: 'onPlaybackStatus' | 'onRemoteCommand' | 'onTrackAdvanced' | 'onVolumeChanged' | 'onPlaybackError' | 'onQueueChanged' | 'onQueueLow',
    callback: (data: any) => void,
  ) {
    if (!this.isAvailable()) return EMPTY_SUB;
    return nativeAddListener(MainPlayerModule, eventName, callback);
  },
};
