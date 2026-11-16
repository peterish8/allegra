import { makeMutable, useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

/**
 * How far the player sheet is open: 0 = resting on the pill, 1 = full screen.
 * The owning sheet publishes it through a mapper that declares it as its output
 * (usePlayerSheetMotion), so every reader (the pill, the tab bar, Create) is
 * sorted after it and draws the same frame as the sheet. The pill fades as the
 * sheet grows out of it and rides the sheet's top edge, and comes back the same way.
 */
export const playerSheetProgress = makeMutable(0);

/** Create and the mini player hand over on the same animation clock. */
export const createSheetProgress = makeMutable(0);

/**
 * The bottom bar's side of the hand-over: pushed down by the sheet as it opens and back up as it
 * closes, `distance` being the bar's top from the screen bottom (`tabBarTopFromBottom`). One
 * transform on the UI thread, so it tracks the finger. Reduce Motion fades it instead.
 */
export const useTabBarPushStyle = (distance: number) => {
  const reduceMotion = useReducedMotion();
  return useAnimatedStyle(() => {
    const p = playerSheetProgress.value;
    return reduceMotion ? { opacity: 1 - p } : { transform: [{ translateY: p * distance }] };
  });
};

/**
 * The finger's side of the hand-over from the mini player to the
 * sheet. The mini player's drag writes `y` (the sheet's top edge, as NowPlayingScreen's `sheetY`: 0 = open, the rest
 * position = on the pill) while `tracking`; the sheet, mounted a few pixels into the drag, follows it. On release the
 * pill bumps `ended` with the finger's `velocity`, and the sheet settles (navigation/playerTransition `settleTarget`).
 * A flick that ends before the sheet mounted settles from its last `y` and `velocity` (`sheetOpeningStart`).
 */
export const playerDrag = {
  tracking: makeMutable(false),
  y: makeMutable(0),
  velocity: makeMutable(0),
  ended: makeMutable(0),
};

/**
 * The sheet that owns `playerSheetProgress` and the hand-over flags: 0 when no player sheet is mounted. Each mounted
 * sheet takes a new id. An old sheet's late cleanup, close callback or progress write is ignored once a newer one
 * owns the hand-over, so it can never reset progress or reveal the mini player over the new session.
 */
export const playerSheetSession = makeMutable(0);
let lastSheetSession = 0;
/** A fresh session id (JS thread). */
export const nextSheetSession = (): number => {
  lastSheetSession += 1;
  return lastSheetSession;
};

/** True when `session` may release what the player sheet holds: it still owns the hand-over, or no sheet does. */
export const isSheetSessionFree = (session: number): boolean => {
  const owner = playerSheetSession.value;
  return owner === session || owner === 0;
};
