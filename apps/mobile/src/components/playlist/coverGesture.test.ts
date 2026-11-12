import { DECK_RESIST, deckFollow, deckSettle, deckVelocity, FLIP_DRAG, flipFromDrag, flipSettle, flipVelocity } from './playlistPage';

const SIZE = 300;

describe('turning the cover with a finger', () => {
  test('follows the finger either way and never leaves 0..1', () => {
    expect(flipFromDrag(0, SIZE)).toBe(0);
    expect(flipFromDrag(SIZE * FLIP_DRAG / 2, SIZE)).toBeCloseTo(0.5);
    expect(flipFromDrag(-SIZE * FLIP_DRAG / 2, SIZE)).toBeCloseTo(0.5);
    expect(flipFromDrag(SIZE * 5, SIZE)).toBe(1);
    expect(flipFromDrag(10, 0)).toBe(0);
  });
  test('a slow release goes to the nearer side', () => {
    expect(flipSettle(0.3, 0, SIZE)).toBe(0);
    expect(flipSettle(0.7, 0, SIZE)).toBe(1);
  });
  test('a flick carries it over, and a flick back returns it', () => {
    expect(flipSettle(0.3, 1500, SIZE)).toBe(1);
    expect(flipSettle(0.7, -1500, SIZE)).toBe(0);
  });
  test('the spring starts at the finger’s speed', () => {
    expect(flipVelocity(SIZE * FLIP_DRAG, SIZE)).toBeCloseTo(1);
    expect(flipVelocity(100, 0)).toBe(0);
  });
});

describe('swiping the deck with a finger', () => {
  test('follows one to one inside the deck and resists past the ends', () => {
    expect(deckFollow(1.4, 5)).toBe(1.4);
    expect(deckFollow(-1, 5)).toBeCloseTo(-DECK_RESIST);
    expect(deckFollow(5, 5)).toBeCloseTo(4 + DECK_RESIST);
  });
  test('a slow release settles on the nearest card', () => {
    expect(deckSettle(1.3, 0, SIZE, 5)).toBe(1);
    expect(deckSettle(1.7, 0, SIZE, 5)).toBe(2);
  });
  test('a fling moves one card, never more', () => {
    expect(deckSettle(1.1, -4000, SIZE, 9)).toBe(2);
    expect(deckSettle(1.9, 4000, SIZE, 9)).toBe(1);
    expect(deckSettle(3, -9000, SIZE, 9)).toBe(3);
  });
  test('never lands outside the deck', () => {
    expect(deckSettle(-0.4, 3000, SIZE, 5)).toBe(0);
    expect(deckSettle(4.4, -3000, SIZE, 5)).toBe(4);
    expect(deckSettle(0.4, 0, SIZE, 1)).toBe(0);
    expect(deckSettle(1, 0, 0, 5)).toBe(0);
  });
  test('the spring starts at the finger’s speed in cards a second', () => {
    expect(deckVelocity(-SIZE, SIZE)).toBeCloseTo(1);
    expect(deckVelocity(SIZE, SIZE)).toBeCloseTo(-1);
    expect(deckVelocity(100, 0)).toBe(0);
  });
});

describe('the cover component', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const src = (require('fs') as typeof import('fs')).readFileSync(require('path').join(__dirname, 'CoverFlipCard.tsx'), 'utf8');
  test('is driven by pans on the UI thread and released to springs, not a fixed-length timing', () => {
    expect(src).toMatch(/Gesture\.Pan\(\)/);
    expect(src).toMatch(/flip\.value = flipFromDrag\(/);
    expect(src).toMatch(/pos\.value = deckFollow\(/);
    expect(src).toMatch(/withSpring\(next, \{ \.\.\.FLIP_SPRING, velocity: flipVelocity/);
    expect(src).toMatch(/velocity: deckVelocity\(e\.velocityX, size\)/);
    // Timing is only the Reduce Motion path.
    expect(src.match(/withTiming\(/g)?.length).toBeLessThanOrEqual(4);
    expect(src).not.toMatch(/withTiming\(next \? 1 : 0, \{ duration: FLIP_MS, easing: Motion\.ease\.standard \}\)\s*;?\s*$/m);
  });
  test('cancels a running motion when a new touch begins, so it can be interrupted', () => {
    expect(src.match(/cancelAnimation\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
  test('animates transform and opacity only', () => {
    expect(src).not.toMatch(/\b(width|height|top|left)\s*:\s*[a-z]+\.value/);
  });
  test('keeps the Reduce Motion cross-fade and the TalkBack steps', () => {
    expect(src).toMatch(/useReducedMotion/);
    expect(src).toMatch(/name: 'increment'/);
  });
});
