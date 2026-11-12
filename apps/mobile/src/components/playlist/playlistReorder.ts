/**
 * Playlist reordering (owner, 2026-11-11: dragging glitched and could not move a song more than one
 * screen). The drag list scrolls itself while a row is held near an edge; these numbers set how close
 * to the edge that starts and how far each step scrolls. Saving is all-or-nothing: the saved order is
 * the dragged order, or the saved order is read back and shown again.
 */

export const PLAYLIST_DRAG = {
  /** A held row starts moving with the finger at once; the handle's long press already confirmed intent. */
  activationDistance: 0,
  /** Distance from the list's top or bottom edge (dp) at which a held row starts scrolling the list. */
  autoscrollThreshold: 80,
  /** Largest scroll step (dp) when the row sits on the edge; nearer the middle it scrolls slower. */
  autoscrollSpeed: 360,
} as const;

/** What entering edit mode resets: a drag edits the saved order, never a title sort or a filtered subset. */
export const EDIT_ENTRY = {
  searchQuery: '',
  searchActive: false,
  sortOption: 'custom',
  sortDirection: 'asc',
} as const;

export type ReorderSaveResult = 'saved' | 'skipped' | 'restored';

/**
 * A playlist's rows in the order the listener dragged them into (owner, 2026-11-13: a reorder "goes back to the
 * old order"). The screen lists downloaded songs and then account-only songs, and only the first kind had a saved
 * position. Rows with a saved place come in that order; rows added since keep their own order after them.
 */
export function applySavedOrder<T extends { readonly id: string }>(rows: readonly T[], saved: readonly string[]): T[] {
  if (saved.length === 0) return [...rows];
  const place = new Map(saved.map((id, index) => [id, index]));
  const known = rows.filter(row => place.has(row.id)).sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
  const added = rows.filter(row => !place.has(row.id));
  return [...known, ...added];
}

export interface ReorderSaveDeps {
  /** Writes the playlist's order. */
  readonly persist: (orderedIds: readonly string[]) => Promise<void>;
  /** Reads the saved order back into the screen after a failed write. */
  readonly reload: () => Promise<void>;
}

/**
 * Saves a finished drag. A filtered list is a subset, so its order is not the playlist's and is never
 * written. A failed write reloads what is saved, so the screen never shows an order that was not kept.
 */
export async function saveDraggedOrder(
  orderedIds: readonly string[],
  filtered: boolean,
  deps: ReorderSaveDeps,
): Promise<ReorderSaveResult> {
  if (filtered) return 'skipped';
  try {
    await deps.persist([...orderedIds]);
    return 'saved';
  } catch {
    await deps.reload().catch(() => undefined);
    return 'restored';
  }
}
