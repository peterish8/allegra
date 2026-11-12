/**
 * The picture a LuvLyrics code is shared as. One plan, drawn by two painters: `exportCode` (Skia, to a PNG) and the
 * test, which draws the same shapes into plain pixels and reads them back with the real decoder. So the shared image
 * is proven readable without a phone, even after it is shrunk the way a chat app or a screenshot shrinks it.
 *
 * Big on purpose (1600 px wide): chat apps scale pictures down, and a code that is 25 bars across needs the room.
 * A clear margin (the quiet zone) surrounds the code, and the colours keep a strong contrast.
 */
import { CODE_HEIGHT, CODE_WIDTH } from '@shared/luvCode';

/** Pixels per code unit: the 400 x 100 code is drawn 3.2 times as large. */
export const CARD_SCALE = 3.2;
/** Quiet zone around the code, in pixels. */
export const CARD_MARGIN = 160;
/** Room under the code for the name. */
export const CARD_CAPTION = 200;

export interface CodeCardPlan {
  readonly width: number;
  readonly height: number;
  /** Code units to pixels, and where the code's top-left corner sits. */
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
  /** Where the name's baseline and centre go. */
  readonly captionX: number;
  readonly captionY: number;
  readonly captionSize: number;
}

export function codeCardPlan(): CodeCardPlan {
  const width = CODE_WIDTH * CARD_SCALE + CARD_MARGIN * 2;
  const height = CARD_MARGIN + CODE_HEIGHT * CARD_SCALE + CARD_CAPTION;
  return {
    width,
    height,
    scale: CARD_SCALE,
    dx: CARD_MARGIN,
    dy: CARD_MARGIN,
    captionX: width / 2,
    captionY: CARD_MARGIN + CODE_HEIGHT * CARD_SCALE + CARD_CAPTION * 0.55,
    captionSize: 64,
  };
}

/** A name that fits one line of the card: long ones are cut with an ellipsis. */
export function captionFor(name: string, max = 34): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** A file name safe on every phone: the name's letters and digits, and the code kind. */
export function cardFileName(kind: 'song' | 'playlist', name: string): string {
  const slug = name.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'code';
  return `luvlyrics-${kind}-${slug}.png`;
}
