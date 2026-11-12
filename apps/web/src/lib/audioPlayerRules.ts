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
