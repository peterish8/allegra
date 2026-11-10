import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAR_COUNT, CODE_HEIGHT, CODE_WIDTH, canEncode, crc16, decodeLuvCodeImage, decodeLuvLevels, encodeLuvCode, levelsFromHeights,
  luvCodeLayout, type GreyImage, type LuvCodePayload,
} from './luvCode.ts';

const SONG: LuvCodePayload = { kind: 'song', source: 'saavn', id: 'B4-hLCKJ' };
const PLAYLIST: LuvCodePayload = { kind: 'playlist', code: 'abcd2345' };

/** A small seeded random so every run draws the same noise. */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

interface Scene {
  scale: number; // pixels per code unit
  tilt?: number; // radians
  noise?: number; // ± grey levels
  blur?: boolean;
  bar?: number; card?: number; page?: number; // greys
  margin?: number; // pixels of page around the card
  clutter?: boolean;
  upsideDown?: boolean;
  portrait?: boolean;
  /** Light falling off across the frame: 0.5 makes one side half as bright as the other. */
  shade?: number;
}

/** Draws the code like a phone camera sees it: a card on a page, optionally tilted, blurred and noisy. */
function photograph(levels: number[], scene: Scene): GreyImage {
  const { scale, tilt = 0, noise = 0, blur = false, bar = 245, card = 70, page = 150, margin = 60, clutter = false } = scene;
  const layout = luvCodeLayout(levels);
  const cw = CODE_WIDTH * scale, ch = CODE_HEIGHT * scale;
  const width = Math.round(cw + margin * 2), height = Math.round(ch + margin * 2);
  const data = new Uint8Array(width * height);
  const cx = width / 2, cy = height / 2;
  const cos = Math.cos(-tilt), sin = Math.sin(-tilt);
  const random = rng(7);
  const inBar = (u: number, v: number): boolean => layout.bars.some(b => {
    if (u < b.x || u > b.x + b.width) return false;
    const r = b.width / 2;
    const top = b.y + r, bottom = b.y + b.height - r;
    const cu = b.x + r;
    if (v >= top && v <= bottom) return true;
    const end = v < top ? top : bottom;
    return (u - cu) ** 2 + (v - end) ** 2 <= r * r;
  });
  const inMark = (u: number, v: number): boolean => (u - layout.mark.cx) ** 2 + (v - layout.mark.cy) ** 2 <= layout.mark.r ** 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Undo the tilt about the centre, then into code units.
    const dx = x - cx, dy = y - cy;
    let u = (dx * cos - dy * sin + cw / 2) / scale;
    let v = (dx * sin + dy * cos + ch / 2) / scale;
    if (scene.upsideDown) { u = CODE_WIDTH - u; v = CODE_HEIGHT - v; }
    let grey = page;
    if (clutter && (Math.floor(x / 9) + Math.floor(y / 13)) % 5 === 0) grey = 200;
    if (u >= 0 && u <= CODE_WIDTH && v >= 0 && v <= CODE_HEIGHT) grey = inBar(u, v) || inMark(u, v) ? bar : card;
    if (scene.shade) grey = Math.round(grey * (1 - scene.shade * (x / width)));
    data[y * width + x] = grey;
  }
  let out: Uint8Array = data;
  if (blur) {
    out = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) { sum += data[yy * width + xx]; n++; }
      }
      out[y * width + x] = Math.round(sum / n);
    }
  }
  if (noise) for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, out[i] + Math.round((random() * 2 - 1) * noise)));
  if (!scene.portrait) return { data: out, width, height };
  // Turned a quarter: the code runs down the frame.
  const turned = new Uint8Array(out.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) turned[x * height + (height - 1 - y)] = out[y * width + x];
  return { data: turned, width: height, height: width };
}

test('a song and a public playlist round-trip through 25 bars of 8 heights, ends low and middle high', () => {
  for (const payload of [SONG, PLAYLIST, { kind: 'song', source: 'saavn', id: '________' } as LuvCodePayload, { kind: 'playlist', code: '99999999' } as LuvCodePayload]) {
    const levels = encodeLuvCode(payload);
    assert.ok(levels);
    assert.equal(levels.length, BAR_COUNT);
    assert.deepEqual([levels[0], levels[12], levels[24]], [0, 7, 0]);
    assert.ok(levels.every(l => l >= 0 && l <= 7));
    assert.deepEqual(decodeLuvLevels(levels), payload);
  }
});

test('different shares draw different bars, and a flat share still draws a varied row', () => {
  assert.notDeepEqual(encodeLuvCode(SONG), encodeLuvCode({ kind: 'song', source: 'saavn', id: 'B4-hLCKK' }));
  const flat = encodeLuvCode({ kind: 'song', source: 'saavn', id: 'AAAAAAAA' })!;
  assert.ok(new Set(flat.filter((_, i) => i !== 0 && i !== 12 && i !== 24)).size >= 4);
});

test('only what fits is drawn: an 8-character JioSaavn id or an 8-character share code', () => {
  assert.equal(canEncode(SONG), true);
  assert.equal(canEncode({ kind: 'song', source: 'saavn', id: 'short' }), false);
  assert.equal(canEncode({ kind: 'song', source: 'saavn', id: 'has space' }), false);
  assert.equal(canEncode({ kind: 'playlist', code: 'abcd234' }), false);
  assert.equal(canEncode({ kind: 'playlist', code: 'abcd2340' }), false, '0 is not in the share alphabet');
  assert.equal(encodeLuvCode({ kind: 'playlist', code: 'short' }), null);
});

test('one bar read a step off is repaired; noise elsewhere is refused', () => {
  const levels = encodeLuvCode(SONG)!;
  for (const bar of [3, 11, 20]) {
    const off = [...levels];
    off[bar] = off[bar] === 7 ? 6 : off[bar] + 1;
    assert.deepEqual(decodeLuvLevels(off), SONG);
  }
  const wrecked = levels.map((l, i) => (i === 0 || i === 12 || i === 24 ? l : 7 - l));
  assert.equal(decodeLuvLevels(wrecked), null);
  assert.equal(decodeLuvLevels(levels.slice(1)), null);
});

test('heights in any unit become levels through the reference bars', () => {
  const levels = encodeLuvCode(PLAYLIST)!;
  const heights = levels.map(l => 12 + l * 9.5 + (l % 2 ? 1.2 : -1.1));
  assert.deepEqual(levelsFromHeights(heights), levels);
  assert.equal(levelsFromHeights(levels.map(() => 10)), null, 'no contrast between the reference bars');
});

test('CRC-16/CCITT-FALSE matches its check value', () => {
  const bits: number[] = [];
  for (const ch of '123456789') for (let i = 7; i >= 0; i--) bits.push((ch.charCodeAt(0) >> i) & 1);
  assert.equal(crc16(bits), 0x29b1);
});

test('reads a code from a photo: sharp, blurred and noisy, tilted, upside down, turned, dark on light, in clutter', () => {
  const levels = encodeLuvCode(SONG)!;
  const scenes: [string, Scene][] = [
    ['sharp', { scale: 1.6 }],
    ['small', { scale: 1.1, blur: true }],
    ['blurred and noisy', { scale: 2, blur: true, noise: 25 }],
    ['tilted 2°', { scale: 2, tilt: (2 * Math.PI) / 180, blur: true, noise: 10 }],
    ['upside down', { scale: 1.8, upsideDown: true, blur: true }],
    ['portrait', { scale: 1.5, portrait: true, blur: true }],
    ['dark bars on a light card', { scale: 1.6, bar: 20, card: 230, page: 120, blur: true }],
    ['busy background', { scale: 1.7, clutter: true, blur: true, noise: 12 }],
    // A code on another phone's screen: the lit card is far brighter than the room, so a threshold for the whole
    // frame falls between room and card and every bar (card-coloured or brighter) reads as "on".
    ['a lit card in a dark room', { scale: 1.2, bar: 250, card: 120, page: 12, margin: 220, blur: true, noise: 6 }],
    ['a pale card in a dark room', { scale: 1.2, bar: 255, card: 190, page: 10, margin: 220, blur: true, noise: 6 }],
    ['uneven light', { scale: 1.6, shade: 0.55, blur: true, noise: 10 }],
    ['uneven light, dark room', { scale: 1.3, bar: 250, card: 110, page: 15, margin: 180, shade: 0.5, blur: true, noise: 8 }],
  ];
  for (const [name, scene] of scenes) assert.deepEqual(decodeLuvCodeImage(photograph(levels, scene)), SONG, name);
  assert.deepEqual(decodeLuvCodeImage(photograph(encodeLuvCode(PLAYLIST)!, { scale: 1.6, blur: true, noise: 15 })), PLAYLIST);
});

test('a picture with no code reads as nothing', () => {
  const random = rng(3);
  const width = 320, height = 200;
  const data = new Uint8Array(width * height).map(() => Math.round(random() * 255));
  assert.equal(decodeLuvCodeImage({ data, width, height }), null);
  const stripes = new Uint8Array(width * height).map((_, i) => ((i % width) % 8 < 4 ? 240 : 30));
  assert.equal(decodeLuvCodeImage({ data: stripes, width, height }), null, 'even stripes have no reference bars');
  assert.equal(decodeLuvCodeImage({ data: new Uint8Array(10), width: 5, height: 2 }), null);
});

test('the drawing keeps every bar inside the box, the mark on the left', () => {
  const layout = luvCodeLayout(encodeLuvCode(SONG)!);
  assert.equal(layout.bars.length, BAR_COUNT);
  for (const b of layout.bars) {
    assert.ok(b.x > layout.mark.cx + layout.mark.r && b.x + b.width <= CODE_WIDTH);
    assert.ok(b.y >= 0 && b.y + b.height <= CODE_HEIGHT);
  }
  assert.match(layout.mark.heart, /^M [\d.]+ [\d.]+ C/);
});
