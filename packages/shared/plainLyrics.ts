/** Fallback for browsers/devices without a scroll-end event; only wait for the gesture to settle. */
export const PLAIN_SCROLL_SETTLE_MS = 120;

/** Reading progress only: plain words have no sung-line or word timestamps. */
export function plainLyricsProgress(time: number, duration: number): number {
  'worklet';
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  const intro = duration > 10 ? 10 : 0;
  return Math.max(0, Math.min(1, (time - intro) / (duration - intro)));
}

export function plainLyricsScroll(time: number, duration: number, content: number, viewport: number): number {
  'worklet';
  return Math.max(0, content - viewport) * plainLyricsProgress(time, duration);
}

/** Continue at the normal reading speed from the reader's chosen place, without snapping back. */
export function continuePlainLyrics(time: number, duration: number, content: number, viewport: number, anchorTime: number, anchorTop: number): number {
  'worklet';
  const extent = Math.max(0, content - viewport);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time) || !Number.isFinite(anchorTime)) return Math.max(0, Math.min(extent, anchorTop));
  // Choosing a reading position overrides the intro hold too: continue immediately from that spot.
  const travel = extent * Math.max(0, time - anchorTime) / (duration > 10 ? duration - 10 : duration);
  return Math.max(0, Math.min(extent, anchorTop + travel));
}
