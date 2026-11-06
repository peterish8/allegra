/**
 * Holding a tab for two seconds opens a shortcut (Settings → Hold Library for 2 seconds, 1.41.0). Only Library has
 * one: its chosen playlist. The native bar times the hold itself (`NativeTabBarView.HOLD_MS`); the JS fallback bar
 * passes the same delay to its press.
 */

/** Must match `HOLD_MS` in `android/.../views/NativeTabBarView.kt`. */
export const TAB_HOLD_MS = 2000;

/** The tab that answers a hold, or null when there is nothing to open (a hold then stays an ordinary tap). */
export const holdTabFor = (holdPlaylistId: string | null, playlistIds: readonly string[]): 'Library' | null =>
  holdPlaylistId && playlistIds.includes(holdPlaylistId) ? 'Library' : null;

/** Where a hold on `route` goes: the playlist to open, or null. */
export const holdTarget = (route: string, holdPlaylistId: string | null, playlistIds: readonly string[]): string | null =>
  route === 'Library' && holdTabFor(holdPlaylistId, playlistIds) ? holdPlaylistId : null;
