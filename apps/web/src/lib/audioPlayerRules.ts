/** Media events belong to the selected track only after its source has loaded for the current generation. */
export function isCurrentMediaGeneration(input: {
  activeGeneration: number;
  loadedGeneration: number;
  activeSongId: string | null;
  loadedSongId: string | null;
  expectedSource: string | null;
  currentSource: string;
}): boolean {
  return input.activeGeneration === input.loadedGeneration
    && input.activeSongId !== null
    && input.activeSongId === input.loadedSongId
    && input.expectedSource !== null
    && input.expectedSource === input.currentSource;
}

/**
 * Whether the player should show "playing", read from the element once its source has loaded.
 *
 * The `play` event of a fresh pick fires before the source's metadata, while its events are still
 * ignored as belonging to the previous song, so it can never be relied on to flip the state. The
 * element itself can: playing means playing. A paused element with a pending request to play
 * (a source switch in flight) keeps what is shown; with no such request it is simply paused.
 */
export function shownAsPlaying(input: { paused: boolean; wantsPlay: boolean; shown: boolean }): boolean {
  if (!input.paused) return true;
  return input.wantsPlay ? input.shown : false;
}

/** A source switch (karaoke) that has not opened by now has failed. */
/**
 * Whether the "already moved on" latch is a queue that ended and may move on again. The latch is
 * set when a song advances and when the queue runs out; an edit that adds songs or changes repeat
 * or shuffle gives an ended queue a next song, so it clears it. While a move to the next song is
 * still loading (the generations differ) the latch stays: it stops the old source advancing twice.
 */
export function reopensQueueEnd(input: { latched: boolean; activeGeneration: number; loadedGeneration: number }): boolean {
  return input.latched && input.activeGeneration === input.loadedGeneration;
}

export const SOURCE_SWAP_TIMEOUT_MS = 15_000;

/**
 * What the player does once a source switch settles. `dead`: neither the new source nor the original
 * opened, so nothing can play and nothing may stay waiting to (the button must not keep showing Pause).
 * `resume` only when it was playing and nobody paused during the switch.
 */
export function afterSourceSwap(input: { opened: boolean; wasPlaying: boolean; wantsPlay: boolean }): 'dead' | 'resume' | 'stay' {
  if (!input.opened) return 'dead';
  return input.wasPlaying && input.wantsPlay ? 'resume' : 'stay';
}

export function playbackRejectionMessage(errorName: string): string {
  return errorName === 'NotAllowedError'
    ? 'Playback needs a tap to begin. Try the play button again.'
    : 'This track could not be loaded. Try another song.';
}

/** Player shortcuts must not steal keys from text controls, dialogs, menus or range sliders. */
export function shouldHandlePlayerShortcut(target: Element | null, key: string): boolean {
  if (key !== ' ' && key !== 'Spacebar' && key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
  if (!target) return true;
  return !target.closest('input, textarea, select, button, [contenteditable="true"], [role="dialog"], [role="menu"], [role="slider"]');
}

export interface RecoveryCursor {
  readonly remaining: number;
  readonly visited: ReadonlySet<string>;
}

/** Walk auto-selected tracks once at most; this cursor caps recovery even when repeat-all is enabled. */
export function takeNextUnvisited<T extends { readonly id: string }>(
  candidates: readonly T[],
  cursor: RecoveryCursor
): { readonly candidate: T | null; readonly cursor: RecoveryCursor } {
  if (cursor.remaining <= 0) return { candidate: null, cursor };
  const candidate = candidates.find((item) => !cursor.visited.has(item.id));
  if (!candidate) return { candidate: null, cursor };
  return {
    candidate,
    cursor: { remaining: cursor.remaining - 1, visited: new Set([...cursor.visited, candidate.id]) },
  };
}

/** Seconds a song may end short of its length before the end counts as a cut. */
export const CUTOFF_THRESHOLD_SECONDS = 3;
/** Reloads allowed per song for a cut or a mid-song network error. */
export const MAX_MIDSONG_RECOVERIES = 2;
/** Below this position a failure is a load failure, handled by the existing recovery cursor. */
export const MIN_RECOVERY_POSITION_SECONDS = 1;
/** MediaError.code for MEDIA_ERR_NETWORK: the browser gave up fetching the stream. */
const MEDIA_ERR_NETWORK = 2;

export interface EndCheck {
  readonly positionSec: number;
  /** `audio.duration`. NaN or Infinity when the element does not know it. */
  readonly elementDurationSec: number;
  /** The catalog duration of the song, 0 when unknown. */
  readonly catalogDurationSec: number;
  readonly recoveriesUsed: number;
}

/**
 * Whether a song that reached its end really ended. The element's own duration is trusted first:
 * a position within the threshold of it is the genuine end, whatever the catalog says (an edit or
 * a longer album version can differ). The catalog duration is used only when the element has none.
 */
export function endVerdict(check: EndCheck): 'accept' | 'resume' {
  const position = Math.max(0, check.positionSec);
  if (!(position >= MIN_RECOVERY_POSITION_SECONDS)) return 'accept';
  const expected = Number.isFinite(check.elementDurationSec) ? check.elementDurationSec : check.catalogDurationSec;
  if (!Number.isFinite(expected) || expected <= 0) return 'accept';
  if (expected - position <= CUTOFF_THRESHOLD_SECONDS || check.recoveriesUsed >= MAX_MIDSONG_RECOVERIES) return 'accept';
  return 'resume';
}

/**
 * Whether a media error mid-song is a stream that stopped (reload the same song at the same second)
 * or a failure to keep. Only a network error is retried: a decode or unsupported-source error fails
 * again on reload, and an error before the song has played a second is a load failure.
 */
export function errorVerdict(input: { readonly mediaErrorCode: number | null; readonly positionSec: number; readonly recoveriesUsed: number }): 'resume' | 'fail' {
  const resumable = input.mediaErrorCode === MEDIA_ERR_NETWORK
    && input.positionSec >= MIN_RECOVERY_POSITION_SECONDS
    && input.recoveriesUsed < MAX_MIDSONG_RECOVERIES;
  return resumable ? 'resume' : 'fail';
}
