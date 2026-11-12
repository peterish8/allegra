/**
 * Reading a LuvLyrics code from a photo (a camera frame or a screenshot): Skia decodes the file and scales it down to
 * at most SCAN_MAX pixels a side, its pixels become greyscale, and packages/shared/luvCode finds and reads the bars.
 * Small on purpose: the decoder runs on the JavaScript thread between frames.
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { decodeLuvCodeImage, type GreyImage, type LuvCodePayload } from '@shared/luvCode';

/** The longest side a frame is read at: enough for a code across half the frame, quick to scan. */
export const SCAN_MAX = 640;

/** The longest one frame may hold the JavaScript thread; the next frame is read a moment later. */
export const SCAN_BUDGET_MS = 450;

/** RGBA bytes -> one luma byte a pixel (Rec. 601 weights). */
export function toGrey(rgba: ArrayLike<number>, width: number, height: number): GreyImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return { data, width, height };
}

/** The size a frame is scaled to, keeping its shape. */
export function scanSize(width: number, height: number, max = SCAN_MAX): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A photo on the phone -> the code in it, or null (no code, or the file could not be read). */
export async function readCodeFromPhoto(uri: string, budgetMs?: number, sides: readonly number[] = [SCAN_MAX]): Promise<LuvCodePayload | null> {
  for (const side of sides) {
    const found = await readAtSize(uri, budgetMs, side);
    if (found) return found;
  }
  return null;
}

/** The sizes a picked photo is tried at: the quick one first, then larger, for a code that is small in the picture. */
export const PHOTO_SIDES: readonly number[] = [SCAN_MAX, 1280, 1920];

async function readAtSize(uri: string, budgetMs: number | undefined, side: number): Promise<LuvCodePayload | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return null;
    const size = scanSize(image.width(), image.height(), side);
    const surface = Skia.Surface.Make(size.width, size.height);
    if (!surface) return null;
    surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, size.width, size.height), Skia.Paint());
    surface.flush();
    const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: size.width, height: size.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!pixels) return null;
    return decodeLuvCodeImage(toGrey(pixels, size.width, size.height), budgetMs);
  } catch {
    return null;
  }
}
