import { shortcutCellWidth, shortcutColumns } from './shortcutGrid';

const INSET = 12; // Control.gutter (16) less each tile's 4dp padding, as StreamHome passes it

describe('Jump back in grid', () => {
  it('fits two tiles inside the gutter at 360, 393 and 430dp', () => {
    for (const w of [360, 393, 430]) {
      const cell = shortcutCellWidth(w, 2, INSET);
      expect(cell * 2 + INSET * 2).toBeLessThanOrEqual(w);
      expect(cell * 2 + INSET * 2).toBeGreaterThan(w - 2);
    }
  });

  it('goes to one full-width column for large text', () => {
    expect(shortcutColumns(1)).toBe(2);
    expect(shortcutColumns(1.3)).toBe(1);
    expect(shortcutColumns(2)).toBe(1);
    expect(shortcutCellWidth(360, 1, INSET)).toBe(360 - INSET * 2);
  });

  it('never returns a negative or fractional width', () => {
    expect(shortcutCellWidth(0, 2, INSET)).toBe(0);
    expect(Number.isInteger(shortcutCellWidth(393, 2, INSET))).toBe(true);
  });
});
