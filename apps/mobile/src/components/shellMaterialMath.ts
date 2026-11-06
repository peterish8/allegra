/**
 * The shell's material in plain TypeScript (Round 7 item 8). The mini player and the navigation bar each draw the
 * material in their own frame; both stretch the cover across the whole shell so the two halves meet without a seam.
 */
export interface ShellConditions { lowEnd: boolean; reduceTransparency: boolean; batterySaver: boolean; uri?: string }

/** The opaque fallback: Reduce Transparency, Battery Saver, low-end devices and no cover. */
export const shellIsSolid = ({ lowEnd, reduceTransparency, batterySaver, uri }: ShellConditions): boolean =>
  lowEnd || reduceTransparency || batterySaver || !uri;

/**
 * Where the shared cover layer sits inside one part's frame: `above` is how much of the shell lies above this part,
 * `below` how much lies under it. Both parts then draw the same cover over the same span.
 */
export const shellCoverFrame = (above: number, below: number): { top: number; bottom: number } =>
  ({ top: -Math.max(0, above), bottom: -Math.max(0, below) });
