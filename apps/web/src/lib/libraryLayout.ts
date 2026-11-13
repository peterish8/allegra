export type PlaylistLayout = 'grid' | 'list';

export const PLAYLIST_LAYOUT_KEY = 'allegra-library-playlist-layout';

/** Anything that is not exactly "list" is the default grid, so a stale or edited value never breaks the page. */
export function parsePlaylistLayout(value: unknown): PlaylistLayout {
  return value === 'list' ? 'list' : 'grid';
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The saved layout. Storage can be missing, blocked or throw: the answer is then the grid. */
export function readPlaylistLayout(storage: ReadableStorage | null = browserStorage()): PlaylistLayout {
  try {
    return parsePlaylistLayout(storage?.getItem(PLAYLIST_LAYOUT_KEY));
  } catch {
    return 'grid';
  }
}

export function writePlaylistLayout(layout: PlaylistLayout, storage: WritableStorage | null = browserStorage()): void {
  try {
    storage?.setItem(PLAYLIST_LAYOUT_KEY, layout);
  } catch {
    // The choice only lasts for this visit.
  }
}
