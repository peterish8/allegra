/**
 * Share a LuvLyrics code as a picture (1.48.0). The card is drawn with Skia from `codeCard`'s plan into a PNG (a
 * lossless format: chat apps recompress JPEGs and blur thin bars), written to the cache, read back through the same
 * decoder the scanner uses, and only then handed to the system share sheet. A card that does not read back is never
 * sent. Nothing is uploaded.
 */
import { ImageFormat, matchFont, PaintStyle, Skia } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { encodeLuvCode, luvCodeLayout, type LuvCodePayload } from '@shared/luvCode';
import { captionFor, cardFileName, codeCardPlan } from './codeCard';
import { readCodeFromPhoto } from './scanImage';

export type ExportResult =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'draw' | 'unreadable' };

const same = (a: LuvCodePayload, b: LuvCodePayload | null): boolean =>
  b !== null && a.kind === b.kind && (a.kind === 'song' ? b.kind === 'song' && a.id === b.id : b.kind === 'playlist' && a.code === b.code);

/** Draws the card to a PNG file and returns where it is. `tint` is the card colour, `ink` the bars. */
export async function drawCodeCard(payload: LuvCodePayload, opts: { tint: string; ink: string; name: string }): Promise<string | null> {
  const levels = encodeLuvCode(payload);
  if (!levels) return null;
  const plan = codeCardPlan();
  const surface = Skia.Surface.Make(Math.round(plan.width), Math.round(plan.height));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  fill.setStyle(PaintStyle.Fill);

  fill.setColor(Skia.Color(opts.tint));
  canvas.drawRect(Skia.XYWHRect(0, 0, plan.width, plan.height), fill);

  const layout = luvCodeLayout(levels);
  fill.setColor(Skia.Color(opts.ink));
  canvas.save();
  canvas.translate(plan.dx, plan.dy);
  canvas.scale(plan.scale, plan.scale);
  canvas.drawCircle(layout.mark.cx, layout.mark.cy, layout.mark.r, fill);
  const heart = Skia.Path.MakeFromSVGString(layout.mark.heart);
  if (heart) {
    fill.setColor(Skia.Color(opts.tint));
    canvas.drawPath(heart, fill);
  }
  fill.setColor(Skia.Color(opts.ink));
  for (const bar of layout.bars) {
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(bar.x, bar.y, bar.width, bar.height), bar.width / 2, bar.width / 2), fill);
  }
  canvas.restore();

  try {
    const font = matchFont({ fontFamily: 'sans-serif', fontSize: plan.captionSize, fontWeight: 'bold' });
    const text = captionFor(opts.name);
    const width = font.measureText(text).width;
    canvas.drawText(text, plan.captionX - width / 2, plan.captionY, fill, font);
  } catch {
    // No font to draw the name with: the code alone is still a complete card.
  }

  surface.flush();
  const base64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100);
  if (!base64 || !FileSystem.cacheDirectory) return null;
  const uri = `${FileSystem.cacheDirectory}${cardFileName(payload.kind, opts.name)}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/** Draws, checks that it reads back, and opens the system share sheet with the picture. */
export async function shareCodeImage(payload: LuvCodePayload, opts: { tint: string; ink: string; name: string }): Promise<ExportResult> {
  if (!(await Sharing.isAvailableAsync().catch(() => false))) return { ok: false, reason: 'unavailable' };
  let uri: string | null = null;
  try {
    uri = await drawCodeCard(payload, opts);
  } catch {
    uri = null;
  }
  if (!uri) return { ok: false, reason: 'draw' };
  if (!same(payload, await readCodeFromPhoto(uri))) return { ok: false, reason: 'unreadable' };
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: `Share ${opts.name}` });
  } catch {
    // The listener closed the sheet, or no app took it: nothing is wrong with the picture.
  }
  return { ok: true, uri };
}

/** What to tell the listener when the picture could not be made. */
export const exportFailureText = (reason: 'unavailable' | 'draw' | 'unreadable'): string =>
  reason === 'unavailable' ? 'Sharing a picture is not available on this phone.' : 'The code picture could not be made. Share the link instead.';
