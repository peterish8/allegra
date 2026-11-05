import { seekTargetForGesture as target } from './seekTarget';
it('cancels a seek when the recording changes or starts loading', () => {
  expect(target('a', 'b', 20, 100, false)).toBeNull();
  expect(target('a', 'a', 20, 100, true)).toBeNull();
});
it('clamps a valid seek and refuses unknown duration or invalid positions', () => {
  expect(target('a', 'a', -10, 100, false)).toBe(0);
  expect(target('a', 'a', 120, 100, false)).toBe(100);
  expect(target('a', 'a', 20, 0, false)).toBeNull();
  expect(target('a', 'a', NaN, 100, false)).toBeNull();
});
