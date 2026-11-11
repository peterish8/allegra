/**
 * Where a cover swipe goes.
 *
 * The cover gesture follows the previous button: after three seconds, or at the first song without repeat-all,
 * a right swipe restarts the current song. Otherwise it previews and selects the previous song. Left always wraps
 * to the first song, as Media3's skipToNext does.
 */
export type RepeatKind = 'off' | 'all' | 'one';
export type PreviousSwipe = { readonly kind: 'restart' } | { readonly kind: 'back'; readonly index: number };

/** The queue index a swipe left goes to (next), or null when there is nowhere to go. */
export function nextSwipeIndex(length: number, index: number): number | null {
  if (length < 2 || index < 0) return null;
  return (index + 1) % length;
}

/**
 * The action for a right cover swipe. It matches the Previous button's restart threshold and first-track behavior.
 */
export function previousSwipeAction(positionSec: number, length: number, index: number, repeat: RepeatKind): PreviousSwipe | null {
  if (length < 1 || index < 0 || index >= length) return null;
  if (positionSec > 3 || !(index > 0 || repeat === 'all')) return { kind: 'restart' };
  return { kind: 'back', index: index > 0 ? index - 1 : length - 1 };
}
