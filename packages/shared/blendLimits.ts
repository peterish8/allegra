/**
 * Blend's hard limits (PLAN.md D9, D10), read by Convex, the API and both apps so every layer
 * refuses the same things.
 */

/** Members per Blend: pairs and groups of up to 6 (phase 11). */
export const BLEND_MAX_MEMBERS = 6;

/** The most a data model row holds, whatever BLEND_MAX_MEMBERS is set to. */
export const BLEND_MEMBERS_CEILING = 6;

/** Blends one listener can be in at once. */
export const BLEND_MAX_PER_USER = 20;

/** An invite link works for this long after it was made. */
export const BLEND_INVITE_DAYS = 7;

/** A Blend's name, trimmed. */
export const BLEND_NAME_MAX = 60;

/** A member's display name as stored on the Blend. */
export const BLEND_DISPLAY_NAME_MAX = 40;

/** Characters in an invite code. */
export const BLEND_INVITE_CODE_LENGTH = 12;

/** The invite alphabet (no 0, 1, i, l, o), the same as share codes. */
export const BLEND_INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Fewer tracks than this and the Blend shows "not enough yet". */
export const BLEND_MIN_TRACKS = 10;

/** True for a well-formed invite code. A malformed code is answered exactly like an unknown one. */
export function isBlendInviteCode(code: string): boolean {
  if (code.length !== BLEND_INVITE_CODE_LENGTH) return false;
  for (const char of code) if (!BLEND_INVITE_ALPHABET.includes(char)) return false;
  return true;
}

/** "Asha Rao" → "AR"; "asha" → "A"; nothing → "?". */
export function initialsOf(displayName: string): string {
  const letters = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

/** The UTC day a build belongs to (D8): 'YYYY-MM-DD'. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
