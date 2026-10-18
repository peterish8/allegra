/**
 * The system-wide island round the camera (Android). The island itself is native Kotlin
 * (android/.../island/): an accessibility overlay that drives the Media3 session directly, so it works
 * with the app closed. JavaScript only reads its status and flips its switches for Settings.
 */
import { EMPTY_SUB, getNativeModule, nativeAddListener } from './nativeModule';
import { IslandStatus, parseIslandStatus } from './dynamicIslandSetup';

interface DynamicIslandModule {
  status?: () => unknown;
  setEnabled?: (on: boolean) => void;
  setShowWhenIdle?: (on: boolean) => void;
  setAllowOnNativeIsland?: (on: boolean) => void;
  openAccessibilitySettings?: () => boolean;
  openAppInfo?: () => boolean;
  setLyrics?: (songId: string, atMs: number[], texts: string[]) => void;
  clearLyrics?: () => void;
  setHideInApp?: (on: boolean) => void;
  setShowLyricStrip?: (on: boolean) => void;
  setPlaylists?: (json: string) => void;
  setDownloads?: (json: string) => void;
  setSearchResults?: (query: string, json: string) => void;
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
export const setIslandLyrics = (songId: string, atMs: number[], texts: string[]) =>
  call(m => (m.setLyrics ? m.setLyrics(songId, atMs, texts) : false));
export const clearIslandLyrics = () => call(m => (m.clearLyrics ? m.clearLyrics() : false));
export const setIslandShowLyricStrip = (on: boolean) => call(m => (m.setShowLyricStrip ? m.setShowLyricStrip(on) : false));
export const setIslandHideInApp = (on: boolean) => call(m => (m.setHideInApp ? m.setHideInApp(on) : false));
export const setIslandPlaylists = (json: string) => call(m => (m.setPlaylists ? m.setPlaylists(json) : false));
export const setIslandDownloads = (json: string) => call(m => (m.setDownloads ? m.setDownloads(json) : false));
export const setIslandSearchResults = (query: string, json: string) =>
  call(m => (m.setSearchResults ? m.setSearchResults(query, json) : false));

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

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

/** What is typed in the island's search drawer, a moment after typing stops. */
export function onIslandSearch(listener: (query: string) => void): { remove: () => void } {
  const m = mod();
  if (!m) return EMPTY_SUB;
  return nativeAddListener(m, 'onIslandSearch', (data: unknown) => listener(text((data as Record<string, unknown> | null)?.query)));
}
