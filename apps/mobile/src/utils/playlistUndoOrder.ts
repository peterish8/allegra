/** Restore the old order without resurrecting removed rows or dropping later additions. */
export function playlistUndoOrder(original: readonly string[], current: readonly string[]): string[] {
  const present = new Set(current);
  const known = new Set(original);
  return [...original.filter(id => present.has(id)), ...current.filter(id => !known.has(id))];
}
