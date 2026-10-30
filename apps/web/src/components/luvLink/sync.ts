import type { LuvLinkMode, LuvLinkPlaybackAnchor } from '@shared/luvLink';
import { projectLuvLinkPosition } from '@shared/luvLink';

/** The part of a room and anchor that decides whether this device should touch its player. */
export interface AnchorApplicationInput {
  readonly mode: LuvLinkMode;
  readonly userId: string;
  readonly leaderUserId: string;
  readonly handoffFromUserId: string | null;
  readonly anchor: Pick<LuvLinkPlaybackAnchor, 'sequence' | 'intentByUserId' | 'outputAppliedSequence'>;
  /** The sequence this device already put into its own player when it published, if any. */
  readonly ownAppliedSequence: number | null;
}

export type AnchorApplication =
  | { readonly kind: 'stop-output'; readonly acknowledgeHandoff: boolean }
  | { readonly kind: 'wait' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'apply'; readonly acknowledgeIntent: boolean };

/**
 * What to do with a committed anchor.
 *
 * Speaker mode: only the elected output opens audio; everyone else pauses and the old output
 * acknowledges the handoff. Listen mode: every device, the room's leader included, follows the
 * anchor, except one this device just published and already applied. The leader used to skip every
 * anchor in listen mode, so a controller's pause or track change never reached the host.
 */
export function planAnchorApplication(input: AnchorApplicationInput): AnchorApplication {
  const { mode, userId, leaderUserId, handoffFromUserId, anchor, ownAppliedSequence } = input;
  if (mode === 'speaker') {
    if (leaderUserId !== userId) return { kind: 'stop-output', acknowledgeHandoff: handoffFromUserId === userId };
    if (handoffFromUserId) return { kind: 'wait' };
    if (anchor.outputAppliedSequence >= anchor.sequence) return { kind: 'skip' };
    return { kind: 'apply', acknowledgeIntent: true };
  }
  if (anchor.intentByUserId === userId && ownAppliedSequence !== null && ownAppliedSequence >= anchor.sequence) return { kind: 'skip' };
  return { kind: 'apply', acknowledgeIntent: false };
}

export interface LocalAudioReading {
  readonly songRef: string | null;
  readonly currentTime: number;
  /** The element has loaded this song far enough for `currentTime` to mean something. */
  readonly loaded: boolean;
  readonly playing: boolean;
}

/**
 * Where the room is right now, read at the moment it is needed. The local element wins when it is
 * playing the room's song while the room plays, since that is what this listener hears; otherwise the server anchor is
 * projected with the sampled clock. A memoised projection goes stale the moment the anchor stops
 * changing, which is how a pause used to publish the position of the last play.
 */
export function liveRoomPosition(
  anchor: LuvLinkPlaybackAnchor | null,
  nowMs: number,
  clockOffsetMs: number,
  local: LocalAudioReading | null,
): number {
  if (!anchor?.song) return 0;
  if (anchor.playing && local?.loaded && local.playing && local.songRef === anchor.song.ref && Number.isFinite(local.currentTime)) {
    return Math.max(0, Math.min(anchor.song.duration, local.currentTime));
  }
  return projectLuvLinkPosition(anchor, nowMs, clockOffsetMs);
}

/** A committed play lands slightly ahead (the barrier release is stamped 500 ms out): wait for it. */
export const MAX_START_DELAY_MS = 1_500;
const MIN_START_DELAY_MS = 40;

export function startDelayMs(anchor: Pick<LuvLinkPlaybackAnchor, 'playing' | 'effectiveAtMs'>, nowMs: number, clockOffsetMs: number): number {
  if (!anchor.playing) return 0;
  const wait = anchor.effectiveAtMs - (nowMs + clockOffsetMs);
  return wait < MIN_START_DELAY_MS ? 0 : Math.min(MAX_START_DELAY_MS, wait);
}

const PLAYING_DRIFT_SEC = 0.75;
const PAUSED_DRIFT_SEC = 0.3;

/**
 * Whether the local element should be moved to `targetSec`. A seek pauses and resumes the stream,
 * so repeating one for every 30 second checkpoint anchor was an audible hiccup in every listener.
 */
export function needsSeek(currentSec: number, targetSec: number, playing: boolean): boolean {
  if (!Number.isFinite(currentSec) || !Number.isFinite(targetSec)) return true;
  return Math.abs(currentSec - targetSec) > (playing ? PLAYING_DRIFT_SEC : PAUSED_DRIFT_SEC);
}

/** Errors the server raised on purpose (ConvexError with a code) will fail the same way again. */
export function isRetryableLuvLinkError(error: unknown): boolean {
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : undefined;
  if (data && typeof data === 'object') {
    const code = (data as { code?: unknown }).code;
    if (typeof code === 'string') return code === 'rate_limited';
  }
  return true;
}

export interface RetryOptions {
  readonly delaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  readonly shouldRetry?: (error: unknown) => boolean;
  /** Stop retrying, with the last error, once the work no longer matters. */
  readonly isCurrent?: () => boolean;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [400, 1_000, 2_500];
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Runs a mutation, repeating it on transport failures. Every LuvLink mutation is idempotent or fenced by epoch and sequence. */
export async function retryLuvLink<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  const shouldRetry = options.shouldRetry ?? isRetryableLuvLinkError;
  for (let attempt = 0; ; attempt += 1) {
    try { return await run(); }
    catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !shouldRetry(error) || options.isCurrent?.() === false) throw error;
      await sleep(delay);
      if (options.isCurrent?.() === false) throw error;
    }
  }
}

/** Reads a ConvexError's user-facing message, falling back to a plain Error's. */
export function readableLuvLinkError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const nested = record?.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>).message : null;
  return typeof nested === 'string' ? nested : error instanceof Error ? error.message : 'That did not work. Try again.';
}
