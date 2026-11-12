import type { ConnectView } from '../../../../packages/connect/src/index';

/**
 * True when `next` differs from `previous` only by `livePosition`, while this device is the one
 * playing.
 *
 * The Connect session builds a fresh view whenever the local player changes, which includes every
 * position report (about four a second while a song plays). Handing each one to React re-rendered
 * the whole app shell, and posting each one to the other tabs cloned the view (device list,
 * queue) four times a second. While this device plays nothing on screen reads `livePosition` from
 * the view (the local playhead is its own store, and other tabs get a position message once a
 * second), so those views carry no news.
 */
export function onlyPositionMoved(previous: ConnectView | null, next: ConnectView): boolean {
  if (!previous || !previous.isThisDeviceActive || !next.isThisDeviceActive || !previous.isPlaying || !next.isPlaying) return false;
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === 'livePosition') continue;
    if (before[key] !== after[key]) return false;
  }
  return true;
}
