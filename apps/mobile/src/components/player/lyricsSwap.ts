/**
 * What the classic mini player's lyrics do when the playing song changes (`MiniPlayer`, `displayedSong`).
 *
 * - `fade`: another song while the bar is open: fade the lines out, swap to the song playing *by then*, fade in.
 * - `cut`: another song while the bar is closed: nothing to see, swap at once.
 * - `refresh`: the song shown is the one playing, but its object changed — details arrived (lyrics landed) or a skip
 *   away and back landed on a new object. Call off any fade still running, bring the lines back, and show the new
 *   object.
 * - `none`: nothing changed.
 *
 * A quick next then previous (A → B → A) never reaches this as a song change when the queue hands back the same
 * object; the running fade's completion swaps to the song playing *when it ends* (latest ref), which is A again.
 *
 * Pure, so the rule can be tested without React Native.
 */
export type LyricsSwap = 'fade' | 'cut' | 'refresh' | 'none';

export function planLyricsSwap(input: {
  readonly shownId: string | null | undefined;
  readonly currentId: string | null | undefined;
  /** The shown song is the very same object as the playing one (nothing about it changed). */
  readonly sameObject: boolean;
  /** The classic bar is open to its lyric stage. */
  readonly expanded: boolean;
}): LyricsSwap {
  const { shownId, currentId, sameObject, expanded } = input;
  if ((shownId ?? null) !== (currentId ?? null)) return expanded ? 'fade' : 'cut';
  return sameObject ? 'none' : 'refresh';
}
