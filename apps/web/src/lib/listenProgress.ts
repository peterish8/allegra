import { LISTEN_RULES } from '@shared/listenSignal';

/** One listen as the web player follows it: seconds heard, the last playhead, and whether history has it yet. */
export interface ListenProgress {
  heard: number;
  position: number;
  inHistory: boolean;
}

export const startListen = (): ListenProgress => ({ heard: 0, position: 0, inHistory: false });

/**
 * The same song starting over from its end (repeat one, or going back to the top after hearing it out) is a new
 * listen: the song's identity doesn't change, so nothing else would tell the tracker.
 */
export function restartsListen(listen: ListenProgress, position: number, durationSec: number): boolean {
  return durationSec > 0 && listen.position >= durationSec - LISTEN_RULES.endSlackSec && position < LISTEN_RULES.endSlackSec;
}

/**
 * Moves a listen to a new playhead. Normal playback moves a little each tick; a seek jumps, and a jump is not
 * listening. Returns true exactly once: on the tick that takes the heard time past the history threshold.
 */
export function advanceListen(listen: ListenProgress, position: number): boolean {
  const step = position - listen.position;
  if (step > 0 && step <= 2) listen.heard += step;
  listen.position = position;
  if (listen.inHistory || listen.heard < LISTEN_RULES.historyAfterSec) return false;
  listen.inHistory = true;
  return true;
}
