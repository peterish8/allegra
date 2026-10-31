/**
 * Sizes for the Now Playing room's blur (AppleBackdrop), worked out once per cover instead of blurring the full
 * screen on every redraw. Pure, so it is unit-testable.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of an image that `fit="cover"` shows in a box: centred and cropped to the box's shape. */
export const coverCrop = (imageW: number, imageH: number, boxW: number, boxH: number): Rect => {
  const box = boxW / boxH;
  if (imageW / imageH > box) {
    const width = imageH * box;
    return { x: (imageW - width) / 2, y: 0, width, height: imageH };
  }
  const height = imageW / box;
  return { x: 0, y: (imageH - height) / 2, width: imageW, height };
};

/**
 * The room drawn `widthPx` pixels wide, and the blur that, at that size, matches `sigma` at the full box size: a blur
 * this wide leaves nothing a small image cannot hold, so stretching it back up looks the same.
 */
export const roomSize = (boxW: number, boxH: number, sigma: number, widthPx: number): { width: number; height: number; sigma: number } => {
  const k = widthPx / boxW;
  return { width: widthPx, height: Math.max(1, Math.round(boxH * k)), sigma: sigma * k };
};
