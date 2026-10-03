import { makeMutable, useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

/**
 * How far the player sheet is open: 0 = resting on the pill, 1 = full screen.
 * NowPlayingScreen writes it every frame (open, drag, close); the pill reads
 * it to hand over to the sheet — it fades as the sheet grows out of it and
 * rides the sheet's top edge, and comes back the same way.
 */
export const playerSheetProgress = makeMutable(0);

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
