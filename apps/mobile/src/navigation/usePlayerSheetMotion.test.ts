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

function mount(reduced = false) {
  const motion = usePlayerSheetMotion(600, false, true, reduced, jest.fn());
  mockEffects.splice(0).forEach(effect => effect());
  return motion;
}
function drainJS() { mockJS.splice(0).forEach(task => task()); }
beforeEach(() => { mockSetHold.mockClear(); mockEffects.length = 0; mockCleanups.length = 0; mockJS.length = 0; mockCompletions.length = 0; });

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
