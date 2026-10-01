import assert from 'node:assert/strict';
import test from 'node:test';

import type { SongRef, SongSnapshot } from '../../shared/songRef.ts';
import { QUEUE_LIMIT } from './queueEdit.ts';
import { createQueueStager, reportable, upcomingOf, withUpcoming, type QueuePlayer } from './queueStager.ts';

interface Song {
  readonly id: string;
  /** Null for a song from a source other devices cannot find. */
  readonly ref: SongRef | null;
}

const song = (id: string): Song => ({ id, ref: `saavn:${id}` });
const snapshotOf = (item: Song): SongSnapshot | null =>
  item.ref ? { ref: item.ref, title: item.id, artist: 'Nila', artwork: '', duration: 200 } : null;
const snap = (id: string): SongSnapshot => snapshotOf(song(id)) as SongSnapshot;
const ids = (songs: readonly Song[]): string[] => songs.map((item) => item.id);
const refs = (songs: readonly SongSnapshot[]): string[] => songs.map((item) => item.ref.slice('saavn:'.length));

/** The audio player as React shows it: a write lands when the next render is flushed. */
class LaggingPlayer {
  currentSong: Song | null;
  queue: readonly Song[];
  private written: readonly Song[] | undefined;

  constructor(current: string, upcoming: readonly string[], private readonly lags = false) {
    this.currentSong = song(current);
    this.queue = [this.currentSong, ...upcoming.map(song)];
  }

  readonly state = (): QueuePlayer<Song> => ({
    currentSong: this.currentSong,
    queue: this.queue,
    replaceUpcoming: (songs) => {
      if (!this.currentSong) return;
      this.written = withUpcoming(this.written ?? this.queue, this.currentSong, songs);
      if (!this.lags) this.render();
    }
  });

  render(): void {
    if (this.written) this.queue = this.written;
    this.written = undefined;
  }

  /** The song ends and the next one starts. */
  advance(): void {
    this.render();
    const index = this.queue.findIndex((item) => item.id === this.currentSong?.id);
    this.currentSong = this.queue[index + 1] ?? null;
  }

  get upcoming(): string[] { return ids(upcomingOf(this)); }
}

function harness(player: LaggingPlayer, catalog: readonly string[] = []) {
  const lookups: string[][] = [];
  let changes = 0;
  let release: (() => void) | undefined;
  let held: Promise<void> | undefined;
  const stager = createQueueStager<Song>({
    player: player.state,
    snapshotOf,
    lookup: async (missing, isCurrent) => {
      lookups.push(refs(missing));
      if (held) await held;
      return isCurrent() ? missing.flatMap((item) => catalog.includes(item.ref) ? [song(item.ref.slice('saavn:'.length))] : []) : [];
    },
    onChange: () => { changes += 1; }
  });
  const reported = (): string[] => {
    const current = player.currentSong ? snapshotOf(player.currentSong) ?? undefined : undefined;
    return refs(stager.report(current, reportable(upcomingOf(player), snapshotOf)));
  };
  return {
    stager, lookups, reported,
    get changes() { return changes; },
    hold(): void { held = new Promise((resolve) => { release = resolve; }); },
    release(): void { release?.(); held = undefined; }
  };
}

test('the played songs stay, and a song queued again moves out of them', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(song) as [Song, Song, Song, Song];
  assert.deepEqual(ids(withUpcoming([a, b, c, d], c, [d, a, a, c])), ['b', 'c', 'd', 'a']);
  assert.deepEqual(ids(withUpcoming([a], a, [])), ['a']);
  assert.deepEqual(ids(withUpcoming([], a, [b])), ['a', 'b']);
});

test('a reorder of songs the player holds is placed at once and reported before React shows it', async () => {
  const player = new LaggingPlayer('now', ['a', 'b', 'c'], true);
  const { stager, reported, lookups } = harness(player);

  const lost = await stager.stage([snap('c'), snap('a')]);

  assert.deepEqual(lost, []);
  assert.deepEqual(lookups, []);
  // React has not rendered: the player still shows the old queue, the report already the new one.
  assert.deepEqual(player.upcoming, ['a', 'b', 'c']);
  assert.deepEqual(reported(), ['c', 'a']);
  player.render();
  assert.deepEqual(player.upcoming, ['c', 'a']);
  assert.deepEqual(reported(), ['c', 'a']);
  // From here the player's own queue is the truth: a song it adds by itself shows up.
  player.state().replaceUpcoming([song('c'), song('a'), song('radio')]);
  player.render();
  assert.deepEqual(reported(), ['c', 'a', 'radio']);
});

test('a song the player has not met is reported at once and joins when it is found', async () => {
  const player = new LaggingPlayer('now', ['a', 'b']);
  const h = harness(player, ['saavn:new']);
  h.hold();

  const staged = h.stager.stage([snap('new'), snap('a'), snap('b')]);
  assert.deepEqual(h.reported(), ['new', 'a', 'b']);
  assert.deepEqual(player.upcoming, ['a', 'b']);
  assert.deepEqual(h.lookups, [['new']]);

  h.release();
  assert.deepEqual(await staged, []);
  assert.deepEqual(player.upcoming, ['new', 'a', 'b']);
  assert.deepEqual(h.reported(), ['new', 'a', 'b']);
  assert.equal(h.changes, 1);
});

test('a song that cannot be found is named, and drops out of the report', async () => {
  const player = new LaggingPlayer('now', ['a']);
  const h = harness(player);

  const lost = await h.stager.stage([snap('a'), snap('ghost')]);

  assert.deepEqual(lost, ['saavn:ghost']);
  assert.deepEqual(player.upcoming, ['a']);
  assert.deepEqual(h.reported(), ['a']);
});

test('a song that ends during a lookup is not queued again behind itself', async () => {
  const player = new LaggingPlayer('now', ['a', 'b']);
  const h = harness(player, ['saavn:new']);
  h.hold();

  const staged = h.stager.stage([snap('a'), snap('new'), snap('b')]);
  player.advance();
  assert.equal(player.currentSong?.id, 'a');
  assert.deepEqual(h.reported(), ['new', 'b']);

  h.release();
  await staged;
  assert.deepEqual(player.upcoming, ['new', 'b']);
  assert.deepEqual(ids(player.queue), ['now', 'a', 'new', 'b']);
});

test('a newer queue replaces one still being looked up', async () => {
  const player = new LaggingPlayer('now', ['a']);
  const h = harness(player, ['saavn:slow', 'saavn:quick']);
  h.hold();
  const first = h.stager.stage([snap('slow'), snap('a')]);
  h.release();
  const second = h.stager.stage([snap('a'), snap('quick')]);

  assert.deepEqual(await first, []);
  await second;
  assert.deepEqual(player.upcoming, ['a', 'quick']);
  assert.deepEqual(h.reported(), ['a', 'quick']);
});

test('the queue a song will load with is reported from the moment it is asked for', () => {
  const player = new LaggingPlayer('old', ['x']);
  const h = harness(player);

  h.stager.expect('saavn:next', [snap('a'), snap('b')]);
  // The element still holds the old song for a moment: its own queue is reported with it.
  assert.deepEqual(h.reported(), ['x']);
  player.currentSong = song('next');
  player.queue = [player.currentSong];
  assert.deepEqual(h.reported(), ['a', 'b']);

  h.stager.reset();
  assert.deepEqual(h.reported(), []);
});

test('songs past the 50 other devices are shown survive an edit of the ones they are shown', async () => {
  const upcoming = Array.from({ length: QUEUE_LIMIT + 3 }, (_, index) => `s${index}`);
  const player = new LaggingPlayer('now', upcoming);
  const h = harness(player);
  assert.equal(h.reported().length, QUEUE_LIMIT);

  // Another device removes the first song: it knows of 50, and sends back the other 49.
  await h.stager.stage(upcoming.slice(1, QUEUE_LIMIT).map(snap));

  assert.deepEqual(player.upcoming, upcoming.slice(1));
  assert.deepEqual(h.reported(), upcoming.slice(1, QUEUE_LIMIT + 1));
});

test('a song other devices cannot find is left out of the report, not counted in the 50', () => {
  const local: Song = { id: 'local-file', ref: null };
  assert.deepEqual(refs(reportable([song('a'), local, song('b')], snapshotOf)), ['a', 'b']);
});

test('nothing is staged when nothing is playing', async () => {
  const player = new LaggingPlayer('now', ['a']);
  player.currentSong = null;
  const h = harness(player);

  assert.deepEqual(await h.stager.stage([snap('b')]), []);
  assert.deepEqual(h.lookups, []);
  assert.deepEqual(ids(player.queue), ['now', 'a']);
});
