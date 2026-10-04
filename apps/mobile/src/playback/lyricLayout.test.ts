import { anchorFooter, anchorScrollY, LineBox, lineOffsets } from './lyricLayout';

/** A long song: one-row lines, wrapped lines (two and three rows), word-timed rows a little off the grid. */
const ROW = 34 + 2 * 16;
const songHeights = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => (i % 7 === 3 ? ROW + 34 : i % 11 === 5 ? ROW + 68 : ROW + (i % 3) * 0.67));

/** Lays the rows out top to bottom, as the block of lines would. */
const layout = (heights: readonly number[]): LineBox[] => {
  let y = 0;
  return heights.map(height => {
    const box = { y, height };
    y += height;
    return box;
  });
};

describe('lineOffsets', () => {
  it('places each line at its measured top below the spacer and header', () => {
    const heights = songHeights(5);
    const { offsets, heights: out } = lineOffsets(24 + 40, layout(heights), 5, ROW);
    expect(out).toEqual(heights);
    expect(offsets[0]).toBe(64);
    expect(offsets[4]).toBeCloseTo(64 + heights[0] + heights[1] + heights[2] + heights[3], 6);
  });

  it('puts a line not measured yet right after the one before it', () => {
    const boxes: (LineBox | undefined)[] = [{ y: 0, height: 100 }, undefined, { y: 300, height: 66 }];
    const { offsets, heights } = lineOffsets(10, boxes, 4, ROW);
    expect(offsets).toEqual([10, 110, 310, 376]);
    expect(heights).toEqual([100, ROW, 66, ROW]);
  });
});

describe('anchorScrollY', () => {
  const viewport = 420;
  const position = 0.35;

  it('keeps every sung line of a long, mixed song at the anchor', () => {
    const heights = songHeights(120);
    const top = 24;
    const { offsets, heights: hs } = lineOffsets(top, layout(heights), heights.length, ROW);
    const footer = anchorFooter(viewport, position, 50);
    const content = offsets[offsets.length - 1] + hs[hs.length - 1] + footer;
    const maxY = content - viewport;
    for (let i = 0; i < heights.length; i++) {
      const y = anchorScrollY(offsets[i], hs[i], viewport, position);
      // Past the first few lines (which sit higher until the page can scroll), the centre is on the anchor.
      if (y > 0) {
        expect(y).toBeLessThanOrEqual(maxY);
        expect(offsets[i] + hs[i] / 2 - y).toBeCloseTo(viewport * position, 6);
      }
    }
  });

  it('never scrolls above the top of the content', () => {
    expect(anchorScrollY(24, ROW, viewport, position)).toBe(0);
  });

  it('follows the same sung line when more scrollable content finishes laying out', () => {
    const offset = 760;
    const height = 100;
    const before = anchorScrollY(offset, height, viewport, position, 500);
    const after = anchorScrollY(offset, height, viewport, position, 1500);
    expect(before).toBe(80);
    expect(after).toBeGreaterThan(before);
    expect(offset + height / 2 - after).toBeCloseTo(viewport * position, 6);
  });

  it('keeps a seeked wrapped line at the focus point after the viewport resizes', () => {
    for (const height of [280, 420, 650]) {
      const offset = 760;
      const rowHeight = 134;
      const y = anchorScrollY(offset, rowHeight, height, position, 1600);
      expect(offset + rowHeight / 2 - y).toBeCloseTo(height * position, 6);
    }
  });

  it('stays put when new lyrics keep some rows the same: their last measured box still counts', () => {
    // Song A, then song B mounted in the same rows. Rows whose frame did not change report nothing, so their boxes
    // must be kept, not dropped back to the one-row estimate (that made the sung line sink as the song went on).
    const a = songHeights(40);
    const b = a.map((h, i) => (i % 4 === 0 ? ROW + 34 : h));
    const boxes: (LineBox | undefined)[] = layout(a);
    const next = layout(b);
    next.forEach((box, i) => {
      const old = boxes[i];
      if (!old || old.y !== box.y || old.height !== box.height) boxes[i] = box;
    });
    const kept = lineOffsets(24, boxes, b.length, ROW);
    const truth = lineOffsets(24, next, b.length, ROW);
    expect(kept).toEqual(truth);
    const last = b.length - 1;
    const y = anchorScrollY(kept.offsets[last], kept.heights[last], viewport, position);
    expect(truth.offsets[last] + truth.heights[last] / 2 - y).toBeCloseTo(viewport * position, 6);
  });
});

describe('anchorFooter', () => {
  it('leaves room below the last line for it to reach the anchor', () => {
    expect(anchorFooter(420, 0.35, 50)).toBe(273);
    expect(anchorFooter(0, 0.35, 320)).toBe(320);
    expect(anchorFooter(420, 0.35, 400)).toBe(400);
  });
});
