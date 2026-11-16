import { shouldCloseSheet } from '../navigation/sheetClose';

export interface SheetExpansionDrag {
  progress: number;
  closeDrag: number;
}

export interface SheetKeyboardGeometry {
  /** Keyboard overlap relative to the current window (zero when Android already resized it). */
  keyboardOffset: number;
  /** Space from the safe top edge to the keyboard or window bottom. */
  availableHeight: number;
  /** The card's maximum height inside that space. */
  maxHeight: number;
  /** Distance between the compact and expanded detents. */
  expansionTravel: number;
}

/** Resolve both Android adjustResize and keyboard-overlay/pan layouts into one usable viewport. */
export function sheetKeyboardGeometry(
  windowHeight: number,
  fullWindowHeight: number,
  keyboardHeight: number,
  safeTop: number,
  maxHeightRatio: number,
): SheetKeyboardGeometry {
  'worklet';
  const resizeAmount = Math.max(0, fullWindowHeight - windowHeight);
  const keyboardOffset = Math.max(0, keyboardHeight - resizeAmount);
  const availableHeight = Math.max(0, windowHeight - keyboardOffset - safeTop);
  return {
    keyboardOffset,
    availableHeight,
    maxHeight: Math.min(fullWindowHeight * maxHeightRatio, availableHeight),
    expansionTravel: availableHeight * 0.38,
  };
}

/** A downward gesture can dismiss an expandable sheet only after it reaches the compact detent. */
export function shouldCloseExpandableSheet(progress: number, closeDrag: number, velocityY: number): boolean {
  'worklet';
  return progress <= 0 && shouldCloseSheet(closeDrag, velocityY);
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
