// GENERATED from packages/shared/blendDecay.ts by `npm run sync:shared`. Do not edit here.
/**
 * Forward decay (Cormode et al., ICDE 2009): a weight that halves every DECAY_HALF_LIFE_MS is
 * stored scaled up by when it happened, so stored scores compare directly and a write never
 * re-decays anything else. Read the current value with currentWeight.
 */
export const DECAY_LANDMARK_MS = Date.UTC(2026, 0, 1); // never change after release
export const DECAY_HALF_LIFE_MS = 45 * 86_400_000;

/**
 * Input timestamps are supported from UTC 1976-01-01 through UTC 2076-01-01, inclusive.
 * Outside this horizon, the exact exponent may underflow or overflow; it is never clamped.
 */
export function decayFactor(atMs: number): number {
  return 2 ** ((atMs - DECAY_LANDMARK_MS) / DECAY_HALF_LIFE_MS);
}

/** Adds `amount` (minutes-equivalent) that happened at `atMs`. Never below 0. */
export function addDecayed(score: number, amount: number, atMs: number): number {
  return Math.max(0, score + amount * decayFactor(atMs));
}

export function currentWeight(score: number, nowMs: number): number {
  return score / decayFactor(nowMs);
}

export const TALLY_AMOUNT = {
  likeBonus: 10,
  playlistAdd: 5,
  skip: -1,
  seedRecent: 3
} as const;

export const TALLY_MAX_SONGS = 200;
export const TALLY_RECENT_LISTENS = 8;

/** Minutes heard, capped at one play of the song; a listen under 10 s is a skip. */
export function listenAmount(secondsHeard: number, songSeconds: number): number {
  if (secondsHeard < 10) return TALLY_AMOUNT.skip;
  const capped = songSeconds > 0 ? Math.min(secondsHeard, songSeconds) : secondsHeard;
  return capped / 60;
}
