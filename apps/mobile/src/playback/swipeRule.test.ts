import { nextSwipeIndex, previousSwipeAction } from './swipeRule';

describe('a cover swipe', () => {
  it('goes to the next song and wraps at the end of the queue', () => {
    expect(nextSwipeIndex(3, 0)).toBe(1);
    expect(nextSwipeIndex(3, 2)).toBe(0);
    expect(nextSwipeIndex(1, 0)).toBeNull();
  });

  it('restarts the current song past three seconds, like the Previous button', () => {
    expect(previousSwipeAction(10, 3, 2, 'off')).toEqual({ kind: 'restart' });
  });

  it('goes back before three seconds when a previous song exists', () => {
    expect(previousSwipeAction(2.99, 3, 2, 'off')).toEqual({ kind: 'back', index: 1 });
  });

  it('wraps to the last song when the queue repeats', () => {
    expect(previousSwipeAction(1, 3, 0, 'all')).toEqual({ kind: 'back', index: 2 });
  });

  it('restarts the first song when the queue does not repeat', () => {
    expect(previousSwipeAction(1, 3, 0, 'off')).toEqual({ kind: 'restart' });
  });

  it('does not invent an action for an invalid queue index', () => {
    expect(previousSwipeAction(1, 3, -1, 'all')).toBeNull();
    expect(previousSwipeAction(1, 0, 0, 'all')).toBeNull();
  });
});
