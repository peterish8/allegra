/* eslint-disable react-hooks/rules-of-hooks -- Hooks run against the deterministic adapter below, without a renderer. */
const mockSetHold = jest.fn();
const mockEffects: (() => void)[] = [];
const mockCleanups: (() => void)[] = [];
const mockJS: (() => void)[] = [];
const mockCompletions: ((finished: boolean) => void)[] = [];
jest.mock('react', () => ({
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, mockSetHold],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useMemo: (make: () => unknown) => make(),
  useEffect: (effect: () => (() => void) | undefined) => mockEffects.push(() => { const cleanup = effect(); if (cleanup) mockCleanups.push(cleanup); }),
}));
jest.mock('react-native-reanimated', () => ({
  ReduceMotion: { Never: 'never' },
  useSharedValue: (value: unknown) => ({ value }),
  useDerivedValue: (read: () => number) => ({ get value() { return read(); } }),
  useAnimatedReaction: jest.fn(),
  cancelAnimation: jest.fn(),
  runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => mockJS.push(() => fn(...args)),
  withSpring: (target: number, _config: unknown, done?: (finished: boolean) => void) => { if (done) mockCompletions.push(done); return target; },
  withTiming: (target: number, _config: unknown, done?: (finished: boolean) => void) => { if (done) mockCompletions.push(done); return target; },
}));
jest.mock('../constants/allegraTheme', () => ({ Motion: { spring: { player: {} }, duration: { fast: 160 } } }));
jest.mock('../components/allegra/physics', () => ({ rubberBand: (y: number) => y }));
jest.mock('./playerSheet', () => ({ takeOpenTracking: () => false, takeOpenVelocity: () => 0 }));
jest.mock('./sheetProgress', () => ({ playerSheetProgress: { value: 0 }, playerDrag: { mounted: { value: false }, tracking: { value: false }, y: { value: 0 }, velocity: { value: 0 }, ended: { value: 0 } } }));

import { beginSheetDrag, settleSheet, usePlayerSheetMotion } from './usePlayerSheetMotion';
import { sheetYForDrag } from './playerTransition';

function mount(reduced = false, revealMini = jest.fn()) {
  const motion = usePlayerSheetMotion(600, false, reduced, revealMini);
  mockEffects.splice(0).forEach(effect => effect());
  return motion;
}
function drainJS() { mockJS.splice(0).forEach(task => task()); }
beforeEach(() => { mockSetHold.mockClear(); mockEffects.length = 0; mockCleanups.length = 0; mockJS.length = 0; mockCompletions.length = 0; });

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
