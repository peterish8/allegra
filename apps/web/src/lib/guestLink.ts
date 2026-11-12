/**
 * Merging the browser's guest into the account that just signed in.
 *
 * The result tells the caller whether it is finished. Only `failed` may be tried again; `merged` and `none`
 * are final. A guest token is removed from storage only after the server has said it took it, so a lost
 * request never costs the listener the guest's likes and playlists. The server treats a repeat as a no-op
 * (a merged guest no longer resolves), so retrying after a lost response is safe.
 */
export type GuestLinkResult = 'merged' | 'none' | 'failed';

export interface GuestLinkStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export async function linkGuest(
  storage: GuestLinkStorage,
  key: string,
  post: (guestToken: string) => Promise<unknown>
): Promise<GuestLinkResult> {
  let guestToken: string | null;
  try {
    guestToken = storage.getItem(key);
  } catch {
    return 'none';
  }
  if (!guestToken) return 'none';
  try {
    await post(guestToken);
  } catch {
    return 'failed';
  }
  try {
    storage.removeItem(key);
  } catch {
    // Private mode: the merge happened; a stale token is harmless because the server ignores a merged guest.
  }
  return 'merged';
}

/** Seconds to wait before attempt n+1 (n starts at 1): 2, 4, 8, 16, then 30 at most. */
export function guestLinkBackoffMs(attempt: number): number {
  return Math.min(30, 2 ** Math.max(1, attempt)) * 1000;
}

/** After this many failed attempts the provider stops on its own and waits for the next sign-in or reload. */
export const GUEST_LINK_MAX_ATTEMPTS = 6;
