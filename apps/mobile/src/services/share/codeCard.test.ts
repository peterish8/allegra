import { decodeLuvCodeImage, encodeLuvCode, luvCodeLayout, type LuvCodePayload } from '@shared/luvCode';
import { captionFor, cardFileName, codeCardPlan } from './codeCard';

/** Draws the card the way exportCode does, into one luma byte a pixel (card tone and bar tone as luma values). */
function raster(payload: LuvCodePayload, card: number, ink: number) {
  const plan = codeCardPlan();
  const width = Math.round(plan.width);
  const height = Math.round(plan.height);
  const data = new Uint8Array(width * height).fill(card);
  const levels = encodeLuvCode(payload);
  if (!levels) throw new Error('not encodable');
  const layout = luvCodeLayout(levels);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) data[y * width + x] = ink;
    }
  };
  for (const bar of layout.bars) fill(plan.dx + bar.x * plan.scale, plan.dy + bar.y * plan.scale, plan.dx + (bar.x + bar.width) * plan.scale, plan.dy + (bar.y + bar.height) * plan.scale);
  const { cx, cy, r } = layout.mark;
  for (let y = plan.dy + (cy - r) * plan.scale; y < plan.dy + (cy + r) * plan.scale; y++) {
    for (let x = plan.dx + (cx - r) * plan.scale; x < plan.dx + (cx + r) * plan.scale; x++) {
      const px = (x - plan.dx) / plan.scale - cx;
      const py = (y - plan.dy) / plan.scale - cy;
      if (px * px + py * py <= r * r) data[Math.round(y) * width + Math.round(x)] = ink;
    }
  }
  return { data, width, height };
}

/** Box-filter shrink, like a chat app or a screenshot downscaling the picture. */
function shrink(img: { data: Uint8Array; width: number; height: number }, factor: number) {
  const width = Math.max(1, Math.round(img.width * factor));
  const height = Math.max(1, Math.round(img.height * factor));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / factor), x1 = Math.min(img.width, Math.ceil((x + 1) / factor));
      const y0 = Math.floor(y / factor), y1 = Math.min(img.height, Math.ceil((y + 1) / factor));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += img.data[yy * img.width + xx]; n++; }
      out[y * width + x] = n ? sum / n : 0;
    }
  }
  return { data: out, width, height };
}

const PLAYLIST: LuvCodePayload = { kind: 'playlist', code: 'k7mq2xaz' };
const SONG: LuvCodePayload = { kind: 'song', source: 'saavn', id: 'B4-hLCKJ' };

describe('the shared code image', () => {
  it('is large, with a quiet zone on every side', () => {
    const plan = codeCardPlan();
    expect(plan.width).toBe(1600);
    expect(plan.dx).toBeGreaterThanOrEqual(120);
    expect(plan.width - plan.dx - 400 * plan.scale).toBeGreaterThanOrEqual(120);
    expect(plan.dy).toBeGreaterThanOrEqual(120);
  });

  it.each([
    ['song', SONG],
    ['playlist', PLAYLIST],
  ])('reads back a %s code at full size and shrunk the way chat apps shrink it', (_name, payload) => {
    const full = raster(payload, 40, 245);
    expect(decodeLuvCodeImage(full)).toEqual(payload);
    for (const factor of [0.5, 0.3, 0.2]) {
      expect(decodeLuvCodeImage(shrink(full, factor))).toEqual(payload);
    }
  });

  it('also reads a dark-on-light card, as a printout or a light theme would make', () => {
    expect(decodeLuvCodeImage(shrink(raster(SONG, 235, 30), 0.3))).toEqual(SONG);
  });
});

describe('the card caption and file name', () => {
  it('keeps a long name to one line', () => {
    expect(captionFor('  Short  name ')).toBe('Short name');
    expect(captionFor('A'.repeat(60))).toHaveLength(34);
    expect(captionFor('A'.repeat(60)).endsWith('…')).toBe(true);
  });

  it('makes a safe file name from any name', () => {
    expect(cardFileName('playlist', 'Late night — Chill / 2026!')).toBe('luvlyrics-playlist-Late-night-Chill-2026.png');
    expect(cardFileName('song', '???')).toBe('luvlyrics-song-code.png');
  });
});
