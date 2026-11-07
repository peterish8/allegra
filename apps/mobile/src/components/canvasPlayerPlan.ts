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
