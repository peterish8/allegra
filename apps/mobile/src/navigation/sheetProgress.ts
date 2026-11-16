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
 * `mounted` is true while the sheet screen exists, so a flick that ends before it mounted opens it the classic way.
 */
export const playerDrag = {
  tracking: makeMutable(false),
  y: makeMutable(0),
  velocity: makeMutable(0),
  ended: makeMutable(0),
  mounted: makeMutable(false),
};

/**
 * The mini player's cover in window coordinates, measured by the pill while it rests (no sheet over it). This is
 * where the moving cover starts. A width of 0 means "no usable geometry": the sheet still opens and closes, with no
 * moving cover. The pill clears it when it unmounts or its layout changes while a sheet is up.
 */
export const playerCoverFrom = makeMutable({ x: 0, y: 0, width: 0, height: 0, radius: 0 });

/** The geometry `playerCoverFrom` holds when nothing usable is cached. */
export const NO_COVER_RECT = { x: 0, y: 0, width: 0, height: 0, radius: 0 } as const;

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

/**
 * True while the owning sheet flies one cover between the mini player and the player (pill navigation, motion on).
 * The pill hides its own cover exactly while that moving cover shows, so one thumbnail is on screen at every frame.
 */
export const playerCoverHandoff = makeMutable(false);
