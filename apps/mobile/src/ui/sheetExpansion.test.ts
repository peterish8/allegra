import { sheetExpansionCancelTarget, sheetExpansionDrag, sheetExpansionTarget } from './sheetExpansion';

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
});
