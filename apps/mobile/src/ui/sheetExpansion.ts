export interface SheetExpansionDrag {
  progress: number;
  closeDrag: number;
}

/** Map a vertical drag to sheet height, keeping the bottom edge anchored. */
export function sheetExpansionDrag(start: number, translationY: number, travel: number): SheetExpansionDrag {
  'worklet';
  const distance = Math.max(1, travel);
  return {
    progress: Math.max(0, Math.min(1, start - translationY / distance)),
    closeDrag: Math.max(0, translationY - start * distance),
  };
}

/** Choose a half/full resting point from the drag direction, progress, or a quick flick. */
export function sheetExpansionTarget(progress: number, translationY: number, velocityY: number): 0 | 1 {
  'worklet';
  if (translationY < -56 || velocityY < -500) return 1;
  if (translationY > 56 || velocityY > 500) return 0;
  return progress >= 0.5 ? 1 : 0;
}

/** Restore the stop at which a cancelled gesture began. */
export function sheetExpansionCancelTarget(start: number): number {
  'worklet';
  return Math.max(0, Math.min(1, start));
}
