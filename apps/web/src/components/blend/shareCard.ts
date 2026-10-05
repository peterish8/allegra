/**
 * A story card as a 1080 × 1920 PNG, drawn on a canvas in the browser (D17): no server route, no
 * image dependency. Shared with the Web Share API when the browser can share files, else downloaded.
 */
import type { Story } from '@shared/blendStories';
import type { BlendDetail } from '@shared/blendView';

import { storyText, wrapText } from '../../lib/blendText';
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

/** Share the card as a PNG file when the browser can; otherwise download it. */
export async function shareStoryCard(story: Story, detail: BlendDetail, blob: Blob): Promise<'shared' | 'downloaded' | 'failed' | 'cancelled'> {
  const file = new File([blob], `allegra-blend-${story.kind}.png`, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: detail.name });
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
