import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '@shared/types';
import { SongRadio, type RadioSources, type RadioTransport } from './songRadio.ts';

function song(id: string, artist = `Artist ${id}`): UnifiedSong {
  return { id, title: `Song ${id}`, artist, language: 'tamil', streamUrl: `/api/stream/${id}`, artwork: '', duration: 180, hasLyrics: true, playCount: 0, source: 'Saavn' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
function setup(sources: RadioSources, seed = song('seed')) {
  const queued = { current: new Set<string>() };
  const player: RadioTransport & { currentSong: UnifiedSong; queue: UnifiedSong[]; repeat: 'off' | 'all' | 'one' } = {
    currentSong: seed, queue: [seed], repeat: 'off',
    replaceUpcoming(songs) {
      const at = this.queue.findIndex((entry) => entry.id === this.currentSong.id);
      this.queue = [...this.queue.slice(0, at + 1), ...songs];
    }
  };
  const radio = new SongRadio({ current: player }, sources);
  return { radio, player, queued, seed };
}
const emptyPool: RadioSources['pool'] = async () => ({ candidates: [], taste: null });

test('Late catalog suggestions update the queue even when the radio pool answered first', async () => {
  const late = deferred<UnifiedSong[]>();
  const { radio, player, seed } = setup({ suggestions: () => late.promise, pool: async () => ({ candidates: [{ song: song('pool'), source: 'artist' }], taste: null }) });
  radio.start(seed);
  await tick();
  assert.ok(player.queue.some((entry) => entry.id === 'pool'));
  late.resolve([song('late')]);
  await tick();
  assert.ok(player.queue.some((entry) => entry.id === 'late'));
});

test('Every new song refreshes a full radio queue and keeps manually queued songs first', async () => {
  const calls: string[] = [];
  const { radio, player, queued, seed } = setup({ suggestions: async (id) => {
    calls.push(id);
    return Array.from({ length: 16 }, (_, i) => song(`${id}-${i}`));
  }, pool: emptyPool });
  radio.start(seed);
  await tick();
  const next = player.queue[1]!;
  const mine = song('mine');
  queued.current.add(mine.id);
  player.queue.splice(2, 0, mine);
  player.currentSong = next;
  radio.outcome(seed, 'finished');
  radio.started(next);
  await radio.fill();
  await tick();
  assert.ok(calls.includes(next.id));
  const at = player.queue.findIndex((entry) => entry.id === next.id);
  assert.equal(player.queue[at + 1]?.id, mine.id);
  assert.equal(new Set(player.queue.map((entry) => entry.id)).size, player.queue.length);
  assert.ok(player.queue.length - at > 3);
});

test('An old response cannot replace a newly selected song radio', async () => {
  const old = deferred<UnifiedSong[]>();
  const { radio, player, seed } = setup({ suggestions: (id) => id === 'seed' ? old.promise : Promise.resolve([song('new-pick')]), pool: emptyPool });
  radio.start(seed);
  const newer = song('new-seed');
  player.currentSong = newer;
  player.queue = [newer];
  radio.start(newer);
  await tick();
  old.resolve([song('stale')]);
  await tick();
  assert.ok(!player.queue.some((entry) => entry.id === 'stale'));
  assert.ok(player.queue.some((entry) => entry.id === 'new-pick'));
});

test('Stopping the radio discards in-flight answers and aborts providers', async () => {
  const late = deferred<UnifiedSong[]>();
  let signal: AbortSignal | undefined;
  const { radio, player, seed } = setup({ suggestions: (_id, abort) => { signal = abort; return late.promise; }, pool: emptyPool });
  radio.start(seed);
  radio.stop();
  late.resolve([song('stale')]);
  await tick();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(player.queue.map((entry) => entry.id), ['seed']);
});

test('Album order stays intact while related radio songs follow its end', async () => {
  const { radio, player, seed } = setup({ suggestions: async () => [song('related')], pool: emptyPool });
  const album = [seed, song('album-two'), song('album-three')];
  player.queue = [...album];
  radio.start(seed, album);
  await tick();
  assert.deepEqual(player.queue.slice(0, 3), album);
  assert.equal(player.queue[3]?.id, 'related');
});

test('Provider failures keep the playable tail and can be retried', async () => {
  let failed = true;
  const { radio, player, seed } = setup({ suggestions: async () => { if (failed) throw new Error('offline'); return [song('recovered')]; }, pool: emptyPool });
  player.queue.push(song('ready'));
  radio.start(seed);
  await tick();
  assert.equal(player.queue[1]?.id, 'ready');
  failed = false;
  await radio.fill();
  assert.ok(player.queue.some((entry) => entry.id === 'recovered'));
});

test('Radio keeps finding fresh related songs across twenty advances without repeating played songs', async () => {
  const { radio, player, seed } = setup({ suggestions: async (id) => Array.from({ length: 14 }, (_, i) => song(`${id}-${i}`)), pool: emptyPool });
  radio.start(seed);
  await tick();
  const played = new Set([seed.id]);
  for (let i = 0; i < 20; i += 1) {
    const at = player.queue.findIndex((entry) => entry.id === player.currentSong.id);
    const next = player.queue[at + 1];
    assert.ok(next, `Advance ${i} has a next song`);
    assert.ok(!played.has(next.id));
    radio.outcome(player.currentSong, 'finished');
    player.currentSong = next;
    played.add(next.id);
    radio.started(next);
    await radio.fill();
    await tick();
    const index = player.queue.findIndex((entry) => entry.id === next.id);
    assert.ok(player.queue.length - index - 1 >= 3);
  }
});

test('A queue handed over by Connect stays ahead of the radio that continues it', async () => {
  const { radio, player, seed } = setup({ suggestions: async () => [song('related')], pool: emptyPool });
  player.queue = [seed, song('sent-one'), song('sent-two')];
  await radio.fill();
  assert.deepEqual(player.queue.map((entry) => entry.id), ['seed', 'sent-one', 'sent-two', 'related']);
});

test('Songs added after radio picks are never re-ranked away', async () => {
  const { radio, player, seed } = setup({ suggestions: async () => [song('a'), song('b')], pool: emptyPool });
  radio.start(seed);
  await tick();
  player.queue.push(song('remote-add'));
  radio.love(seed);
  await tick();
  assert.ok(player.queue.some((entry) => entry.id === 'remote-add'));
  assert.equal(player.queue[1]?.id, 'remote-add');
});

test('Repeat all on an album loops the album instead of continuing into radio', async () => {
  const { radio, player, seed } = setup({ suggestions: async () => [song('related')], pool: emptyPool });
  const album = [seed, song('album-two')];
  player.queue = [...album];
  player.repeat = 'all';
  radio.start(seed, album);
  await tick();
  assert.deepEqual(player.queue.map((entry) => entry.id), ['seed', 'album-two']);
  player.repeat = 'off';
  radio.started(seed);
  assert.equal(player.queue[2]?.id, 'related');
});

test('A song whose related list is already known is not fetched again', async () => {
  let calls = 0;
  const { radio, seed } = setup({ suggestions: async () => { calls += 1; return [song('same')]; }, pool: emptyPool });
  radio.start(seed);
  await tick();
  await radio.fill();
  await radio.fill();
  assert.equal(calls, 2 /* the seed, then one walk to 'same' */);
});

test('Rapid overlapping fills share provider requests and never append an old queue snapshot', async () => {
  const pending = deferred<UnifiedSong[]>();
  let calls = 0;
  const { radio, player, seed } = setup({ suggestions: () => { calls += 1; return pending.promise; }, pool: emptyPool });
  radio.start(seed);
  const first = radio.fill();
  const second = radio.fill();
  player.currentSong = song('changed');
  player.queue = [player.currentSong, song('keep')];
  pending.resolve([song('old')]);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(player.queue.map((entry) => entry.id), ['changed', 'keep']);
});
