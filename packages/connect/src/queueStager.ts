import type { SongSnapshot } from '../../shared/songRef.ts';
import { QUEUE_LIMIT } from './queueEdit.ts';

export interface QueueSong {
  readonly id: string;
}

/** The part of a platform's audio player a staged queue reads and writes. */
export interface QueuePlayer<S extends QueueSong> {
  readonly currentSong: S | null;
  readonly queue: readonly S[];
  /** Replaces what plays after the current song. May take effect a render later. */
  readonly replaceUpcoming: (songs: readonly S[]) => void;
}

export interface QueueStagerOptions<S extends QueueSong> {
  /** The player as it reads now. On the web that is React's last render, which lags a write made a moment ago. */
  readonly player: () => QueuePlayer<S>;
  /** Null for a song other devices have no way to find. */
  readonly snapshotOf: (song: S) => SongSnapshot | null;
  /** Finds songs the player has not met. Each one found must map back to the ref it was asked for. */
  readonly lookup: (missing: readonly SongSnapshot[], isCurrent: () => boolean) => Promise<readonly S[]>;
  /** A lookup finished: the queue to report has changed without the player saying so. */
  readonly onChange: () => void;
}

export interface QueueStager<S extends QueueSong> {
  /** The upcoming queue to tell other devices, given what the player itself shows. */
  report(song: SongSnapshot | undefined, playerQueue: readonly SongSnapshot[]): readonly SongSnapshot[];
  /** A song is about to load with this queue behind it: it is reported from now on. */
  expect(currentRef: string, queue: readonly SongSnapshot[]): void;
  /**
   * Hands the player a new upcoming queue. Songs it already holds move at once; a song it has
   * not met joins when its lookup lands. Until then the queue that was asked for is reported.
   * Resolves with the refs that could not be found, once every lookup has finished.
   */
  stage(wanted: readonly SongSnapshot[]): Promise<readonly string[]>;
  reset(): void;
}

/**
 * What was asked of the player, reported until the player's own queue shows it. A catalog lookup
 * takes a while and the web player's state lands a render late, and the Connect session reads
 * the queue straight after it sets one.
 */
interface QueueIntent {
  readonly currentRef: string;
  readonly queue: readonly SongSnapshot[];
  /** Every lookup has finished: `queue` is exactly what the player was handed. */
  readonly settled: boolean;
}

/** The songs after the current one, in the order they play. */
export function upcomingOf<S extends QueueSong>(player: Pick<QueuePlayer<S>, 'currentSong' | 'queue'>): readonly S[] {
  const index = player.queue.findIndex((item) => item.id === player.currentSong?.id);
  return index >= 0 ? player.queue.slice(index + 1) : player.queue;
}

/** What other devices are told about a list of songs: those they could find, 50 at most. */
export function reportable<S>(songs: readonly S[], snapshotOf: (song: S) => SongSnapshot | null): SongSnapshot[] {
  const out: SongSnapshot[] = [];
  for (const song of songs) {
    const snapshot = snapshotOf(song);
    if (snapshot) out.push(snapshot);
    if (out.length === QUEUE_LIMIT) break;
  }
  return out;
}

/**
 * The player's whole list with `songs` as what follows the current one. Songs already played
 * stay, so Previous still walks back through them. The list is walked by id, so it holds a song
 * once: one queued again leaves the played part, and a repeat within `songs` is dropped.
 */
export function withUpcoming<S extends QueueSong>(list: readonly S[], current: S, songs: readonly S[]): S[] {
  const seen = new Set([current.id]);
  const upcoming = songs.filter((song) => !seen.has(song.id) && Boolean(seen.add(song.id)));
  const index = list.findIndex((item) => item.id === current.id);
  const played = (index >= 0 ? list.slice(0, index) : []).filter((item) => !seen.has(item.id));
  return [...played, current, ...upcoming];
}

function sameRefs(left: readonly SongSnapshot[], right: readonly SongSnapshot[]): boolean {
  return left.length === right.length && left.every((item, index) => item.ref === right[index]?.ref);
}

export function createQueueStager<S extends QueueSong>(options: QueueStagerOptions<S>): QueueStager<S> {
  let generation = 0;
  let intent: QueueIntent | null = null;
  const refOf = (song: S | null): string | undefined => (song ? options.snapshotOf(song)?.ref : undefined);
  /** The songs the player would report next for `songs`, which it has just been handed. */
  const handed = (songs: readonly S[], currentId: string): SongSnapshot[] => {
    const seen = new Set([currentId]);
    return reportable(songs.filter((song) => !seen.has(song.id) && Boolean(seen.add(song.id))), options.snapshotOf);
  };

  return {
    report(song, playerQueue) {
      if (!intent || !song) return playerQueue;
      const index = song.ref === intent.currentRef ? -1 : intent.queue.findIndex((item) => item.ref === song.ref);
      if (song.ref !== intent.currentRef && index < 0) {
        // The listener picked something else here: what was asked for no longer applies. While a
        // load is still switching songs, though, the old song is expected to show for a moment.
        if (intent.settled) intent = null;
        return playerQueue;
      }
      const intended = intent.queue.slice(index + 1);
      // The player now shows what it was handed, so its own queue is the truth again.
      if (intent.settled && sameRefs(playerQueue, intended)) {
        intent = null;
        return playerQueue;
      }
      return intended;
    },

    expect(currentRef, queue) {
      generation += 1;
      intent = { currentRef, queue: queue.slice(0, QUEUE_LIMIT), settled: false };
    },

    stage(wanted) {
      const mine = ++generation;
      const start = options.player();
      const currentRef = refOf(start.currentSong);
      if (!currentRef) return Promise.resolve([]);
      const list = wanted.filter((item) => item.ref !== currentRef);
      const known = new Map<string, S>();
      for (const item of start.queue) {
        const ref = refOf(item);
        if (ref && !known.has(ref)) known.set(ref, item);
      }
      // Other devices see 50 songs. Whatever the player holds beyond those is not theirs to lose.
      const before = upcomingOf(start);
      let shown = 0;
      const cut = before.findIndex((song) => options.snapshotOf(song) !== null && ++shown === QUEUE_LIMIT);
      const tail = cut >= 0 ? before.slice(cut + 1) : [];

      const place = (final: boolean): void => {
        const live = options.player();
        const now = refOf(live.currentSong);
        // The song may have ended while a lookup ran: only what is still ahead of it is queued.
        const at = now === currentRef ? -1 : list.findIndex((item) => item.ref === now);
        if (!live.currentSong || !now || (now !== currentRef && at < 0)) {
          if (final) intent = null;
          return;
        }
        const songs = [...list.slice(at + 1).flatMap((item) => known.get(item.ref) ?? []), ...tail];
        live.replaceUpcoming(songs);
        intent = final
          ? { currentRef: now, queue: handed(songs, live.currentSong.id), settled: true }
          : { currentRef, queue: list.slice(0, QUEUE_LIMIT), settled: false };
      };

      const missing = list.filter((item) => !known.has(item.ref));
      place(missing.length === 0);
      if (missing.length === 0) return Promise.resolve([]);
      return options.lookup(missing, () => mine === generation).catch(() => [] as readonly S[]).then((found) => {
        // A newer queue replaced this one: what became of these songs is no longer the question.
        if (mine !== generation) return [];
        for (const song of found) {
          const ref = refOf(song);
          if (ref && !known.has(ref)) known.set(ref, song);
        }
        place(true);
        options.onChange();
        return missing.filter((item) => !known.has(item.ref)).map((item) => item.ref);
      });
    },

    reset() {
      generation += 1;
      intent = null;
    }
  };
}
