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
