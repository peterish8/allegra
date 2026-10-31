/**
 * Keeps JavaScript's timers running for a moment while the system island is used from another app (Android).
 *
 * React Native holds every JS timer while the app is in the background unless a headless task is running
 * (`JavaTimerManager`). The island is used from other apps, so a search or a pick that waited on a timer — a
 * request's timeout, a race with a delay — sat until the app was opened again: an online search never answered.
 * The native island module starts this task for a few seconds on each search and pick (`IslandJsAwake.kt`); the
 * task itself only waits, which is what keeps the timers going.
 */
import { AppRegistry, Platform } from 'react-native';
import { islandAwakeMs } from './dynamicIslandSetup';

/** Same key as `IslandJsAwake.TASK` in Kotlin. */
export const ISLAND_JS_AWAKE_TASK = 'IslandJsAwake';

export function registerIslandJsAwake(): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(ISLAND_JS_AWAKE_TASK, () => async (data: unknown) => {
    const ms = islandAwakeMs(data);
    if (ms > 0) await new Promise<void>(resolve => setTimeout(resolve, ms));
  });
}
