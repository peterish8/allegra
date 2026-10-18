/**
 * The system-wide island round the camera (Android). The island itself is native Kotlin
 * (android/.../island/): an accessibility overlay that drives the Media3 session directly, so it works
 * with the app closed. JavaScript only reads its status and flips its switches for Settings.
 */
import { getNativeModule } from './nativeModule';
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
}

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
