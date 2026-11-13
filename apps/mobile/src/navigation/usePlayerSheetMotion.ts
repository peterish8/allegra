import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReduceMotion, SharedValue, cancelAnimation, runOnJS, useAnimatedReaction, useDerivedValue, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Motion } from '../constants/allegraTheme';
import { rubberBand } from '../components/allegra/physics';
import { takeOpenTracking, takeOpenVelocity } from './playerSheet';
import { settleTarget } from './playerTransition';
import { playerDrag, playerSheetProgress } from './sheetProgress';

/**
 * What the UI-thread worklets below need. Gesture callbacks call `beginSheetDrag(sheet)` and
 * `settleSheet(sheet, velocity)` directly: they are module-level worklets, so the worklet guard can see them
 * (a function destructured from a hook's result cannot be traced back to its `'worklet'` directive).
 */
export interface SheetControls {
  sheetY: SharedValue<number>;
  progress: Readonly<SharedValue<number>>;
  closing: SharedValue<boolean>;
  generation: SharedValue<number>;
  tracked: SharedValue<boolean>;
  restY: number;
  reduceMotion: boolean;
  animateClose: (velocity?: number) => void;
}

/** A grab (during an open, a close or a rest): stop the spring, invalidate its late callback, return where the sheet is. */
export function beginSheetDrag(sheet: SheetControls): number {
  'worklet';
  sheet.generation.value += 1;
  cancelAnimation(sheet.sheetY);
  sheet.closing.value = false;
  sheet.tracked.value = false;
  return sheet.sheetY.value;
}

/** A release (or a cancelled drag): close or reopen by where the sheet is and how fast it was going. */
export function settleSheet(sheet: SheetControls, velocity: number): void {
  'worklet';
  if (settleTarget(sheet.progress.value, velocity, sheet.restY) === 'closed') {
    sheet.animateClose(velocity);
    return;
  }
  sheet.closing.value = false;
  sheet.generation.value += 1;
  sheet.sheetY.value = sheet.reduceMotion
    ? withTiming(0, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.Never })
    : withSpring(0, { ...Motion.spring.player, velocity });
}

/** Presentation only. Audio, seeking and queue ownership stay outside this hook. */
export function usePlayerSheetMotion(restY: number, instant: boolean, fluid: boolean, reduceMotion: boolean, revealMini: () => void) {
  const [holdRoute, setHoldRoute] = useState(true);
  const [opening] = useState(() => ({ tracking: takeOpenTracking() && fluid && playerDrag.tracking.value, velocity: takeOpenVelocity() }));
  const tracked = useSharedValue(opening.tracking);
  const sheetY = useSharedValue(instant ? 0 : opening.tracking ? Math.min(restY, Math.max(0, playerDrag.y.value)) : restY);
  const closing = useSharedValue(false);
  const generation = useSharedValue(0);
  const progress = useDerivedValue(() => Math.min(1, Math.max(0, 1 - sheetY.value / Math.max(1, restY))));
  const mounted = useRef(true);
  const finishClose = useCallback((expected: number) => {
    // A cancelled spring may already have queued its JS callback. A new grab invalidates it.
    if (mounted.current && closing.value && generation.value === expected) {
      revealMini();
      setHoldRoute(false);
    }
  }, [closing, generation, revealMini]);
  const animateClose = useCallback((velocity = 0) => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    const expected = ++generation.value;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished && closing.value && generation.value === expected) runOnJS(finishClose)(expected);
    };
    sheetY.value = reduceMotion
      ? withTiming(restY, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.Never }, done)
      : withSpring(restY, { ...Motion.spring.player, velocity }, done);
  }, [closing, generation, finishClose, sheetY, reduceMotion, restY]);
  const sheet = useMemo<SheetControls>(
    () => ({ sheetY, progress, closing, generation, tracked, restY, reduceMotion, animateClose }),
    [sheetY, progress, closing, generation, tracked, restY, reduceMotion, animateClose],
  );
  useAnimatedReaction(() => progress.value, p => { playerSheetProgress.value = p; });
  useAnimatedReaction(() => playerDrag.y.value, y => {
    if (tracked.value) sheetY.value = y >= 0 ? Math.min(y, restY) : rubberBand(y, 120);
  });
  useAnimatedReaction(() => playerDrag.ended.value, (count, previous) => {
    if (previous === null || count === previous || !tracked.value) return;
    tracked.value = false;
    settleSheet(sheet, playerDrag.velocity.value);
  });
  useEffect(() => {
    mounted.current = true;
    playerDrag.mounted.value = true;
    // A quick release can beat route mounting: start from the captured position and settle once.
    if (!instant) {
      if (opening.tracking && !playerDrag.tracking.value) settleSheet(sheet, playerDrag.velocity.value);
      else if (!opening.tracking) sheetY.value = reduceMotion
        ? withTiming(0, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.Never })
        : withSpring(0, { ...Motion.spring.player, velocity: -opening.velocity });
    }
    return () => {
      mounted.current = false;
      generation.value += 1;
      cancelAnimation(sheetY);
      playerDrag.mounted.value = false;
      playerSheetProgress.value = 0;
    };
    // The route opens once. Layout changes must not replay its entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { holdRoute, sheetY, progress, closing, animateClose, controls: sheet };
}
