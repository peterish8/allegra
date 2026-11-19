/**
 * Escape for a layer that sits on top of the player (a popover or sheet).
 *
 * It listens in the capture phase and swallows the key, so the player's own window-level handler
 * never sees it: the first Escape closes only the layer, the next one closes the player.
 * Returns the cleanup function.
 */
export function listenForEscape(
  target: Pick<Document, 'addEventListener' | 'removeEventListener'>,
  onEscape: () => void
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    onEscape();
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
