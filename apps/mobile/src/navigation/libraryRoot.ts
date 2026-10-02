/**
 * What a tap on the Library tab does to the stack inside it.
 *
 * Library is a tab with a stack of its own: Library home, then Playlists, then one playlist. The ••• menu
 * and Library's own button push Playlists onto it, and a tab keeps its stack when you leave it, so coming
 * back to the Library tab used to land on Playlists (or a playlist) instead of the Library. A tap on the
 * tab now means "take me to Library": the stack goes back to the home screen.
 */
export const LIBRARY_ROOT = 'LibraryHome';

export interface StackSnapshot {
  readonly routes: readonly { readonly name: string }[];
  readonly index?: number;
}

/**
 * - `none`   already on the Library home (or nothing is mounted yet, which opens on it).
 * - `pop`    the home is the bottom of the stack: pop back to it, animated.
 * - `reset`  the stack was opened on a deeper screen with no home beneath it (the ••• menu can do that
 *            when the tab had never been shown): replace it with the home.
 */
export type RootMove = 'none' | 'pop' | 'reset';

/**
 * The Library home registers how to scroll itself to the top; a tap on the Library tab while it is already on
 * the home calls it, as every tab bar does. One screen at a time, and it unregisters when it goes.
 */
let scrollLibraryToTop: (() => void) | null = null;
export function registerLibraryScrollToTop(handler: () => void): () => void {
  scrollLibraryToTop = handler;
  return () => { if (scrollLibraryToTop === handler) scrollLibraryToTop = null; };
}
export function scrollLibraryHomeToTop(): void {
  scrollLibraryToTop?.();
}

export function libraryRootMove(stack: StackSnapshot | undefined): RootMove {
  if (!stack || stack.routes.length === 0) return 'none';
  const top = stack.routes[stack.index ?? stack.routes.length - 1];
  if (top?.name === LIBRARY_ROOT) return 'none';
  return stack.routes[0]?.name === LIBRARY_ROOT ? 'pop' : 'reset';
}
