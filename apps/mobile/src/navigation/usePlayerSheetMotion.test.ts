/* eslint-disable react-hooks/rules-of-hooks -- Hooks run against the deterministic adapter below, without a renderer. */
const mockSetHold = jest.fn();
const mockEffects: (() => void)[] = [];
const mockCleanups: (() => void)[] = [];
const mockJS: (() => void)[] = [];
const mockCompletions: ((finished: boolean) => void)[] = [];
const mockMappers: (() => void)[] = [];
const mockOpening = { tracking: false, velocity: 0 };
jest.mock('react', () => ({
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, mockSetHold],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useMemo: (make: () => unknown) => make(),
  useEffect: (effect: () => (() => void) | undefined) => mockEffects.push(() => { const cleanup = effect(); if (cleanup) mockCleanups.push(cleanup); }),
  useLayoutEffect: (effect: () => (() => void) | undefined) => mockEffects.push(() => { const cleanup = effect(); if (cleanup) mockCleanups.push(cleanup); }),
}));
jest.mock('react-native-reanimated', () => ({
  ReduceMotion: { Never: 'never' },
  useSharedValue: (value: unknown) => ({ value }),
  useDerivedValue: (read: () => number) => ({ get value() { return read(); } }),
  useAnimatedReaction: jest.fn(),
  cancelAnimation: jest.fn(),
  startMapper: (worklet: () => void) => { mockMappers.push(worklet); return mockMappers.length; },
  stopMapper: jest.fn(),
  runOnUI: (fn: () => void) => () => fn(),
  runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => mockJS.push(() => fn(...args)),
  withSpring: (target: number, _config: unknown, done?: (finished: boolean) => void) => { if (done) mockCompletions.push(done); return target; },
  withTiming: (target: number, _config: unknown, done?: (finished: boolean) => void) => { if (done) mockCompletions.push(done); return target; },
}));
jest.mock('../constants/allegraTheme', () => ({ Motion: { spring: { player: {} }, duration: { fast: 160 } } }));
jest.mock('../components/allegra/physics', () => ({ rubberBand: (y: number) => y }));
jest.mock('./playerSheet', () => ({ takeOpenTracking: () => mockOpening.tracking, takeOpenVelocity: () => mockOpening.velocity }));
jest.mock('./sheetProgress', () => {
  let last = 0;
  return {
    playerSheetProgress: { value: 0 },
    playerSheetSession: { value: 0 },
    playerCoverHandoff: { value: false },
    nextSheetSession: () => { last += 1; return last; },
    playerDrag: { mounted: { value: false }, tracking: { value: false }, y: { value: 0 }, velocity: { value: 0 }, ended: { value: 0 } },
  };
});

import { beginSheetDrag, settleSheet, usePlayerSheetMotion } from './usePlayerSheetMotion';
import { sheetYForDrag } from './playerTransition';
import { playerCoverHandoff, playerDrag, playerSheetProgress, playerSheetSession } from './sheetProgress';

function mount(reduced = false, revealMini = jest.fn(), ridesPill = true) {
  const motion = usePlayerSheetMotion(600, false, reduced, revealMini, ridesPill);
  mockEffects.splice(0).forEach(effect => effect());
  return motion;
}
function drainJS() { mockJS.splice(0).forEach(task => task()); }
function publish() { mockMappers.forEach(run => run()); }
beforeEach(() => {
  mockSetHold.mockClear(); mockEffects.length = 0; mockCleanups.length = 0; mockJS.length = 0; mockCompletions.length = 0;
  mockMappers.length = 0; mockOpening.tracking = false; mockOpening.velocity = 0;
  playerSheetSession.value = 0; playerSheetProgress.value = 0; playerCoverHandoff.value = false;
  playerDrag.tracking.value = false; playerDrag.y.value = 0; playerDrag.velocity.value = 0; playerDrag.mounted.value = false;
});

it('reveals the mini only after the close completes, and never for an interrupted close', () => {
  const revealMini = jest.fn();
  const motion = mount(false, revealMini);
  motion.animateClose();
  drainJS();
  expect(revealMini).not.toHaveBeenCalled();
  mockCompletions[0](true);
  beginSheetDrag(motion.controls);
  drainJS();
  expect(revealMini).not.toHaveBeenCalled();
  motion.animateClose();
  mockCompletions[1](true);
  drainJS();
  expect(revealMini).toHaveBeenCalledTimes(1);
  expect(mockSetHold).toHaveBeenCalledWith(false);
});

it('keeps the route until the return animation finishes', () => {
  const motion = mount();
  motion.animateClose(900);
  drainJS();
  expect(mockSetHold).not.toHaveBeenCalled();
  mockCompletions[0](true);
  drainJS();
  expect(mockSetHold).toHaveBeenCalledWith(false);
});

it('ignores an old completion already queued on JS when the closing player is grabbed again', () => {
  const motion = mount();
  motion.animateClose();
  mockCompletions[0](true);
  beginSheetDrag(motion.controls);
  motion.sheetY.value = 200;
  settleSheet(motion.controls, -900);
  drainJS();
  expect(mockSetHold).not.toHaveBeenCalled();
  expect(motion.sheetY.value).toBe(0);
});

it('does not remove a route for a cancelled animation or after unmount', () => {
  const motion = mount();
  motion.animateClose();
  mockCompletions[0](false);
  drainJS();
  expect(mockSetHold).not.toHaveBeenCalled();
  mockCompletions[0](true);
  mockCleanups.forEach(cleanup => cleanup());
  drainJS();
  expect(mockSetHold).not.toHaveBeenCalled();
});

it('settles a cancelled drag from its current position and retains dismissal under reduced motion', () => {
  const motion = mount(true);
  beginSheetDrag(motion.controls);
  motion.sheetY.value = 400;
  settleSheet(motion.controls, 0);
  expect(motion.closing.value).toBe(true);
  mockCompletions[0](true);
  drainJS();
  expect(mockSetHold).toHaveBeenCalledWith(false);
});

// Regression (1.69.0): a close can be caught mid-flight and turned around from the frame it is on.
it('turns a close around from the current frame when grabbed, and reopens without removing the route', () => {
  const motion = mount();
  motion.animateClose(600);
  motion.sheetY.value = 350; // the spring's current frame when the finger lands
  const grab = beginSheetDrag(motion.controls);
  expect(grab).toBe(350);
  expect(motion.closing.value).toBe(false);
  motion.sheetY.value = sheetYForDrag(grab, -100, 600);
  expect(motion.sheetY.value).toBe(250);
  settleSheet(motion.controls, -200);
  mockCompletions.forEach(done => done(true));
  drainJS();
  expect(motion.sheetY.value).toBe(0);
  expect(mockSetHold).not.toHaveBeenCalled();
});

// 2026-11-16: the close handoff. These cover the four regressions the Android plan names.
describe('the close hand-over', () => {
  it('hands the bar to the riding mini player on the frame the close lands, before JS removes the route', () => {
    const motion = mount();
    motion.animateClose();
    expect(motion.handedOff.value).toBe(false);
    mockCompletions[0](true);
    // UI thread: the sheet is already clear of the dock; JS has not run yet.
    expect(motion.handedOff.value).toBe(true);
    expect(mockSetHold).not.toHaveBeenCalled();
    drainJS();
    expect(mockSetHold).toHaveBeenCalledWith(false);
    expect(motion.shouldLeave()).toBe(true);
  });

  it('keeps the classic bar’s sheet until the bar is revealed with the route change', () => {
    const motion = mount(false, jest.fn(), false);
    motion.animateClose();
    mockCompletions[0](true);
    expect(motion.handedOff.value).toBe(false);
  });

  it('a grab after the close landed brings the sheet back and cancels the queued removal', () => {
    const motion = mount();
    motion.animateClose();
    mockCompletions[0](true);
    expect(motion.handedOff.value).toBe(true);
    beginSheetDrag(motion.controls);
    expect(motion.handedOff.value).toBe(false);
    drainJS();
    expect(mockSetHold).not.toHaveBeenCalled();
  });

  it('a grab after the removal was asked for keeps the route', () => {
    const motion = mount();
    motion.animateClose();
    mockCompletions[0](true);
    drainJS();
    expect(mockSetHold).toHaveBeenCalledWith(false);
    beginSheetDrag(motion.controls);
    expect(motion.shouldLeave()).toBe(false);
  });

  it('a second Back while closing starts no second close', () => {
    const motion = mount();
    motion.animateClose();
    motion.animateClose();
    expect(mockCompletions).toHaveLength(1);
  });

  // Regression: an old sheet's late completion or cleanup must not reveal the mini player or reset the progress
  // that a newer sheet (rapid reopen) now owns.
  it('ignores a stale sheet’s close callback and cleanup once a newer sheet owns the hand-over', () => {
    const oldReveal = jest.fn();
    const old = mount(false, oldReveal);
    const oldCleanups = mockCleanups.splice(0);
    const oldMappers = mockMappers.splice(0);
    old.animateClose();
    mockCompletions[0](true);
    const fresh = mount();
    expect(playerSheetSession.value).toBe(fresh.session);
    fresh.sheetY.value = 0;
    publish();
    expect(playerSheetProgress.value).toBe(1);
    drainJS(); // the old close's queued callback
    expect(oldReveal).not.toHaveBeenCalled();
    oldMappers.forEach(run => run()); // the old sheet's publisher, still running for a frame
    expect(playerSheetProgress.value).toBe(1);
    oldCleanups.forEach(cleanup => cleanup());
    expect(playerSheetSession.value).toBe(fresh.session);
    expect(playerSheetProgress.value).toBe(1);
    expect(playerDrag.mounted.value).toBe(true);
  });

  it('releases the hand-over when the owning sheet goes', () => {
    mount();
    expect(playerCoverHandoff.value).toBe(true);
    mockCleanups.forEach(cleanup => cleanup());
    expect(playerSheetSession.value).toBe(0);
    expect(playerCoverHandoff.value).toBe(false);
    expect(playerSheetProgress.value).toBe(0);
  });

  it('never flies the cover under Reduce Motion', () => {
    mount(true);
    expect(playerCoverHandoff.value).toBe(false);
  });

  // Regression: a flick that lifted before the route mounted opened from rest whatever its direction.
  it('settles a drag released before the route mounted from where the finger left it, with its velocity', () => {
    mockOpening.tracking = true;
    playerDrag.y.value = 450;
    playerDrag.tracking.value = false; // the finger already lifted
    playerDrag.velocity.value = 1200; // heading down: close again
    const motion = mount();
    expect(motion.closing.value).toBe(true);
    expect(motion.sheetY.value).toBe(600);
    expect(mockCompletions).toHaveLength(1);
  });

  it('opens a drag released before mount heading up, from where it was', () => {
    mockOpening.tracking = true;
    playerDrag.y.value = 450;
    playerDrag.velocity.value = -1200;
    const motion = mount();
    expect(motion.closing.value).toBe(false);
    expect(motion.sheetY.value).toBe(0);
  });

  it('keeps following a finger that is still down when the route mounts, and settles only on its release', () => {
    mockOpening.tracking = true;
    playerDrag.y.value = 450;
    playerDrag.tracking.value = true;
    const motion = mount();
    expect(motion.sheetY.value).toBe(450);
    expect(motion.controls.tracked.value).toBe(true);
    expect(mockCompletions).toHaveLength(0);
  });
});

it('closes onto the mini player when a reversal ends heading down', () => {
  const motion = mount();
  const grab = beginSheetDrag(motion.controls);
  motion.sheetY.value = sheetYForDrag(grab, 500, 600);
  motion.sheetY.value = sheetYForDrag(grab, 380, 600); // came back up a little
  settleSheet(motion.controls, 300);
  expect(motion.closing.value).toBe(true);
  expect(motion.sheetY.value).toBe(600);
  mockCompletions[mockCompletions.length - 1](true);
  drainJS();
  expect(mockSetHold).toHaveBeenCalledWith(false);
});
