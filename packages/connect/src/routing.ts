import type { ConnectView } from './types.ts';

/**
 * Where a playback action made on this device goes: a song picked, play, pause, next.
 *
 * Spotify's rule, and this project's (PLAN.md §1): while another of the listener's devices is
 * playing, a pick or a control made here goes to that device. This device makes sound itself only
 * when the listener chooses it: the device list, or "Play on this phone" when the other device
 * cannot play the song. Never as a side effect of browsing.
 */
export type PlaybackRoute =
  /** This device plays: nothing else is playing, it is already this device, or Connect is off. */
  | { readonly kind: 'local' }
  /** Another device plays and is online: send the action there. */
  | { readonly kind: 'remote'; readonly deviceId: string; readonly deviceName: string }
  /** Another device was playing but is offline: play here, and say why. */
  | { readonly kind: 'local_owner_offline'; readonly deviceName: string }
  /** Connect has not heard from the server since it started listening: wait for it, then decide. */
  | { readonly kind: 'wait' };

export interface PlaybackRouteInput {
  readonly view: ConnectView | null;
  /** This device's Connect id, or null without a session. */
  readonly deviceId: string | null;
  /** Something else owns playback here (a Listen Together room): everything stays on this device. */
  readonly heldLocally?: boolean;
  /**
   * Decide on the view as it is, even if it is not fresh: the wait for a fresh one is over (the
   * server is unreachable, so nothing could be sent anyway).
   */
  readonly staleOk?: boolean;
}

const LOCAL: PlaybackRoute = { kind: 'local' };
const WAIT: PlaybackRoute = { kind: 'wait' };

/** How long a pick waits for a fresh Connect state before deciding on the one it has. */
export const ROUTE_READY_WAIT_MS = 1_500;

export function decidePlaybackRoute({ view, deviceId, heldLocally = false, staleOk = false }: PlaybackRouteInput): PlaybackRoute {
  if (heldLocally || !view || !deviceId) return LOCAL;
  // A phone just opened (or back from the background) may still hold the state from before it
  // left, in which it was the one playing: deciding on that would start it and silence the device
  // that is really playing.
  if (!view.ready && !staleOk) return WAIT;
  const active = view.activeDeviceId;
  if (!active || active === deviceId) return LOCAL;
  const deviceName = view.activeDevice?.name ?? 'your other device';
  if (!view.activeDeviceOnline) return { kind: 'local_owner_offline', deviceName };
  return { kind: 'remote', deviceId: active, deviceName };
}

/** Another of the listener's devices plays and is online, so this one is a remote control. */
export function isControllingAnotherDevice(view: ConnectView | null, deviceId: string | null): boolean {
  return Boolean(view?.activeDeviceId && deviceId && view.activeDeviceId !== deviceId && view.activeDeviceOnline);
}

/** The words for a pick that played here because the device that was playing is offline. */
export function ownerOfflineMessage(deviceName: string): string {
  return `${deviceName} is offline, so this plays here.`;
}

/**
 * Resolves once `view()` is ready, or after `waitMs`, whichever comes first. `subscribe` is a
 * session's: it calls its listener at once with the current view.
 */
export function whenRouteReady(
  session: { readonly view: () => ConnectView; readonly subscribe: (listener: (view: ConnectView) => void) => () => void },
  timers: { readonly setTimeout: (callback: () => void, delayMs: number) => unknown; readonly clearTimeout: (handle: unknown) => void },
  waitMs: number = ROUTE_READY_WAIT_MS
): Promise<void> {
  if (session.view().ready) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let stop: (() => void) | undefined;
    let timer: unknown;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) timers.clearTimeout(timer);
      stop?.();
      resolve();
    };
    timer = timers.setTimeout(finish, waitMs);
    stop = session.subscribe((view) => { if (view.ready) finish(); });
    // The subscription answers at once; if that answer was ready, `stop` did not exist yet.
    if (done) stop();
  });
}
