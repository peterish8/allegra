import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReduceMotion, SharedValue, cancelAnimation, runOnJS, runOnUI, startMapper, stopMapper, useAnimatedReaction, useDerivedValue, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Motion } from '../constants/allegraTheme';
import { takeOpenTracking, takeOpenVelocity } from './playerSheet';
import { settleTarget, sheetOpeningStart, sheetProgressAt, sheetYForDrag } from './playerTransition';
import { nextSheetSession, playerCoverHandoff, playerDrag, playerSheetProgress, playerSheetSession } from './sheetProgress';

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
  /** The closed sheet has handed the bottom bar to the mini player (UI thread), ahead of the route going. */
  handedOff: SharedValue<boolean>;
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
  sheet.handedOff.value = false;
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
  sheet.handedOff.value = false;
  sheet.generation.value += 1;
  sheet.sheetY.value = sheet.reduceMotion
    ? withTiming(0, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.Never })
    : withSpring(0, { ...Motion.spring.player, velocity });
}

/**
 * Presentation only. Audio, seeking and queue ownership stay outside this hook.
 *
 * A drag from the mini player always opens the sheet under the finger (owner, 1.69.0: the sheet follows the finger
 * both ways at any speed). `takeOpenTracking` is true only for that drag; a tap or a deep link opens on a spring.
 *
 * Ownership of the bottom bar (2026-11-16): with the pill navigation the mini player rides the sheet's edge and is
 * the only compact bar. When a close lands, the sheet hides itself on the UI thread in the same frame
 * (`handedOff`), so the frame looks the same whether JavaScript removes the route at once or a few frames later.
 * The classic bar is not drawn while the player is up, so there the sheet stays until the bar is revealed and the
 * route goes in one commit. `ridesPill` says which of the two this is.
 */
export function usePlayerSheetMotion(restY: number, instant: boolean, reduceMotion: boolean, revealMini: () => void, ridesPill = true) {
  const [holdRoute, setHoldRoute] = useState(true);
  const [session] = useState(nextSheetSession);
  const [opening] = useState(() => {
    const dragOpen = takeOpenTracking();
    const velocity = takeOpenVelocity();
    return { ...sheetOpeningStart(instant, dragOpen, playerDrag.y.value, restY), velocity };
  });
  const tracked = useSharedValue(opening.tracked);
  const sheetY = useSharedValue(opening.y);
  const closing = useSharedValue(false);
  const handedOff = useSharedValue(false);
  const generation = useSharedValue(0);
  const progress = useDerivedValue(() => sheetProgressAt(sheetY.value, restY));
  const mounted = useRef(true);
  /** The close whose completion asked for the route to go; checked again just before it goes. */
  const leaving = useRef<number | null>(null);
  const finishClose = useCallback((expected: number) => {
    // A cancelled spring may already have queued its JS callback. A new grab invalidates it.
    if (!mounted.current || !closing.value || generation.value !== expected) return;
    // A newer sheet owns the mini player's hide flag: never reveal the mini player over it.
    if (playerSheetSession.value === session) revealMini();
    leaving.current = expected;
    setHoldRoute(false);
  }, [closing, generation, revealMini, session]);
  const animateClose = useCallback((velocity = 0) => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    const expected = ++generation.value;
    const done = (finished?: boolean) => {
      'worklet';
      if (!finished || !closing.value || generation.value !== expected) return;
      // The pill is already drawn over the dock: hand the bar over on this frame, before the route goes.
      if (ridesPill) handedOff.value = true;
      runOnJS(finishClose)(expected);
    };
    sheetY.value = reduceMotion
      ? withTiming(restY, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.Never }, done)
      : withSpring(restY, { ...Motion.spring.player, velocity }, done);
  }, [closing, generation, finishClose, sheetY, handedOff, reduceMotion, restY, ridesPill]);
  const sheet = useMemo<SheetControls>(
    () => ({ sheetY, progress, closing, generation, tracked, handedOff, restY, reduceMotion, animateClose }),
    [sheetY, progress, closing, generation, tracked, handedOff, restY, reduceMotion, animateClose],
  );
  /** True while the route should still go: the close that asked for it has not been grabbed since. */
  const shouldLeave = useCallback(() => leaving.current !== null && closing.value && generation.value === leaving.current, [closing, generation]);

  // Claim the hand-over before the first frame, so the publisher below writes from it.
  useLayoutEffect(() => {
    playerSheetSession.value = session;
    playerCoverHandoff.value = ridesPill && !reduceMotion;
  }, [session, ridesPill, reduceMotion]);
  // Publish the progress through a mapper that names `playerSheetProgress` as its output: Reanimated sorts every
  // mapper that reads it (the pill, the tab bar, Create) after this one, so they draw the same frame as the sheet.
  // A reaction declares no outputs, and its readers could lag a frame behind (two players for a frame).
  useEffect(() => {
    const id = startMapper(() => {
      'worklet';
      if (playerSheetSession.value === session) playerSheetProgress.value = sheetProgressAt(sheetY.value, restY);
    }, [sheetY, playerSheetSession], [playerSheetProgress]);
    return () => stopMapper(id);
  }, [sheetY, restY, session]);
  useAnimatedReaction(() => playerDrag.y.value, y => {
    if (tracked.value) sheetY.value = sheetYForDrag(y, 0, restY);
  });
  useAnimatedReaction(() => playerDrag.ended.value, (count, previous) => {
    if (previous === null || count === previous || !tracked.value) return;
    tracked.value = false;
    settleSheet(sheet, playerDrag.velocity.value);
  });
  useEffect(() => {
    mounted.current = true;
    playerDrag.mounted.value = true;
    if (!instant) {
      if (opening.tracked) {
        // A quick release can beat route mounting: settle once from the captured position and velocity. Checked on
        // the UI thread, so it cannot race the release reaction above into a second settle.
        runOnUI(() => {
          'worklet';
          if (!tracked.value || playerDrag.tracking.value) return;
          tracked.value = false;
          settleSheet(sheet, playerDrag.velocity.value);
        })();
      } else sheetY.value = reduceMotion
        ? withTiming(0, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.Never })
        : withSpring(0, { ...Motion.spring.player, velocity: -opening.velocity });
    }
    return () => {
      mounted.current = false;
      generation.value += 1;
      cancelAnimation(sheetY);
      // A newer sheet may already own the hand-over (rapid reopen): leave its progress and flags alone.
      if (playerSheetSession.value !== session) return;
      playerSheetSession.value = 0;
      playerCoverHandoff.value = false;
      playerDrag.mounted.value = false;
      playerSheetProgress.value = 0;
    };
    // The route opens once. Layout changes must not replay its entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The close was grabbed between its completion and the route going: keep the route.
  useEffect(() => {
    if (!holdRoute && !shouldLeave()) {
      leaving.current = null;
      setHoldRoute(true);
    }
  }, [holdRoute, shouldLeave]);
  return { holdRoute, shouldLeave, sheetY, progress, closing, handedOff, animateClose, controls: sheet, session };
}
