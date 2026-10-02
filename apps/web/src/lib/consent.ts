import { POLICY_VERSION } from '@shared/legal';

/**
 * The tick in the sign-in dialog has to survive the trip to Google and back: sign-in is a full
 * redirect, and the account that will hold the consent does not exist until it returns. So the
 * tick is remembered here, and sent to the server (POST /api/me/consent) once signed in.
 */
const PENDING_KEY = 'allegra-consent-pending';

/** The listener ticked the box for the current policies. */
export function rememberConsent(): void {
  try {
    window.localStorage.setItem(PENDING_KEY, POLICY_VERSION);
  } catch {
    // Storage unavailable: the account panel asks again after sign-in.
  }
}

/** True when a tick for the current policies is waiting to be recorded. */
export function hasPendingConsent(): boolean {
  try {
    return window.localStorage.getItem(PENDING_KEY) === POLICY_VERSION;
  } catch {
    return false;
  }
}

export function clearPendingConsent(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing was stored.
  }
}
