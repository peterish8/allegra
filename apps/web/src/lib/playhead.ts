import { useSyncExternalStore } from 'react';

/**
 * The song position, outside React state. The <audio> element reports it four times a second;
 * held as state it re-rendered the whole app shell on every report. Only the few components that
 * draw the time subscribe, through `usePlayhead`.
 */
export interface Playhead {
  readonly get: () => number;
  readonly subscribe: (listener: () => void) => () => void;
}

export class PlayheadStore implements Playhead {
  private value = 0;
  private readonly listeners = new Set<() => void>();

  public readonly get = (): number => this.value;

  public readonly set = (seconds: number): void => {
    if (seconds === this.value || !Number.isFinite(seconds)) return;
    this.value = seconds;
    for (const listener of this.listeners) listener();
  };

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

const ignore = (): (() => void) => () => undefined;
const zero = (): number => 0;

/**
 * Seconds into the song. `step` rounds it down, so a label that shows whole seconds renders once a
 * second. `null` reads nothing and never re-renders, for a view showing a song that is not loaded.
 */
export function usePlayhead(playhead: Playhead, step: number | null = 0): number {
  const read = (): number => {
    const seconds = playhead.get();
    return step !== null && step > 0 ? Math.floor(seconds / step) * step : seconds;
  };
  return useSyncExternalStore(step === null ? ignore : playhead.subscribe, step === null ? zero : read, step === null ? zero : read);
}
