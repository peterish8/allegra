/**
 * Where a song picked on this phone plays. While another of the listener's devices is playing,
 * a pick goes there (Spotify's rule, PLAN.md §1), whatever kind of song it is:
 *
 *   - a song the phone can already name (`saavn:<id>`): sent at once;
 *   - an older download with no recorded origin: looked up in the catalog first (and remembered),
 *     while the mini player says it is on its way;
 *   - a song only this phone has: the listener is asked before playback moves here.
 *
 * It used to forward only the first kind and let the rest play here, which made the phone take
 * playback from the laptop it was controlling. The rest of the list follows the song: the songs
 * that are named at once go with it, the ones found later are added behind them.
 *
 * Plain functions over injected parts, so the rules run in Jest without React or a device.
 */
import type { SongRef, SongSnapshot } from '@shared/songRef';
import {
  decidePlaybackRoute,
  QUEUE_EDIT_PROTOCOL_VERSION,
  ROUTE_READY_WAIT_MS,
  whenRouteReady,
  type ConnectSession,
  type PlaybackRoute,
} from '../../../../../packages/connect/src/index';
import type { Song } from '../../types/song';

/** The list a song was picked from: its songs in order, and the one that was tapped. */
export interface Pick {
  readonly playlistId: string;
  readonly songs: readonly Song[];
  readonly startIndex: number;
}

/** What the mini player shows while a pick is looked up for another device. */
export interface PendingPick {
  readonly title: string;
  readonly deviceName: string;
}

interface Timers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PickRouterDeps {
  /** The live Connect session and this phone's device id, or null when Connect is off. */
  readonly connect: () => { readonly session: ConnectSession; readonly deviceId: string } | null;
  /** A Listen Together room owns playback here: every pick stays on this phone. */
  readonly heldLocally: () => boolean;
  /** The ref the phone already knows for a song, without a lookup. */
  readonly knownRef: (song: Song) => SongRef | null;
  /** Finds the song in the catalog (and remembers it). Null when it is not there or out of reach. */
  readonly findRef: (song: Song) => Promise<SongRef | null>;
  readonly snapshotFor: (song: Song, ref: SongRef) => SongSnapshot;
  /** Plays the pick on this phone, past the router. */
  readonly playHere: (pick: Pick) => void;
  readonly onPending: (pending: PendingPick | null) => void;
  /** The device that was playing is offline, so the pick plays here. */
  readonly onOwnerOffline: (deviceName: string) => void;
  /** Only this phone has the song: ask before playback moves here. */
  readonly onOnlyHere: (pick: Pick, deviceName: string) => void;
  /** Songs of the list that only this phone has were left out of the other device's queue. */
  readonly onLeftOut: (count: number, deviceName: string) => void;
  readonly timers: Timers;
  readonly now?: () => number;
  readonly lookupTimeoutMs?: number;
  readonly readyWaitMs?: number;
}

export interface PickRouter {
  /**
   * True when the router has taken the pick: it plays on another device, or will once that is
   * decided. False: play it on this phone now.
   */
  route(pick: Pick): boolean;
  dispose(): void;
}

/** A catalog lookup longer than this is treated as not found (the listener is then asked). */
const LOOKUP_TIMEOUT_MS = 6_000;
/** A `play_song` queue and a `queue_add`'s `more` hold at most this many (docs/connect-contract.md). */
const QUEUE_LIMIT = 50;
const MORE_LIMIT = 49;
const LOOKUPS_AT_ONCE = 2;
/** Refs found this run, so a second tap on the same old download does not look it up again. */
const FOUND_LIMIT = 500;
/**
 * After a wait for Connect ran out (the server out of reach), picks in the next half minute do not
 * wait again: they decide on what Connect last knew, so a dead connection costs one short pause,
 * not one on every tap.
 */
const UNREADY_GRACE_MS = 30_000;

function withTimeout<T>(work: Promise<T>, ms: number, timers: Timers): Promise<T | null> {
  return new Promise(resolve => {
    let done = false;
    const finish = (value: T | null): void => {
      if (done) return;
      done = true;
      timers.clearTimeout(timer);
      resolve(value);
    };
    const timer = timers.setTimeout(() => finish(null), ms);
    work.then(finish, () => finish(null));
  });
}

export function createPickRouter(deps: PickRouterDeps): PickRouter {
  const lookupTimeoutMs = deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS;
  const readyWaitMs = deps.readyWaitMs ?? ROUTE_READY_WAIT_MS;
  const now = deps.now ?? Date.now;
  /** Each pick gets the next number; work for an older one stops when it sees a newer number. */
  let latest = 0;
  let disposed = false;
  let pendingShown = false;
  let unreadyAt: number | undefined;
  const found = new Map<string, SongRef>();

  const waitedInVainLately = (): boolean => unreadyAt !== undefined && now() - unreadyAt < UNREADY_GRACE_MS;

  const current = (generation: number): boolean => !disposed && generation === latest;

  const setPending = (pending: PendingPick | null): void => {
    if (!pending && !pendingShown) return;
    pendingShown = pending !== null;
    deps.onPending(pending);
  };

  const refNow = (song: Song): SongRef | null => deps.knownRef(song) ?? found.get(song.id) ?? null;

  const lookup = async (song: Song): Promise<SongRef | null> => {
    const known = refNow(song);
    if (known) return known;
    const ref = await withTimeout(deps.findRef(song), lookupTimeoutMs, deps.timers);
    if (ref) {
      if (found.size >= FOUND_LIMIT) found.delete(found.keys().next().value as string);
      found.set(song.id, ref);
    }
    return ref;
  };

  /** Looks the songs up two at a time, in order; stops starting new lookups once a newer pick came. */
  const lookupAll = async (songs: readonly Song[], generation: number): Promise<(SongRef | null)[]> => {
    const refs: (SongRef | null)[] = new Array(songs.length).fill(null);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < songs.length && current(generation)) {
        const index = cursor++;
        const song = songs[index];
        if (song) refs[index] = await lookup(song);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOOKUPS_AT_ONCE, songs.length) }, worker));
    return refs;
  };

  const decide = (staleOk: boolean): PlaybackRoute => {
    const connect = deps.connect();
    return decidePlaybackRoute({
      view: connect?.session.view() ?? null,
      deviceId: connect?.deviceId ?? null,
      heldLocally: deps.heldLocally(),
      staleOk,
    });
  };

  /** Plays here, telling the listener why when the device that was playing went quiet. */
  const playHere = (pick: Pick, decision: PlaybackRoute): void => {
    if (decision.kind === 'local_owner_offline') deps.onOwnerOffline(decision.deviceName);
    deps.playHere(pick);
  };

  async function send(pick: Pick, target: Extract<PlaybackRoute, { kind: 'remote' }>, generation: number): Promise<void> {
    const selected = pick.songs[pick.startIndex];
    if (!selected) return;
    let ref = refNow(selected);
    if (!ref) {
      setPending({ title: selected.title, deviceName: target.deviceName });
      ref = await lookup(selected);
      if (!current(generation)) return;
      setPending(null);
      if (!ref) {
        deps.onOnlyHere(pick, target.deviceName);
        return;
      }
    }
    // A lookup takes a moment: the device that plays may have changed, or gone, meanwhile.
    const latestRoute = decide(true);
    const connect = deps.connect();
    if (latestRoute.kind !== 'remote' || !connect) {
      playHere(pick, latestRoute);
      return;
    }
    const following = pick.songs.slice(pick.startIndex + 1, pick.startIndex + 1 + QUEUE_LIMIT);
    const queue: SongSnapshot[] = [];
    const missing: Song[] = [];
    for (const song of following) {
      const known = refNow(song);
      if (known) queue.push(deps.snapshotFor(song, known));
      else missing.push(song);
    }
    connect.session.control({ kind: 'play_song', song: deps.snapshotFor(selected, ref), queue });
    if (missing.length === 0) return;

    // An app before queue edits reads an add with `more` as one song: it gets no late songs.
    const protocol = connect.session.view().activeDevice?.protocolVersion ?? 1;
    if (protocol < QUEUE_EDIT_PROTOCOL_VERSION) {
      deps.onLeftOut(missing.length, latestRoute.deviceName);
      return;
    }
    const refs = await lookupAll(missing, generation);
    if (!current(generation)) return;
    const late = refs.flatMap((lateRef, index) => {
      const song = missing[index];
      return lateRef && song ? [deps.snapshotFor(song, lateRef)] : [];
    });
    const [head, ...more] = late;
    if (head) {
      deps.connect()?.session.control({ kind: 'queue_add', song: head, ...(more.length ? { more: more.slice(0, MORE_LIMIT) } : {}) });
    }
    const lost = missing.length - late.length;
    if (lost > 0) deps.onLeftOut(lost, latestRoute.deviceName);
  }

  async function settle(pick: Pick, first: PlaybackRoute, generation: number): Promise<void> {
    let decision = first;
    if (decision.kind === 'wait') {
      const connect = deps.connect();
      if (connect) {
        await whenRouteReady(connect.session, deps.timers, readyWaitMs);
        if (!connect.session.view().ready) unreadyAt = now();
      }
      if (!current(generation)) return;
      decision = decide(true);
    }
    if (decision.kind === 'remote') await send(pick, decision, generation);
    else playHere(pick, decision);
  }

  return {
    route(pick) {
      if (disposed) return false;
      // Any newer pick, here or elsewhere, ends what an older one was still doing.
      const generation = ++latest;
      setPending(null);
      if (!pick.songs[pick.startIndex]) return false;
      let decision = decide(false);
      if (decision.kind === 'wait' && waitedInVainLately()) decision = decide(true);
      if (decision.kind === 'local') return false;
      if (decision.kind === 'local_owner_offline') {
        deps.onOwnerOffline(decision.deviceName);
        return false;
      }
      settle(pick, decision, generation).catch(() => {
        if (current(generation)) setPending(null);
      });
      return true;
    },
    dispose() {
      disposed = true;
      latest++;
      setPending(null);
      found.clear();
    },
  };
}
