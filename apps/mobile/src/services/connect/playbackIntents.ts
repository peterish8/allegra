/**
 * Playback actions made on this phone away from its own player screens (voice, the home-screen
 * widget) go where the music is, as a pick in a list does (pickRouter): to the device that plays
 * when it is another one, to this phone's player otherwise. The player screens need none of this:
 * while another device plays they are the remote player, which already sends everything there.
 *
 * ConnectProvider binds the live session here while the listener is signed in. Unbound (signed
 * out, Connect off), every action simply runs on this phone.
 */
import type { SongSnapshot } from '@shared/songRef';
import {
  decidePlaybackRoute,
  ROUTE_READY_WAIT_MS,
  whenRouteReady,
  type ConnectSession,
  type PlaybackRoute,
  type RemoteCommand,
} from '../../../../../packages/connect/src/index';
import type { Pick } from './pickRouter';

export interface PlaybackIntentBinding {
  readonly session: ConnectSession;
  readonly deviceId: string;
  /** A Listen Together room owns playback here. */
  readonly heldLocally: () => boolean;
  /** The pick router: true when it took the pick (it plays elsewhere, or will once decided). */
  readonly routePick: (pick: Pick) => boolean;
}

let binding: PlaybackIntentBinding | null = null;

export function bindPlaybackIntents(next: PlaybackIntentBinding | null): () => void {
  binding = next;
  return () => { if (binding === next) binding = null; };
}

const timers = {
  setTimeout: (callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs),
  clearTimeout: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Where an action made on this phone goes now, after waiting briefly for a fresh Connect state. */
export async function currentPlaybackRoute(): Promise<PlaybackRoute> {
  const bound = binding;
  if (!bound) return { kind: 'local' };
  const decide = (staleOk: boolean): PlaybackRoute => decidePlaybackRoute({
    view: bound.session.view(),
    deviceId: bound.deviceId,
    heldLocally: bound.heldLocally(),
    staleOk,
  });
  const first = decide(false);
  if (first.kind !== 'wait') return first;
  await whenRouteReady(bound.session, timers, ROUTE_READY_WAIT_MS);
  return decide(true);
}

/**
 * Sends `remote` to the device that plays when another one does, otherwise runs `here` on this
 * phone. Resolves with where it went. A null `remote` means the action has no meaning there.
 */
export async function actWhereMusicIs(remote: RemoteCommand | null, here: () => void): Promise<'remote' | 'here'> {
  const route = await currentPlaybackRoute();
  const bound = binding;
  if (route.kind === 'remote' && bound && remote) {
    bound.session.control(remote);
    return 'remote';
  }
  here();
  return 'here';
}

/**
 * A song picked outside a list screen (a voice result, a widget tap): true when Connect took it
 * for another device. False: play it on this phone the usual way.
 */
export function routeSongPick(pick: Pick): boolean {
  try {
    return binding?.routePick(pick) ?? false;
  } catch {
    // Keep this phone's own playback working if Connect cannot take the pick.
    return false;
  }
}

/** The song the other device plays, then its queue, while this phone is its remote; else null. */
export function remoteList(): readonly SongSnapshot[] | null {
  const bound = binding;
  if (!bound) return null;
  const view = bound.session.view();
  const route = decidePlaybackRoute({ view, deviceId: bound.deviceId, heldLocally: bound.heldLocally(), staleOk: true });
  if (route.kind !== 'remote' || !view.song) return null;
  return [view.song, ...view.queue];
}
