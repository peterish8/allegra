/**
 * LuvLyrics codes (1.44.0, owner): a row of 25 rounded bars beside the LuvLyrics mark, in the spirit of Spotify Codes.
 * Only the LuvLyrics app reads them, and they need no server: the bars carry the share itself.
 *
 *   bars 0, 12 and 24  reference bars: shortest, tallest, shortest. They tell a scanner how tall 0 and 7 are.
 *   the other 22 bars  8 heights each = 3 bits each = 66 bits:
 *                      kind (2) · body (48) · CRC-16/CCITT of kind+body (16), whitened by a fixed sequence so a
 *                      run of zeros never draws a flat row.
 *   a height           is Gray-coded, so a bar misread by one step costs one bit, and the decoder tries every
 *                      single-bar ±1 repair before giving up.
 *
 *   kind 0  a JioSaavn song: its 8-character id, 6 bits a character (A–Z a–z 0–9 - _)
 *   kind 1  a public playlist: the API's 8-character share code, as a base-31 number
 *
 * `luvCodeLayout` draws it in a 400 × 100 box; the website (SVG) and the phone (react-native-svg) both draw from it.
 * `decodeLuvCodeImage` reads one from greyscale pixels (a camera frame or a screenshot). No npm imports.
 */
import { SHARE_CODE_ALPHABET } from './shareLinks.ts';

export const BAR_COUNT = 25;
export const LEVELS = 8;
const REFERENCE: Readonly<Record<number, number>> = { 0: 0, 12: LEVELS - 1, 24: 0 };
const DATA_BARS = BAR_COUNT - Object.keys(REFERENCE).length; // 22
const DATA_BITS = DATA_BARS * 3; // 66
const BODY_BITS = 48;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export type LuvCodePayload =
  | { readonly kind: 'song'; readonly source: 'saavn'; readonly id: string }
  | { readonly kind: 'playlist'; readonly code: string };

// ── bits ─────────────────────────────────────────────────────────────────────

const pushBits = (out: number[], value: number, count: number): void => {
  for (let i = count - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** i) % 2);
};
const readBits = (bits: readonly number[], from: number, count: number): number => {
  let value = 0;
  for (let i = 0; i < count; i++) value = value * 2 + bits[from + i];
  return value;
};

/** CRC-16/CCITT-FALSE over a bit list. */
export const crc16 = (bits: readonly number[]): number => {
  let crc = 0xffff;
  for (const bit of bits) {
    const top = (crc >> 15) & 1;
    crc = (crc << 1) & 0xffff;
    if (top ^ bit) crc ^= 0x1021;
  }
  return crc;
};

/** The fixed whitening sequence (a 7-bit LFSR, x^7 + x^6 + 1). */
const WHITEN: readonly number[] = (() => {
  const out: number[] = [];
  let state = 0x5d;
  for (let i = 0; i < DATA_BITS; i++) {
    const bit = ((state >> 6) ^ (state >> 5)) & 1;
    out.push(state & 1);
    state = ((state << 1) | bit) & 0x7f;
  }
  return out;
})();

const toGray = (n: number): number => n ^ (n >> 1);
const fromGray = (g: number): number => { let n = g; for (let shift = g >> 1; shift; shift >>= 1) n ^= shift; return n; };

// ── payload ↔ body ───────────────────────────────────────────────────────────

const bodyOf = (payload: LuvCodePayload): { kind: number; body: number[] } | null => {
  const body: number[] = [];
  if (payload.kind === 'song') {
    if (payload.source !== 'saavn' || payload.id.length !== 8) return null;
    for (const ch of payload.id) {
      const at = ID_ALPHABET.indexOf(ch);
      if (at < 0) return null;
      pushBits(body, at, 6);
    }
    return { kind: 0, body };
  }
  const code = payload.code.toLowerCase();
  if (code.length !== 8) return null;
  let value = 0;
  for (const ch of code) {
    const at = SHARE_CODE_ALPHABET.indexOf(ch);
    if (at < 0) return null;
    value = value * SHARE_CODE_ALPHABET.length + at;
  }
  pushBits(body, value, BODY_BITS);
  return { kind: 1, body };
};

const payloadOf = (kind: number, body: readonly number[]): LuvCodePayload | null => {
  if (kind === 0) {
    let id = '';
    for (let i = 0; i < 8; i++) id += ID_ALPHABET[readBits(body, i * 6, 6)];
    return { kind: 'song', source: 'saavn', id };
  }
  if (kind === 1) {
    let value = readBits(body, 0, BODY_BITS);
    const base = SHARE_CODE_ALPHABET.length;
    if (value >= base ** 8) return null;
    let code = '';
    for (let i = 0; i < 8; i++) { code = SHARE_CODE_ALPHABET[value % base] + code; value = Math.floor(value / base); }
    return { kind: 'playlist', code };
  }
  return null;
};

/** Whether this payload can be drawn as a code (a JioSaavn song with an 8-character id, or an 8-character share). */
export const canEncode = (payload: LuvCodePayload): boolean => bodyOf(payload) !== null;

// ── levels ───────────────────────────────────────────────────────────────────

/** The 25 bar heights (0..7) for a payload, or null when it cannot be drawn. */
export function encodeLuvCode(payload: LuvCodePayload): number[] | null {
  const parts = bodyOf(payload);
  if (!parts) return null;
  const message: number[] = [];
  pushBits(message, parts.kind, 2);
  message.push(...parts.body);
  const bits = [...message];
  pushBits(bits, crc16(message), 16);
  const data = bits.map((bit, i) => bit ^ WHITEN[i]);
  const levels: number[] = [];
  let cursor = 0;
  for (let bar = 0; bar < BAR_COUNT; bar++) {
    if (bar in REFERENCE) { levels.push(REFERENCE[bar]); continue; }
    levels.push(fromGray(readBits(data, cursor, 3)));
    cursor += 3;
  }
  return levels;
}

const tryLevels = (levels: readonly number[]): LuvCodePayload | null => {
  const bits: number[] = [];
  for (let bar = 0; bar < BAR_COUNT; bar++) if (!(bar in REFERENCE)) pushBits(bits, toGray(levels[bar]), 3);
  const plain = bits.map((bit, i) => bit ^ WHITEN[i]);
  const message = plain.slice(0, 2 + BODY_BITS);
  if (crc16(message) !== readBits(plain, 2 + BODY_BITS, 16)) return null;
  return payloadOf(readBits(message, 0, 2), message.slice(2));
};

/** 25 levels -> the payload, repairing one bar read a step too high or low. Null when nothing checks out. */
export function decodeLuvLevels(levels: readonly number[]): LuvCodePayload | null {
  if (levels.length !== BAR_COUNT) return null;
  const exact = tryLevels(levels);
  if (exact) return exact;
  const work = [...levels];
  for (let bar = 0; bar < BAR_COUNT; bar++) {
    if (bar in REFERENCE) continue;
    for (const step of [-1, 1]) {
      const original = work[bar];
      const next = original + step;
      if (next < 0 || next >= LEVELS) continue;
      work[bar] = next;
      const repaired = tryLevels(work);
      work[bar] = original;
      if (repaired) return repaired;
    }
  }
  return null;
}

/** Measured bar heights (any unit) -> levels, calibrated by the three reference bars. Null when they make no sense. */
export function levelsFromHeights(heights: readonly number[]): number[] | null {
  if (heights.length !== BAR_COUNT) return null;
  const low = (heights[0] + heights[24]) / 2;
  const high = heights[12];
  if (!(high > low * 1.8)) return null;
  return heights.map(h => Math.min(LEVELS - 1, Math.max(0, Math.round(((h - low) / (high - low)) * (LEVELS - 1)))));
}

// ── drawing ──────────────────────────────────────────────────────────────────

export const CODE_WIDTH = 400;
export const CODE_HEIGHT = 100;
const BARS_FROM = 104;
const BARS_TO = 380;
export const BAR_PITCH = (BARS_TO - BARS_FROM) / BAR_COUNT;
export const BAR_WIDTH = BAR_PITCH * 0.52;
const BAR_MAX = 64;

export interface LuvCodeLayout {
  /** The LuvLyrics mark: a disc with a heart cut out of it. */
  readonly mark: { readonly cx: number; readonly cy: number; readonly r: number; readonly heart: string };
  /** Each bar as a rounded rectangle (radius = width / 2). */
  readonly bars: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
}

/** A heart centred on (cx, cy), about `size` wide, as an SVG path. */
const heartPath = (cx: number, cy: number, size: number): string => {
  const s = size / 2;
  const top = cy - s * 0.55;
  return [
    `M ${cx} ${cy + s * 0.85}`,
    `C ${cx - s * 0.3} ${cy + s * 0.55} ${cx - s} ${cy + s * 0.1} ${cx - s} ${top + s * 0.35}`,
    `C ${cx - s} ${top - s * 0.15} ${cx - s * 0.45} ${top - s * 0.35} ${cx} ${top + s * 0.1}`,
    `C ${cx + s * 0.45} ${top - s * 0.35} ${cx + s} ${top - s * 0.15} ${cx + s} ${top + s * 0.35}`,
    `C ${cx + s} ${cy + s * 0.1} ${cx + s * 0.3} ${cy + s * 0.55} ${cx} ${cy + s * 0.85}`,
    'Z',
  ].join(' ');
};

export function luvCodeLayout(levels: readonly number[]): LuvCodeLayout {
  const cy = CODE_HEIGHT / 2;
  return {
    mark: { cx: 52, cy, r: 30, heart: heartPath(52, cy + 1, 30) },
    bars: levels.map((level, i) => {
      const height = BAR_WIDTH + ((BAR_MAX - BAR_WIDTH) * level) / (LEVELS - 1);
      return { x: BARS_FROM + i * BAR_PITCH + (BAR_PITCH - BAR_WIDTH) / 2, y: cy - height / 2, width: BAR_WIDTH, height };
    }),
  };
}

// ── reading pixels ───────────────────────────────────────────────────────────

export interface GreyImage {
  /** One byte per pixel, row by row (0 black .. 255 white). */
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

/** Otsu's threshold for a greyscale image. */
export const otsu = (data: ArrayLike<number>): number => {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i++) hist[data[i] | 0]++;
  const total = data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
};

const transpose = (img: GreyImage): GreyImage => {
  const out = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) out[x * img.height + y] = img.data[y * img.width + x];
  return { data: out, width: img.height, height: img.width };
};

/** The row of a line through (mid, y0) with this slope, at column x. */
const lineY = (y0: number, slope: number, mid: number, x: number): number => Math.round(y0 + slope * (x - mid));

/** Runs of "on" pixels along a (slightly sloped) line: [start, end) pairs of columns. */
const runsOnLine = (on: (x: number, y: number) => boolean, img: GreyImage, y0: number, slope: number): [number, number][] => {
  const runs: [number, number][] = [];
  const mid = img.width / 2;
  let start = -1;
  for (let x = 0; x <= img.width; x++) {
    const y = lineY(y0, slope, mid, x);
    const lit = x < img.width && y >= 0 && y < img.height && on(x, y);
    if (lit && start < 0) start = x;
    else if (!lit && start >= 0) { runs.push([start, x]); start = -1; }
  }
  return runs;
};

/** A held phone is rarely level: lines up to about ±4° are tried, level first. */
const SLOPES = [0, 0.018, -0.018, 0.036, -0.036, 0.054, -0.054, 0.072, -0.072];

/** The bar's height through (x, y): walk up and down while it stays lit, following a slight tilt. */
const barExtent = (on: (x: number, y: number) => boolean, width: number, height: number, x0: number, y0: number, reach: number): number => {
  const walk = (dir: number): number => {
    let x = x0, y = y0, steps = 0, misses = 0;
    while (steps < reach) {
      const ny = y + dir;
      if (ny < 0 || ny >= height) break;
      const options = [x, x - 1, x + 1].filter(c => c >= 0 && c < width);
      const hit = options.find(c => on(c, ny));
      if (hit === undefined) { if (++misses > 1) break; y = ny; steps++; continue; }
      misses = 0; x = hit; y = ny; steps++;
    }
    return steps - misses;
  };
  return walk(-1) + walk(1) + 1;
};


/** Try every window of 25 evenly spaced runs on this line. */
const readLine = (on: (x: number, y: number) => boolean, img: GreyImage, y0: number, slope: number): LuvCodePayload | null => {
  const runs = runsOnLine(on, img, y0, slope);
  if (runs.length < BAR_COUNT) return null;
  const allCentres = runs.map(([a, b]) => (a + b) / 2);
  for (let start = 0; start + BAR_COUNT <= runs.length; start++) {
    // Cheap test first, with no allocation: 25 runs evenly spaced and each narrower than its spacing.
    const pitch = (allCentres[start + BAR_COUNT - 1] - allCentres[start]) / (BAR_COUNT - 1);
    if (pitch < 3) continue;
    let even = true;
    for (let i = start; i < start + BAR_COUNT && even; i++) {
      if (runs[i][1] - runs[i][0] > pitch * 0.9) even = false;
      else if (i > start && Math.abs(allCentres[i] - allCentres[i - 1] - pitch) > pitch * 0.35) even = false;
    }
    if (!even) continue;
    const centres = allCentres.slice(start, start + BAR_COUNT);
    const reach = Math.round(pitch * 12);
    const extent = (c: number): number => barExtent(on, img.width, img.height, Math.round(c), lineY(y0, slope, img.width / 2, Math.round(c)), reach);
    // The middle reference bar must stand well above both ends before the rest are measured (or either way round).
    const [first, middle, last] = [extent(centres[0]), extent(centres[12]), extent(centres[24])];
    if (!(middle > first * 1.8 && middle > last * 1.8)) continue;
    const heights = centres.map((c, i) => (i === 0 ? first : i === 12 ? middle : i === 24 ? last : extent(c)));
    for (const order of [heights, [...heights].reverse()]) {
      const levels = levelsFromHeights(order);
      const found = levels ? decodeLuvLevels(levels) : null;
      if (found) return found;
    }
  }
  return null;
};

type Lit = (x: number, y: number) => boolean;

/**
 * "On" against the light right around each pixel instead of against the whole frame. A code on another phone's screen
 * is a lit card in a dark room: one threshold for the frame lands between room and card, so every bar and every gap
 * of the card falls on the same side of it. Against its own neighbourhood a bar is brighter (or darker) than the gaps
 * beside it however bright the card is, and a shadow or glare across the frame no longer matters.
 */
const localMask = (img: GreyImage, window: number, bright: boolean): Uint8Array => {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  const sums = new Float64Array(width + 1);
  const half = Math.max(2, window >> 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) sums[x + 1] = sums[x] + data[row + x];
    for (let x = 0; x < width; x++) {
      const from = x - half < 0 ? 0 : x - half;
      const to = x + half + 1 > width ? width : x + half + 1;
      const mean = (sums[to] - sums[from]) / (to - from);
      const grey = data[row + x];
      mask[row + x] = (bright ? grey > mean + LOCAL_MARGIN : grey < mean - LOCAL_MARGIN) ? 1 : 0;
    }
  }
  return mask;
};

/** Pixels above (or at most) a single threshold for the whole frame. */
const globalMask = (img: GreyImage, threshold: number, bright: boolean): Uint8Array => {
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) mask[i] = (img.data[i] > threshold) === bright ? 1 : 0;
  return mask;
};

/** How far past its neighbourhood's average a pixel must be to count, so sensor noise on flat ground does not. */
const LOCAL_MARGIN = 6;

/**
 * Find and read a LuvLyrics code in a greyscale image: light bars on a darker card or dark bars on a light one, level
 * or upside down, across or along the frame, in a dark room or under uneven light. Null when no code reads.
 */
export function decodeLuvCodeImage(img: GreyImage, budgetMs?: number): LuvCodePayload | null {
  if (img.width < BAR_COUNT * 3 || img.height < 8) return null;
  // A live scanner reads frame after frame on the JavaScript thread: a frame with no code in it must not hold it long.
  const until = budgetMs === undefined ? Infinity : Date.now() + budgetMs;
  for (const view of [img, transpose(img)]) {
    const threshold = otsu(view.data);
    const windows = [Math.max(15, Math.round(view.width / 20)), Math.max(31, Math.round(view.width / 9))];
    // The whole-frame threshold is right for a card filling the frame; the local ones are for the rest. Each mask is
    // built only when the ones before it found nothing.
    const sources: (() => Uint8Array)[] = [
      () => globalMask(view, threshold, true),
      () => globalMask(view, threshold, false),
      ...windows.flatMap(w => [() => localMask(view, w, true), () => localMask(view, w, false)]),
    ];
    const step = Math.max(1, Math.round(view.height / 120));
    // Scan from the middle outwards: a framed code usually sits near the centre.
    const mid = Math.floor(view.height / 2);
    for (const build of sources) {
      const mask = build();
      const on: Lit = (x, y) => mask[y * view.width + x] === 1;
      for (const slope of SLOPES) {
        if (Date.now() > until) return null;
        for (let k = 0; k <= view.height; k += step) {
          for (const y of k === 0 ? [mid] : [mid - k, mid + k]) {
            if (y < 0 || y >= view.height) continue;
            const found = readLine(on, view, y, slope);
            if (found) return found;
          }
        }
      }
    }
  }
  return null;
}
