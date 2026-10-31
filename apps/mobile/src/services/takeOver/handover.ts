/**
 * @fileoverview "Continue here": the timing of the handover, pure. The other app keeps playing while LuvLyrics searches and loads, so
 * the song is started where the other app will be by the time ours is playing, then lined up once more when it is.
 * All seconds.
 */

/** What loading and starting a streamed song takes after the search has answered, on top of the time already spent. */
export const LOAD_LEAD_S = 1.5;
/** A correcting seek is worth its small gap only when the two are further apart than this. */
export const DRIFT_TOLERANCE_S = 0.4;
/** Our player gets this long to report playing before the handover is given up (the other app is left playing). */
export const START_WAIT_MS = 15_000;
/** The search stops waiting on its slowest lookups after this long. */
export const TAKE_OVER_BUDGET_MS = 12_000;

/**
 * Where our copy of the song should start: the other app's position when "Continue here" was tapped, advanced by the
 * time spent since and a lead for loading. A paused song stays where it was paused.
 */
export function handoverStartS(positionS: number, playing: boolean, elapsedS: number): number {
  const start = playing ? positionS + Math.max(0, elapsedS) + LOAD_LEAD_S : positionS;
  return Math.max(0, start);
}

/**
 * Where the song is now if it had kept playing since "Continue here" was tapped: the clock to line up with once
 * the other app has stopped (Android's audio focus usually pauses it the moment ours starts).
 */
export function expectedPositionS(positionS: number, playing: boolean, elapsedS: number): number {
  return Math.max(0, playing ? positionS + Math.max(0, elapsedS) : positionS);
}

/**
 * Where to seek our player so it matches the other app, or null when it is close enough (or the other app's
 * position is unknown). The other app is paused right after, so its position now is where ours should be.
 */
export function driftSeekS(outsideS: number | null, ourS: number): number | null {
  if (outsideS === null || !Number.isFinite(outsideS) || !Number.isFinite(ourS)) {
    return null;
  }
  return Math.abs(outsideS - ourS) > DRIFT_TOLERANCE_S ? Math.max(0, outsideS) : null;
}
