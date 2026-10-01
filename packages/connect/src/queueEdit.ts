import type { SongSnapshot } from '../../shared/songRef.ts';
import type { QueueEditCommand, RemoteCommand } from './types.ts';

/** The most songs a queue carries between devices. A player may hold more than it reports. */
export const QUEUE_LIMIT = 50;

export function isQueueEdit(command: RemoteCommand): command is QueueEditCommand {
  return command.kind === 'queue_add' || command.kind === 'queue_remove' ||
    command.kind === 'queue_move' || command.kind === 'queue_clear';
}

/**
 * Where the song the sender meant is now. The sender names the index it saw and the ref that was
 * there; the queue may have moved on since (a song finished, another device edited it), so the
 * ref decides and the index only picks between two copies of one song.
 */
function locate(queue: readonly SongSnapshot[], index: number, ref: string): number {
  if (queue[index]?.ref === ref) return index;
  return queue.findIndex((item) => item.ref === ref);
}

/**
 * The upcoming queue after `command`, or undefined when the song it names is no longer queued.
 * Pure: the device that plays applies it to its own queue, and a controller applies it to the
 * queue it shows while the command is on its way.
 */
export function applyQueueEdit(queue: readonly SongSnapshot[], command: QueueEditCommand): readonly SongSnapshot[] | undefined {
  switch (command.kind) {
    case 'queue_add': {
      const added = [command.song, ...(command.more ?? [])];
      return command.next ? [...added, ...queue] : [...queue, ...added];
    }
    case 'queue_remove': {
      const at = locate(queue, command.index, command.ref);
      return at < 0 ? undefined : [...queue.slice(0, at), ...queue.slice(at + 1)];
    }
    case 'queue_move': {
      const at = locate(queue, command.from, command.ref);
      if (at < 0) return undefined;
      const moved = queue[at] as SongSnapshot;
      const rest = [...queue.slice(0, at), ...queue.slice(at + 1)];
      const to = Math.max(0, Math.min(rest.length, Math.trunc(command.to)));
      return [...rest.slice(0, to), moved, ...rest.slice(to)];
    }
    case 'queue_clear':
      return [];
  }
}
