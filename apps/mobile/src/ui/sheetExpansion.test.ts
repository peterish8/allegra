import { sheetExpansionCancelTarget, sheetExpansionDrag, sheetExpansionTarget, sheetKeyboardGeometry, shouldCloseExpandableSheet } from './sheetExpansion';

describe('expandable sheet gesture decisions', () => {
  it('tracks upward movement continuously while keeping the sheet bottom anchored', () => {
    expect(sheetExpansionDrag(0, -40, 200)).toEqual({ progress: 0.2, closeDrag: 0 });
    expect(sheetExpansionDrag(0.2, -60, 200)).toEqual({ progress: 0.5, closeDrag: 0 });
  });

  it('reverses from a partial expansion and clamps at the half-height stop', () => {
    const reversed = sheetExpansionDrag(0.6, 40, 200);
    expect(reversed.progress).toBeCloseTo(0.4);
    expect(reversed.closeDrag).toBe(0);
    expect(sheetExpansionDrag(0.2, 80, 200)).toEqual({ progress: 0, closeDrag: 40 });
  });

  it('settles by drag intent, velocity, or the nearest resting point', () => {
    expect(sheetExpansionTarget(0.2, -60, 0)).toBe(1);
    expect(sheetExpansionTarget(0.2, 0, -501)).toBe(1);
    expect(sheetExpansionTarget(0.8, 60, 0)).toBe(0);
    expect(sheetExpansionTarget(0.49, 0, 0)).toBe(0);
    expect(sheetExpansionTarget(0.51, 0, 0)).toBe(1);
  });

  it('returns to the starting stop when a competing scroll cancels the pan', () => {
    expect(sheetExpansionCancelTarget(0)).toBe(0);
    expect(sheetExpansionCancelTarget(1)).toBe(1);
    expect(sheetExpansionCancelTarget(1.4)).toBe(1);
  });

  it('keeps the header and actions inside the viewport with a tall keyboard at several screen sizes', () => {
    for (const [height, keyboard, safeTop] of [[800, 320, 24], [720, 280, 30], [600, 300, 24]]) {
      const frame = sheetKeyboardGeometry(height, height, keyboard, safeTop, 0.88);
      expect(frame.keyboardOffset).toBe(keyboard);
      expect(frame.availableHeight).toBe(height - keyboard - safeTop);
      expect(frame.maxHeight).toBe(frame.availableHeight);
      expect(height - frame.keyboardOffset - frame.maxHeight).toBe(safeTop);
      expect(frame.expansionTravel).toBeCloseTo(frame.availableHeight * 0.38);
    }
  });

  it('uses the same usable viewport when Android resizes the root or the keyboard overlays it', () => {
    const resized = sheetKeyboardGeometry(480, 800, 0, 24, 0.88);
    const overlaid = sheetKeyboardGeometry(800, 800, 320, 24, 0.88);
    expect(resized.keyboardOffset).toBe(0);
    expect(resized.availableHeight).toBe(overlaid.availableHeight);
    expect(resized.maxHeight).toBe(overlaid.maxHeight);
    expect(resized.expansionTravel).toBeCloseTo(overlaid.expansionTravel);
  });

  it('settles an expanded-to-compact drag before allowing a later compact-to-dismiss drag', () => {
    const distance = 300;
    const beforeCompact = sheetExpansionDrag(1, distance - 30, distance);
    expect(beforeCompact.progress).toBeGreaterThan(0);
    expect(shouldCloseExpandableSheet(beforeCompact.progress, beforeCompact.closeDrag, 1200)).toBe(false);

    const atCompact = sheetExpansionDrag(1, distance, distance);
    expect(atCompact.progress).toBe(0);
    expect(shouldCloseExpandableSheet(atCompact.progress, atCompact.closeDrag, 0)).toBe(false);

    const compactDismiss = sheetExpansionDrag(0, 97, distance);
    expect(shouldCloseExpandableSheet(compactDismiss.progress, compactDismiss.closeDrag, 0)).toBe(true);
  });

  it('respects reversal and downward velocity only at the compact detent', () => {
    const reversed = sheetExpansionDrag(1, 220, 300);
    expect(shouldCloseExpandableSheet(reversed.progress, reversed.closeDrag, 1400)).toBe(false);

    const compactFlick = sheetExpansionDrag(0, 20, 300);
    expect(shouldCloseExpandableSheet(compactFlick.progress, compactFlick.closeDrag, 901)).toBe(true);
    const upwardFlick = sheetExpansionDrag(0, -20, 300);
    expect(shouldCloseExpandableSheet(upwardFlick.progress, upwardFlick.closeDrag, -1400)).toBe(false);
  });
});
