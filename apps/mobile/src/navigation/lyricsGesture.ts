/**
 * Swipe rules for fullscreen lyrics. Each is read on the UI thread from a pan's onEnd, so every
 * one is a worklet. A pan's onEnd fires once per gesture, which is what keeps one swipe from
 * both leaving the lyrics and closing the player: the player's own dismiss pan is off while the
 * lyrics are fullscreen and only a new touch can reach it.
 */

/** A swipe this far (points)… */
export const LYRICS_SWIPE_DISTANCE = 72;
/** …or a flick this fast (points per second). */
export const LYRICS_SWIPE_VELOCITY = 900;

/** Swipe up from the cover: open the fullscreen lyrics. */
export const shouldOpenLyricsFullscreen = (translationY: number, velocityY: number): boolean => {
  'worklet';
  return translationY < -LYRICS_SWIPE_DISTANCE || velocityY < -LYRICS_SWIPE_VELOCITY;
};

/** Swipe down in the footer of fullscreen lyrics: back to the cover. */
export const shouldExitLyricsFullscreen = (translationY: number, velocityY: number): boolean => {
  'worklet';
  return translationY > LYRICS_SWIPE_DISTANCE || velocityY > LYRICS_SWIPE_VELOCITY;
};

/** Whether a touch begins in the controls footer (the bottom `footerHeight` of the frame), never over the lyric list. */
export const startsInFooter = (y: number, frameHeight: number, footerHeight: number): boolean => {
  'worklet';
  return y >= frameHeight - footerHeight;
};
