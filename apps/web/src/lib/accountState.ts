/**
 * Who is listening, and whether the app knows yet.
 *
 * Convex resolves a returning Google session late: a token arrives some moments after the page does, and
 * the profile behind it a moment after that. For that stretch the browser's own guest profile is all the
 * app has, and showing it makes a signed-in listener look like a guest, then flip to their name. Three
 * states instead of two: the app is still finding out, or it knows they are a guest, or it knows who they are.
 */
export interface AccountSnapshot {
  /** Convex has not yet said whether this browser has a session. */
  readonly loading: boolean;
  /** Convex says there is a Google session. */
  readonly signedIn: boolean;
  /** The first profile load has finished. */
  readonly ready: boolean;
  readonly profile: { readonly isGuest: boolean } | null;
}

/** True while the answer to "guest or account?" is not known yet: show nothing about it rather than a guess. */
export function isResolvingAccount(state: AccountSnapshot): boolean {
  if (state.loading || !state.ready) return true;
  // Signed in with Convex, but the profile we hold is still the guest one from before the token arrived.
  return state.signedIn && (state.profile === null || state.profile.isGuest);
}

const KEY = 'allegra:last-account';

/** Minimal slice of `Storage`, so this can be tested without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The name to show in the sidebar on the first paint, before the profile has loaded. */
export function recallAccountName(store: KeyValueStore | null): string | null {
  try {
    const value = store?.getItem(KEY);
    return value && value.trim() ? value.trim().slice(0, 80) : null;
  } catch {
    return null;
  }
}

/** Remember who was signed in (a name), or forget it (null) once they are known to be a guest. */
export function rememberAccountName(store: KeyValueStore | null, name: string | null): void {
  try {
    if (name && name.trim()) store?.setItem(KEY, name.trim().slice(0, 80));
    else store?.removeItem(KEY);
  } catch {
    // Storage can be blocked or full: the chip then waits for the profile, which is only slower.
  }
}

/** The best name for an account: what they chose, else the part of their email before the @. */
export function accountDisplayName(profile: { readonly displayName?: string | null; readonly email?: string | null }): string {
  const chosen = profile.displayName?.trim();
  if (chosen) return chosen;
  const local = profile.email?.split('@')[0]?.trim();
  return local || 'Your account';
}
