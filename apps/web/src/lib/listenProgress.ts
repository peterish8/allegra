import { LISTEN_RULES } from '@shared/listenSignal';

/** One listen as the web player follows it: seconds heard, the last playhead, and whether history has it yet. */
export interface ListenProgress {
  heard: number;
  position: number;
  inHistory: boolean;
}

export const startListen = (): ListenProgress => ({ heard: 0, position: 0, inHistory: false });

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
