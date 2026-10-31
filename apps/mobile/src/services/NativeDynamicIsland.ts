/**
 * The system-wide island round the camera (Android). The island itself is native Kotlin
 * (android/.../island/): an accessibility overlay that drives the Media3 session directly, so it works
 * with the app closed. JavaScript only reads its status and flips its switches for Settings.
 */
import { EMPTY_SUB, getNativeModule, nativeAddListener } from './nativeModule';
import { IslandStatus, IslandStyle, parseIslandStatus } from './dynamicIslandSetup';

interface DynamicIslandModule {
  status?: () => unknown;
  setEnabled?: (on: boolean) => void;
  setShowWhenIdle?: (on: boolean) => void;
  setAllowOnNativeIsland?: (on: boolean) => void;
  openAccessibilitySettings?: () => boolean;
  openAppInfo?: () => boolean;
  setLyrics?: (songId: string, atMs: number[], texts: string[]) => void;
  setLyricsTiming?: (songId: string, json: string) => void;
  clearLyrics?: () => void;
  appShown?: () => void;
  setHideInApp?: (on: boolean) => void;
  setShowLyricStrip?: (on: boolean) => void;
  setShowOnLockScreen?: (on: boolean) => void;
  setSize?: (widthPercent: number, heightPercent: number) => void;
  setStyle?: (style: string) => void;
  setPlaylists?: (json: string) => void;
  setDownloads?: (json: string) => void;
  setSearchResults?: (query: string, json: string, done: boolean) => void;
  takeOverStatus?: () => unknown;
  setTakeOverEnabled?: (on: boolean) => boolean;
  openTakeOverSettings?: () => boolean;
  outsideNow?: (packageName: string) => unknown;
  pauseOutside?: (packageName: string) => boolean;
  takeOverDone?: (ok: boolean, message: string) => boolean;
  showTakeOverSearch?: (query: string) => boolean;
  addListener?: (event: string, cb: (data: unknown) => void) => { remove: () => void };
}

/** A song picked in the island: which list it came from (a playlist id, or one of ISLAND_LISTS) and the song. */
export interface IslandPick {
  playlistId: string;
  songId: string;
}

/** The lists the island names that are not playlists (IslandLibrary.DOWNLOADS / SEARCH). */
export const ISLAND_LISTS = { downloads: 'island:downloads', search: 'island:search' } as const;

const mod = (): DynamicIslandModule | null => getNativeModule<DynamicIslandModule>('DynamicIsland');

/** Null on iOS and on a build without the module. */
export function readIslandStatus(): IslandStatus | null {
  try {
    return parseIslandStatus(mod()?.status?.());
  } catch {
    return null;
  }
}

const call = (run: (m: DynamicIslandModule) => unknown): boolean => {
  try {
    const m = mod();
    return m ? run(m) !== false : false;
  } catch {
    return false;
  }
};

export const setIslandEnabled = (on: boolean) => call(m => m.setEnabled ? m.setEnabled(on) : false);
export const setIslandShowWhenIdle = (on: boolean) => call(m => m.setShowWhenIdle ? m.setShowWhenIdle(on) : false);
export const setIslandAllowOnNativeIsland = (on: boolean) => call(m => m.setAllowOnNativeIsland ? m.setAllowOnNativeIsland(on) : false);
export const openIslandAccessibilitySettings = () => call(m => m.openAccessibilitySettings?.() ?? false);
export const openIslandAppInfo = () => call(m => m.openAppInfo?.() ?? false);
/** Hands the playing song's timed lines to the island, which follows the player's clock itself. */
export const setIslandLyrics = (songId: string, atMs: number[], texts: string[], timing?: string) =>
  call(m => timing && m.setLyricsTiming ? m.setLyricsTiming(songId, timing) : m.setLyrics ? m.setLyrics(songId, atMs, texts) : false);
export const clearIslandLyrics = () => call(m => (m.clearLyrics ? m.clearLyrics() : false));
/** Now Playing has drawn: the native launch surface can leave the player visible. */
export const notifyIslandAppShown = () => call(m => (m.appShown ? m.appShown() : false));

/** Wait for a committed frame, then a drawn frame; unmounting cancels either pending acknowledgment. */
export function notifyIslandAppShownAfterDraw(): () => void {
  let second: number | undefined;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => { notifyIslandAppShown(); });
  });
  return () => {
    cancelAnimationFrame(first);
    if (second !== undefined) cancelAnimationFrame(second);
  };
}
export const setIslandSize = (widthPercent: number, heightPercent: number) =>
  call(m => (m.setSize ? m.setSize(Math.round(widthPercent), Math.round(heightPercent)) : false));
export const setIslandStyle = (style: IslandStyle) => call(m => (m.setStyle ? m.setStyle(style) : false));
export const setIslandShowOnLockScreen = (on: boolean) =>
  call(m => (m.setShowOnLockScreen ? m.setShowOnLockScreen(on) : false));
export const setIslandShowLyricStrip = (on: boolean) => call(m => (m.setShowLyricStrip ? m.setShowLyricStrip(on) : false));
export const setIslandHideInApp = (on: boolean) => call(m => (m.setHideInApp ? m.setHideInApp(on) : false));
export const setIslandPlaylists = (json: string) => call(m => (m.setPlaylists ? m.setPlaylists(json) : false));
export const setIslandDownloads = (json: string) => call(m => (m.setDownloads ? m.setDownloads(json) : false));
/** A search's answers so far; `done` false while more may come (the island keeps saying it is looking). */
export const setIslandSearchResults = (query: string, json: string, done = true) =>
  call(m => (m.setSearchResults ? m.setSearchResults(query, json, done) : false));

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const seconds = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** Play here: the switch, and whether Android has the notification listener on (it unlocks other apps' sessions). */
export interface TakeOverStatus {
  enabled: boolean;
  listenerEnabled: boolean;
}

/** What another app plays, as the island's "Play here" button hands it over (seconds, raw titles). */
export interface IslandTakeOver {
  packageName: string;
  appLabel: string;
  title: string;
  artist: string;
  album: string;
  durationS: number;
  positionS: number;
  playing: boolean;
}

/** Another app's live position, from its media session. */
export interface OutsideNow {
  positionS: number;
  playing: boolean;
}

/** Null on iOS and on a build without the take-over functions. */
export function readTakeOverStatus(): TakeOverStatus | null {
  try {
    const raw = mod()?.takeOverStatus?.();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const d = raw as Record<string, unknown>;
    return { enabled: d.enabled === true, listenerEnabled: d.listenerEnabled === true };
  } catch {
    return null;
  }
}

export const setTakeOverEnabled = (on: boolean) => call(m => (m.setTakeOverEnabled ? m.setTakeOverEnabled(on) : false));
export const openTakeOverSettings = () => call(m => (m.openTakeOverSettings ? m.openTakeOverSettings() : false));
export const pauseOutside = (packageName: string) => call(m => (m.pauseOutside ? m.pauseOutside(packageName) : false));
/** The island leaves "Finding…" and shows [message] for a moment. */
export const takeOverDone = (ok: boolean, message: string) => call(m => (m.takeOverDone ? m.takeOverDone(ok, message) : false));
/** A miss: the island opens its search drawer with [query] typed in. */
export const showTakeOverSearch = (query: string) => call(m => (m.showTakeOverSearch ? m.showTakeOverSearch(query) : false));

/** That app's position right now; null when its session is gone (or the build has no such function). */
export function readOutsideNow(packageName: string): OutsideNow | null {
  try {
    const raw = mod()?.outsideNow?.(packageName);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const d = raw as Record<string, unknown>;
    return { positionS: seconds(d.positionS), playing: d.playing === true };
  } catch {
    return null;
  }
}

/** Songs picked in the island (Android). The island plays nothing itself: it asks the app. */
export function onIslandPick(listener: (pick: IslandPick) => void): { remove: () => void } {
  const m = mod();
  if (!m) return EMPTY_SUB;
  return nativeAddListener(m, 'onIslandPick', (data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const pick = { playlistId: text(d.playlistId), songId: text(d.songId) };
    if (pick.playlistId && pick.songId) listener(pick);
  });
}

/** "Play here" tapped on the island while another app plays. Without a package there is nothing to take over. */
export function onIslandTakeOver(listener: (song: IslandTakeOver) => void): { remove: () => void } {
  const m = mod();
  if (!m) return EMPTY_SUB;
  return nativeAddListener(m, 'onIslandTakeOver', (data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const song: IslandTakeOver = {
      packageName: text(d.packageName),
      appLabel: text(d.appLabel),
      title: text(d.title),
      artist: text(d.artist),
      album: text(d.album),
      durationS: seconds(d.durationS),
      positionS: seconds(d.positionS),
      playing: d.playing === true,
    };
    if (song.packageName && song.title) listener(song);
  });
}

/** What is typed in the island's search drawer, a moment after typing stops. */
export function onIslandSearch(listener: (query: string) => void): { remove: () => void } {
  const m = mod();
  if (!m) return EMPTY_SUB;
  return nativeAddListener(m, 'onIslandSearch', (data: unknown) => listener(text((data as Record<string, unknown> | null)?.query)));
}
