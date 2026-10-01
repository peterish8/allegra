import type { RemoteCommand } from './types.ts';

/** What the queue needs to know about an unsent input to order and coalesce it. */
export interface QueuedIntent {
  command: RemoteCommand;
  readonly targetDeviceId: string;
  /** The ownership epoch the input was made against. */
  readonly epoch: number;
  /** A transfer: nothing is merged into it or across it. */
  readonly barrier: boolean;
}

export type OfferResult<T> =
  | { readonly status: 'queued' }
  /** The input replaced the value of `into`, which keeps its place and identity. */
  | { readonly status: 'coalesced'; readonly into: T }
  | { readonly status: 'overflow' };

export interface IntentQueue<T extends QueuedIntent> {
  readonly size: number;
  offer(intent: T): OfferResult<T>;
  shift(): T | undefined;
  remove(intent: T): boolean;
  /** Removes and returns every intent the predicate matches, oldest first. */
  removeWhere(predicate: (intent: T) => boolean): T[];
  items(): readonly T[];
}

/**
 * Inputs that have not been transmitted yet, in the order they were made. Only a `seek` or
 * `volume` directly behind another unsent one of the same kind, target and epoch is merged
 * into it: `seek, next, seek` stays three commands. A full queue refuses the input rather
 * than dropping an older one.
 */
export function createIntentQueue<T extends QueuedIntent>(capacity: number): IntentQueue<T> {
  const held: T[] = [];

  return {
    get size() {
      return held.length;
    },
    offer(intent) {
      const tail = held[held.length - 1];
      if (tail && canCoalesce(tail, intent)) {
        tail.command = intent.command;
        return { status: 'coalesced', into: tail };
      }
      if (held.length >= capacity) return { status: 'overflow' };
      held.push(intent);
      return { status: 'queued' };
    },
    shift() {
      return held.shift();
    },
    remove(intent) {
      const index = held.indexOf(intent);
      if (index < 0) return false;
      held.splice(index, 1);
      return true;
    },
    removeWhere(predicate) {
      const removed: T[] = [];
      for (let index = 0; index < held.length;) {
        const intent = held[index] as T;
        if (predicate(intent)) {
          removed.push(intent);
          held.splice(index, 1);
        } else index++;
      }
      return removed;
    },
    items() {
      return held;
    }
  };
}

function canCoalesce(tail: QueuedIntent, next: QueuedIntent): boolean {
  if (tail.barrier || next.barrier) return false;
  if (next.command.kind !== 'seek' && next.command.kind !== 'volume') return false;
  return tail.command.kind === next.command.kind &&
    tail.targetDeviceId === next.targetDeviceId &&
    tail.epoch === next.epoch;
}
