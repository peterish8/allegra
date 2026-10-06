/**
 * A story card as a 1080 × 1920 PNG, drawn on a canvas in the browser (D17): no server route, no
 * image dependency. Shared with the Web Share API when the browser can share files, else downloaded.
 */
import type { Story } from '@shared/blendStories';
import type { BlendDetail } from '@shared/blendView';

import { orbReach, orbSeat } from '@shared/blendOrbs';
import { artistName, storyText, wrapText } from '../../lib/blendText';
import type { Palette } from '../../lib/palette';

export const SHARE_SIZE = { width: 1080, height: 1920, margin: 96 } as const;
const ART_TIMEOUT_MS = 3000;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), ART_TIMEOUT_MS);
    image.onload = () => { window.clearTimeout(timer); resolve(image); };
    image.onerror = () => { window.clearTimeout(timer); resolve(null); };
    image.src = src;
  });
}

function drawDisc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, initials: string, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = '#0e0e10';
  ctx.font = `700 ${Math.round(radius * 0.8)}px Geist, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, x, y);
}

export async function drawStoryCard(ctx: CanvasRenderingContext2D, story: Story, detail: BlendDetail, palette: Palette): Promise<void> {
  const { width, height, margin } = SHARE_SIZE;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.primary);
  gradient.addColorStop(0.55, palette.secondary);
  gradient.addColorStop(1, '#0e0e10');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const colours = [palette.tertiary, '#f2f2f4', palette.secondary, palette.primary, '#d9e66a', '#8f8f98'];
  detail.members.slice(0, 6).forEach((member, index) => {
    drawDisc(ctx, margin + 80 + index * 120, margin + 80, 64, member.initials, colours[index % colours.length] ?? '#f2f2f4');
  });

  const text = storyText(story, detail);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = '600 44px Geist, system-ui, sans-serif';
  let y = 400;
  for (const line of wrapText(text.eyebrow, width - margin * 2, (value) => ctx.measureText(value).width, 2)) {
    ctx.fillText(line, margin, y);
    y += 60;
  }
  y += 40;

  const artwork = story.kind === 'song' || story.kind === 'gift' ? await loadImage(story.song?.artwork ?? '') : null;
  if (artwork) {
    ctx.drawImage(artwork, margin, y, 420, 420);
    y += 480;
  }

  ctx.fillStyle = '#ffffff';
  const headlineSize = artwork ? 76 : 96;
  ctx.font = `800 ${headlineSize}px Geist, system-ui, sans-serif`;
  const headlineLimit = Math.max(1, Math.min(5, Math.floor((height - margin - 340 - y) / (headlineSize + 20))));
  for (const line of wrapText(text.headline, width - margin * 2, (value) => ctx.measureText(value).width, headlineLimit)) {
    ctx.fillText(line, margin, y + headlineSize);
    y += headlineSize + 20;
  }
  if (text.detail) {
    y += 40;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.font = '500 52px Geist, system-ui, sans-serif';
    const detailLimit = Math.max(1, Math.min(4, Math.floor((height - margin - 200 - y) / 70)));
    for (const line of wrapText(text.detail, width - margin * 2, (value) => ctx.measureText(value).width, detailLimit)) {
      ctx.fillText(line, margin, y + 52);
      y += 70;
    }
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px Geist, system-ui, sans-serif';
  ctx.fillText('Allegra', margin, height - margin);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '500 40px Geist, system-ui, sans-serif';
  ctx.fillText(wrapText(detail.name, width - margin * 2, value => ctx.measureText(value).width, 1)[0] ?? '', margin, height - margin - 90);
}

export async function storyCardBlob(story: Story, detail: BlendDetail, palette: Palette): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_SIZE.width;
  canvas.height = SHARE_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    await drawStoryCard(ctx, story, detail, palette);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** True when this browser can hand a PNG to the system share sheet. */
export function canShareImage(): boolean {
  if (typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(0)], 'card.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** Share a card as a PNG file when the browser can; otherwise download it. */
export async function shareCardFile(blob: Blob, fileName: string, title: string): Promise<'shared' | 'downloaded' | 'failed' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return 'cancelled';
      return 'failed';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export function shareStoryCard(story: Story, detail: BlendDetail, blob: Blob): Promise<'shared' | 'downloaded' | 'failed' | 'cancelled'> {
  return shareCardFile(blob, `allegra-blend-${story.kind}.png`, detail.name);
}

/** A CSS colour (custom properties resolved) as canvas-ready r, g, b. */
function rgbOf(ctx: CanvasRenderingContext2D, colour: string): readonly [number, number, number] {
  const custom = /^var\((--[\w-]+)\)$/.exec(colour.trim());
  const resolved = custom?.[1] ? getComputedStyle(document.documentElement).getPropertyValue(custom[1]).trim() : colour;
  // The canvas normalises any colour it accepts to #rrggbb (opaque) or rgba(…).
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = resolved || '#ffffff';
  const normal = String(ctx.fillStyle);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normal);
  if (hex) return [parseInt(hex[1] ?? 'ff', 16), parseInt(hex[2] ?? 'ff', 16), parseInt(hex[3] ?? 'ff', 16)];
  const parts = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(normal);
  return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : [255, 255, 255];
}

/**
 * The match card, 1080 × 1920: the Blend's orbs at the distance their match gives them (the same
 * seats as the hero), the number in the overlap, the names, and the artist that brings a pair together.
 */
export function drawMatchCard(ctx: CanvasRenderingContext2D, detail: BlendDetail, tones: ReadonlyMap<string, string>, palette: Palette, match: number): void {
  const { width, height, margin } = SHARE_SIZE;
  const group = detail.members.length > 2;
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, palette.primary);
  background.addColorStop(0.5, '#121216');
  background.addColorStop(1, '#0a0a0c');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = '600 48px Geist, system-ui, sans-serif';
  ctx.fillText(group ? 'Group match' : 'Taste match', margin, 260);

  // The orbs: light that brightens where it overlaps.
  const orb = group ? 440 : 540;
  const centre = { x: width / 2, y: 820 };
  const reach = orbReach(match);
  const members = detail.members.slice(0, 6);
  const seats = members.map((_, index) => orbSeat(index, members.length, reach));
  const pool = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, orb * 0.75);
  pool.addColorStop(0, `rgba(255, 255, 255, ${(0.12 + 0.3 * (match / 100)).toFixed(3)})`);
  pool.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, centre.y - orb, width, orb * 2);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  members.forEach((member, index) => {
    const seat = seats[index] ?? { x: 0, y: 0 };
    const x = centre.x + seat.x * orb;
    const y = centre.y + seat.y * orb;
    const [r, g, b] = rgbOf(ctx, tones.get(member.userId) ?? '#ffffff');
    const light = ctx.createRadialGradient(x, y, 0, x, y, orb / 2);
    light.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    light.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, 0.82)`);
    light.addColorStop(0.72, `rgba(${r}, ${g}, ${b}, 0.34)`);
    light.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(x, y, orb / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 40;
  ctx.font = '800 240px Geist, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${match}%`, centre.x, centre.y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 52px Geist, system-ui, sans-serif';
  const nameOf = (index: number): string => {
    const member = members[index];
    return member ? (member.isYou ? 'You' : member.displayName) : '';
  };
  let y = centre.y + orb * (group ? 1 : 0.7);
  if (!group) {
    seats.forEach((seat, index) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(wrapText(nameOf(index), orb * 0.9, (value) => ctx.measureText(value).width, 1)[0] ?? '', centre.x + seat.x * orb, y);
    });
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const names = members.map((_, index) => nameOf(index));
    const line = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}` : names.join('');
    for (const part of wrapText(line, width - margin * 2, (value) => ctx.measureText(value).width, 2)) {
      ctx.fillText(part, centre.x, y);
      y += 66;
    }
  }

  const together = !group ? detail.pairs[0]?.together : '';
  if (together) {
    y += 150;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.font = '600 44px Geist, system-ui, sans-serif';
    ctx.fillText('The artist that brings you together', centre.x, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 84px Geist, system-ui, sans-serif';
    for (const part of wrapText(artistName(together, detail.tracks), width - margin * 2, (value) => ctx.measureText(value).width, 2)) {
      y += 104;
      ctx.fillText(part, centre.x, y);
    }
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px Geist, system-ui, sans-serif';
  ctx.fillText('Allegra', margin, height - margin);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '500 40px Geist, system-ui, sans-serif';
  ctx.fillText(wrapText(detail.name, width - margin * 2, (value) => ctx.measureText(value).width, 1)[0] ?? '', margin, height - margin - 90);
}

export async function matchCardBlob(detail: BlendDetail, tones: ReadonlyMap<string, string>, palette: Palette, match: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_SIZE.width;
  canvas.height = SHARE_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    drawMatchCard(ctx, detail, tones, palette, match);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
