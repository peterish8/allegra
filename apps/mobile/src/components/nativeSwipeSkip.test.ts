import * as fs from 'fs';
import * as path from 'path';
import { miniSwipe, swipeFollow } from '../playback/miniSwipe';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

// Owner, 2026-11-13: playback controls on Android's main thread. The Kotlin rule (MiniSwipe.kt) must agree with
// miniSwipe.ts; these are the cases MiniSwipeTest.kt checks, so the two files are tested against the same numbers.
describe('the Kotlin swipe rule agrees with the JavaScript one', () => {
  const W = 300;
  const cases: [number, number, number, number, boolean, 'next' | 'previous' | null][] = [
    [-80, 4, -100, W, false, 'next'],
    [80, 4, 100, W, false, 'previous'],
    [-30, 2, -100, W, false, null],
    [-30, 2, -1200, W, false, 'next'],
    [-30, 2, 1200, W, false, null],
    [-10, 1, -1200, W, false, null],
    [-90, 120, -2000, W, false, null],
    [-60, 60, -2000, W, false, null],
    [-100, 2, -100, 600, false, null],
    [-140, 2, -100, 600, false, 'next'],
    [-80, 4, -100, W, true, 'previous'],
    [80, 4, 100, W, true, 'next'],
  ];
  test.each(cases)('dx %d dy %d vx %d width %d rtl %s -> %s', (dx, dy, vx, width, rtl, expected) => {
    expect(miniSwipe(dx, dy, vx, width, rtl)).toBe(expected);
  });
  test('follow is half the finger, capped at 48', () => {
    expect(swipeFollow(-40)).toBe(-20);
    expect(swipeFollow(500)).toBe(48);
  });
  test('the Kotlin file holds the same constants', () => {
    const kotlin = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'lyricflow', 'app', 'playback', 'MiniSwipe.kt'), 'utf8');
    expect(kotlin).toContain('FLICK_VELOCITY = 800f');
    expect(kotlin).toContain('MIN_DISTANCE = 56f');
    expect(kotlin).toContain('FLICK_DISTANCE = 24f');
    expect(kotlin).toContain('FOLLOW_MAX = 48f');
  });
});

describe('the pill with the native swipe', () => {
  const pill = read('PillPlayer.tsx');
  test('steps its JavaScript pan aside when Kotlin owns the swipe', () => {
    expect(pill).toMatch(/Gesture\.Pan\(\)\.enabled\(!nativeSwipe\)/);
    expect(pill).toMatch(/<NativeSwipeSkip enabled=\{nativeSwipe\} songKey=/);
  });
  test('is off by default and switchable in Settings', () => {
    expect(read('..', 'store', 'settingsStore.ts')).toMatch(/nativeMiniSwipe: false/);
    expect(read('..', 'screens', 'SettingsScreen.tsx')).toMatch(/label="Native mini player swipes"/);
  });
  test('the wrapper falls back for remote playback, rooms and builds without the view', () => {
    const wrapper = read('NativeSwipeSkip.tsx');
    expect(wrapper).toMatch(/!remote && !inRoom && usesNativeQueue\(\)/);
    expect(wrapper).toMatch(/if \(!enabled \|\| !NativeSwipeSkipView\) return <>\{children\}<\/>/);
  });
});
