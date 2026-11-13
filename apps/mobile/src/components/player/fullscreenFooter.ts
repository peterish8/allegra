/**
 * The footer of fullscreen lyrics: just the cover, the song's name, the way back and the like, with the scrubber under
 * them. About a tenth of the screen, so the lyrics own the rest. Kept apart from the components so the sizes are
 * tested and the lyrics list, the footer and the swipe-down zone all read the same numbers.
 */

/** Space above the title row (the footer's shade starts here). */
export const FULLSCREEN_FOOTER_TOP = 12;

/** From the top of the footer to the bottom of the scrubber's time labels: thumbnail row, gap, bar, times. */
export const FULLSCREEN_FOOTER_BODY = 46 + 10 + 10 + 28;

/** The footer's padding under the scrubber: clear of the system bar, never less than a small margin. */
export const fullscreenFooterPad = (insetBottom: number): number => Math.max(insetBottom, 8) + 8;

/** The footer's whole height: the lyric list ends here, and a swipe down starting inside it leaves fullscreen. */
export const fullscreenClearance = (insetBottom: number): number =>
  FULLSCREEN_FOOTER_TOP + FULLSCREEN_FOOTER_BODY + fullscreenFooterPad(insetBottom);
