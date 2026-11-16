/**
 * What the canvas layer's single video player does when the shown clip changes (CanvasVideoLayer.tsx).
 *
 * The player lives as long as the layer and is never swapped: a clip loads into it in place, and when the clip goes
 * away the video view unmounts first and the player lets go of the clip only after a pause, once the TextureView has
 * detached. Releasing or clearing a player whose surface is still attached closed the app on some phones (1.41.1).
 */
import type { CanvasArtwork } from '../services/canvas/types';

/** After the layer unmounts, how long the player outlives its view before it is released. */
export const PLAYER_RELEASE_DELAY_MS = 1000;
/** After a clip goes away, how long the (already detached) player keeps it before clearing it. */
export const SOURCE_CLEAR_DELAY_MS = 600;

export interface CanvasSource {
  uri: string;
  contentType: 'hls' | 'auto';
}

export type CanvasSourcePlan =
  | { kind: 'load'; source: CanvasSource }
  | { kind: 'clear'; afterMs: number };

export const canvasSourcePlan = (canvas: Pick<CanvasArtwork, 'url' | 'isHls'> | null): CanvasSourcePlan =>
  canvas
    ? { kind: 'load', source: { uri: canvas.url, contentType: canvas.isHls ? 'hls' : 'auto' } }
    : { kind: 'clear', afterMs: SOURCE_CLEAR_DELAY_MS };

/** The address a loaded source names (expo-video's `sourceLoad` payload), or null when it names none. */
export const sourceUri = (source: unknown): string | null => {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object' && typeof (source as { uri?: unknown }).uri === 'string') return (source as { uri: string }).uri;
  return null;
};

const sameAddress = (a: string, b: string): boolean => {
  if (a === b) return true;
  try { return decodeURI(a) === decodeURI(b); } catch { return false; }
};

/**
 * Whether a player event belongs to the clip this layer is loading. A late event from a clip that was skipped,
 * closed or replaced (it names another address) must never size or reveal the new clip over the still cover. An
 * event that names no address is taken to follow the latest load, which is the order the player reports them in.
 */
export const clipEventApplies = (eventUri: string | null, loadingUrl: string | null): boolean =>
  loadingUrl !== null && (eventUri === null || sameAddress(eventUri, loadingUrl));

/**
 * A first frame can start the reveal only for the clip on show, once that clip's own source has loaded. Until then
 * the still cover under the layer is what shows: a slow, failed or stale video stays on the poster.
 */
export const firstFrameCounts = (load: { url: string | null; loaded: boolean }, shownUrl: string | null | undefined): boolean =>
  load.loaded && load.url !== null && !!shownUrl && sameAddress(load.url, shownUrl);
