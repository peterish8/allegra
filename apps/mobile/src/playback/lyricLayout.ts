/**
 * Where the lyric lines are, and where the list must scroll to keep the sung one at its anchor.
 *
 * Every line reports its own box (`onLayout`: y inside the block of lines, and height). React Native reports a
 * box when a row mounts and whenever its frame changes, and never otherwise, so a box stays true until the row
 * says it moved. That is why boxes are never thrown away when the lyrics change: a row whose frame did not change
 * says nothing, and a forgotten box would fall back to the one-row estimate. A wrapped line is two or three rows
 * tall, so every forgotten box pulled every later line up by a row in the arithmetic, and the sung line sank
 * further down the screen with every line that passed.
 */

export interface LineBox {
  /** Top of the line inside the block of lines, px. */
  y: number;
  height: number;
}

export interface LineOffsets {
  /** Top of each line in the list's content, px. */
  offsets: number[];
  heights: number[];
}

/**
 * Each line's top in the list's content and its height. `top` is where the block of lines starts in the content
 * (spacer and header above it). A line not measured yet sits right after the one before it, `estimate` tall.
 */
export function lineOffsets(
  top: number,
  boxes: readonly (LineBox | undefined)[],
  count: number,
  estimate: number,
): LineOffsets {
  const offsets: number[] = [];
  const heights: number[] = [];
  let next = top;
  for (let i = 0; i < count; i++) {
    const box = boxes[i];
    const offset = box ? top + box.y : next;
    const height = box ? box.height : estimate;
    offsets.push(offset);
    heights.push(height);
    next = offset + height;
  }
  return { offsets, heights };
}

/**
 * The scroll offset that puts a line's centre at `position` (0 top .. 1 bottom) of the viewport, so a wrapped
 * line is balanced around the same point as a short one. Never above the top of the content.
 */
export function anchorScrollY(offset: number, height: number, viewportHeight: number, position: number, contentHeight?: number): number {
  'worklet';
  const target = Math.max(0, offset + height / 2 - viewportHeight * position);
  return contentHeight === undefined ? target : Math.min(target, Math.max(0, contentHeight - viewportHeight));
}

/**
 * Space after the last line, so the last lines can still reach the anchor: the part of the viewport below it,
 * or `minimum` when that is more.
 */
export function anchorFooter(viewportHeight: number, position: number, minimum: number): number {
  return Math.max(minimum, Math.ceil(viewportHeight * (1 - position)));
}
