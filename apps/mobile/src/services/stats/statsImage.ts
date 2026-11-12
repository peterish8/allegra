/**
 * Share a stats card as a picture (1.48.0). Drawn with Skia from a `ShareCardModel` into a 1080 x 1350 PNG (lossless,
 * so chat apps do not blur the figures), written to the cache and handed to the system share sheet. Artwork that
 * cannot be loaded is simply left out. Nothing is uploaded.
 */
import { ImageFormat, matchFont, PaintStyle, Skia, type SkFont } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Signal } from '../../constants/allegraTheme';
import { SHARE_TONES, wrapLines, type ShareCardModel } from './statsShare';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const MARGIN = 84;

export type StatsImageResult = { readonly ok: true; readonly uri: string } | { readonly ok: false; readonly reason: 'unavailable' | 'draw' };

const fontOf = (size: number, bold: boolean): SkFont | null => {
  try {
    return matchFont({ fontFamily: 'sans-serif', fontSize: size, fontWeight: bold ? 'bold' : 'normal' });
  } catch {
    return null;
  }
};

async function artworkImage(uri: string | null) {
  if (!uri) return null;
  try {
    const data = await Skia.Data.fromURI(uri);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
}

/** Draws the card to a PNG in the cache and returns its path. */
export async function drawStatsCard(model: ShareCardModel): Promise<string | null> {
  const tone = SHARE_TONES[model.tone];
  const surface = Skia.Surface.Make(CARD_WIDTH, CARD_HEIGHT);
  if (!surface || !FileSystem.cacheDirectory) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(Skia.Color(tone.bg));
  canvas.drawRect(Skia.XYWHRect(0, 0, CARD_WIDTH, CARD_HEIGHT), paint);

  const heading = fontOf(76, true);
  const figure = fontOf(190, true);
  const body = fontOf(46, true);
  const meta = fontOf(36, false);
  const small = fontOf(40, true);
  if (!heading || !figure || !body || !meta || !small) return null;

  let y = 150;
  paint.setColor(Skia.Color(tone.accent));
  for (const line of wrapLines(model.heading, CARD_WIDTH - MARGIN * 2, text => heading.measureText(text).width, 4)) {
    canvas.drawText(line, MARGIN, y, paint, heading);
    y += 92;
  }
  if (model.figure) {
    y += 90;
    paint.setColor(Skia.Color(Signal.ink));
    canvas.drawText(model.figure, MARGIN, y, paint, figure);
    y += 40;
  }
  y += 30;
  paint.setColor(Skia.Color('#C9CCD2'));
  for (const line of wrapLines(model.caption, CARD_WIDTH - MARGIN * 2, text => meta.measureText(text).width, 3)) {
    canvas.drawText(line, MARGIN, y, paint, meta);
    y += 52;
  }

  y += 40;
  const art = 120;
  for (const row of model.rows) {
    const image = await artworkImage(row.artwork);
    let x = MARGIN;
    if (row.rank !== null) {
      paint.setColor(Skia.Color('#9AA0A8'));
      canvas.drawText(String(row.rank), x, y + art / 2 + 14, paint, body);
      x += 64;
    }
    if (image) {
      canvas.save();
      canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x, y, art, art), 14, 14), 1, true);
      canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(x, y, art, art), paint);
      canvas.restore();
    } else {
      paint.setColor(Skia.Color('#22262C'));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, art, art), 14, 14), paint);
    }
    const textX = x + art + 32;
    const room = CARD_WIDTH - MARGIN - textX;
    paint.setColor(Skia.Color(Signal.ink));
    const [title] = wrapLines(row.title, room, text => body.measureText(text).width, 1);
    canvas.drawText(title ?? '', textX, y + 52, paint, body);
    paint.setColor(Skia.Color('#C9CCD2'));
    const [sub] = wrapLines(row.meta, room, text => meta.measureText(text).width, 1);
    canvas.drawText(sub ?? '', textX, y + 100, paint, meta);
    y += art + 36;
    if (y > CARD_HEIGHT - 190) break;
  }

  paint.setColor(Skia.Color(tone.accent));
  canvas.drawText('LuvLyrics', MARGIN, CARD_HEIGHT - 84, paint, small);

  surface.flush();
  const base64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100);
  if (!base64) return null;
  const uri = `${FileSystem.cacheDirectory}${model.fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/** Draws the card and opens the system share sheet with it. */
export async function shareStatsCard(model: ShareCardModel): Promise<StatsImageResult> {
  if (!(await Sharing.isAvailableAsync().catch(() => false))) return { ok: false, reason: 'unavailable' };
  let uri: string | null = null;
  try {
    uri = await drawStatsCard(model);
  } catch {
    uri = null;
  }
  if (!uri) return { ok: false, reason: 'draw' };
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your stats' });
  } catch {
    // The listener closed the sheet: nothing is wrong with the picture.
  }
  return { ok: true, uri };
}

export const statsImageFailureText = (reason: 'unavailable' | 'draw'): string =>
  reason === 'unavailable' ? 'Sharing a picture is not available on this phone.' : 'The picture could not be made. Try again.';
