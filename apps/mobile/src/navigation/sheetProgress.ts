import { makeMutable, useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

/**
 * How far the player sheet is open: 0 = resting on the pill, 1 = full screen.
 * NowPlayingScreen writes it every frame (open, drag, close); the pill reads
 * it to hand over to the sheet — it fades as the sheet grows out of it and
 * rides the sheet's top edge, and comes back the same way.
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
 * Fluid player (1.49.0, Settings → Fluid player): the finger's side of the hand-over from the mini player to the
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

/** The mini player's cover in window coordinates (measured by the pill), where the moving cover starts. */
export const playerCoverFrom = makeMutable({ x: 0, y: 0, width: 0, height: 0, radius: 0 });
