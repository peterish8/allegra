/**
 * The native round buttons at the end of Now Playing's title row (`NativeSongActions`,
 * android/.../views/NativeSongActionsView.kt) only report which button was used; what each one does stays in
 * `NowPlayingControls`. Plain TypeScript so it is unit-testable. The numbers mirror `SongActionsGeometry.kt`.
 */

export type SongAction = 'fullscreen' | 'more' | 'like';

const ACTIONS: readonly string[] = ['fullscreen', 'more', 'like'];

/** The button in a native event, or null for anything this build does not know. */
export const songActionOf = (event: { nativeEvent?: { action?: unknown } } | undefined): SongAction | null => {
  const action = event?.nativeEvent?.action;
  return typeof action === 'string' && ACTIONS.includes(action) ? (action as SongAction) : null;
};

/** `roundGlass`: 38 dp buttons with the row's gap of 10. */
export const SONG_ACTION_SIZE = 38;
export const SONG_ACTION_GAP = 10;

/** How many buttons are shown: the like heart always, options and fullscreen when given. */
export const songActionCount = (hasFullscreen: boolean, hasMore: boolean): number => 1 + (hasFullscreen ? 1 : 0) + (hasMore ? 1 : 0);

/** The cluster's width in dp, without hit slop. */
export const songActionsWidth = (count: number): number =>
  count <= 0 ? 0 : count * SONG_ACTION_SIZE + (count - 1) * SONG_ACTION_GAP;

/** The like button's accessibility label, as the React Native button words it. */
export const likeLabelOf = (liked: boolean, saving: boolean): string =>
  saving ? 'Saving to Liked songs, tap to cancel' : liked ? 'Unlike' : 'Like';

/** Native where the view exists; iOS and builds without it keep the React Native buttons. */
export const shouldUseNativeSongActions = (available: boolean): boolean => available;
