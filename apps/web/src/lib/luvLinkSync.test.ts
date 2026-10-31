import assert from 'node:assert/strict';
import test from 'node:test';
import type { LuvLinkPlaybackAnchor } from '@shared/luvLink';
import { waitForAudioMetadata, waitForAudioReady, waitForAudioSource } from '../components/luvLink/audioReady';
import {
  isRetryableLuvLinkError, liveRoomPosition, needsSeek, planAnchorApplication, readableLuvLinkError, retryLuvLink, startDelayMs,
} from '../components/luvLink/sync';

const song = { ref: 'saavn:a', title: 'A', artist: 'Artist', artwork: '', duration: 200 };

function anchor(overrides: Partial<LuvLinkPlaybackAnchor> = {}): LuvLinkPlaybackAnchor {
  return {
    roomId: 'room-1', leaderUserId: 'host', leaderEpoch: 1, sequence: 5, trackEpoch: 2, queueEntryId: null, intent: 'control',
    intentByUserId: 'host', outputAppliedSequence: 5, barrierPending: false, song, positionSec: 10, serverAtMs: 1_000_000,
    playing: true, effectiveAtMs: 1_000_000, playbackRate: 1, ...overrides,
  };
}

const plan = (overrides: Partial<Parameters<typeof planAnchorApplication>[0]> = {}) => planAnchorApplication({
  mode: 'listen', userId: 'host', leaderUserId: 'host', handoffFromUserId: null,
  anchor: { sequence: 5, intentByUserId: 'friend', outputAppliedSequence: 5 }, ownAppliedSequence: null, ...overrides,
});

test('in listen mode the leader follows a controller\'s pause or track change', () => {
  assert.deepEqual(plan(), { kind: 'apply', acknowledgeIntent: false });
});

test('in listen mode a change the leader made and already played is not applied again', () => {
  const own = { sequence: 5, intentByUserId: 'host', outputAppliedSequence: 5 };
  assert.deepEqual(plan({ anchor: own, ownAppliedSequence: 5 }), { kind: 'skip' });
  assert.deepEqual(plan({ anchor: own, ownAppliedSequence: 4 }), { kind: 'apply', acknowledgeIntent: false });
  assert.deepEqual(plan({ anchor: own, ownAppliedSequence: null }), { kind: 'apply', acknowledgeIntent: false });
});

test('a sequence applied locally never hides a different author\'s later anchor', () => {
  assert.deepEqual(plan({ anchor: { sequence: 6, intentByUserId: 'friend', outputAppliedSequence: 6 }, ownAppliedSequence: 6 }), { kind: 'apply', acknowledgeIntent: false });
});

test('in speaker mode everyone but the elected output stops, and the old output acknowledges the handoff', () => {
  assert.deepEqual(plan({ mode: 'speaker', userId: 'friend', leaderUserId: 'host' }), { kind: 'stop-output', acknowledgeHandoff: false });
  assert.deepEqual(plan({ mode: 'speaker', userId: 'friend', leaderUserId: 'host', handoffFromUserId: 'friend' }), { kind: 'stop-output', acknowledgeHandoff: true });
});

test('the new speaker waits for the old one, then applies controller intents and acknowledges them', () => {
  assert.deepEqual(plan({ mode: 'speaker', handoffFromUserId: 'friend' }), { kind: 'wait' });
  assert.deepEqual(plan({ mode: 'speaker', anchor: { sequence: 6, intentByUserId: 'friend', outputAppliedSequence: 5 } }), { kind: 'apply', acknowledgeIntent: true });
  assert.deepEqual(plan({ mode: 'speaker', anchor: { sequence: 6, intentByUserId: 'host', outputAppliedSequence: 6 } }), { kind: 'skip' });
});

test('a pause publishes where the room is now, not where it was when the last anchor arrived', () => {
  const playing = anchor({ positionSec: 10, effectiveAtMs: 1_000_000 });
  const thirtySecondsLater = 1_030_000;
  assert.equal(liveRoomPosition(playing, thirtySecondsLater, 0, null), 40);
});

test('the playhead this listener hears wins while the room plays its song', () => {
  const playing = anchor();
  const local = { songRef: 'saavn:a', currentTime: 41.2, loaded: true, playing: true };
  assert.equal(liveRoomPosition(playing, 1_030_000, 0, local), 41.2);
  assert.equal(liveRoomPosition(playing, 1_030_000, 0, { ...local, songRef: 'saavn:b' }), 40);
  assert.equal(liveRoomPosition(playing, 1_030_000, 0, { ...local, playing: false }), 40);
  assert.equal(liveRoomPosition(playing, 1_030_000, 0, { ...local, loaded: false }), 40);
});

test('a paused room reports its exact paused position, whatever this device shows', () => {
  const paused = anchor({ playing: false, positionSec: 73.5 });
  assert.equal(liveRoomPosition(paused, 9_000_000, 0, { songRef: 'saavn:a', currentTime: 12, loaded: true, playing: true }), 73.5);
});

test('the live position stays inside the song and empty rooms report zero', () => {
  assert.equal(liveRoomPosition(anchor(), 1_000_000 + 900_000, 0, null), 200);
  assert.equal(liveRoomPosition(anchor({ song: null }), 1_000_000, 0, null), 0);
  assert.equal(liveRoomPosition(null, 1_000_000, 0, null), 0);
  assert.equal(liveRoomPosition(anchor(), 1_030_000, 0, { songRef: 'saavn:a', currentTime: -3, loaded: true, playing: true }), 0);
});

test('a play stamped slightly ahead is waited for, within a cap', () => {
  assert.equal(startDelayMs({ playing: true, effectiveAtMs: 10_500 }, 10_000, 0), 500);
  assert.equal(startDelayMs({ playing: true, effectiveAtMs: 10_500 }, 10_000, 200), 300);
  assert.equal(startDelayMs({ playing: true, effectiveAtMs: 9_000 }, 10_000, 0), 0);
  assert.equal(startDelayMs({ playing: true, effectiveAtMs: 10_010 }, 10_000, 0), 0);
  assert.equal(startDelayMs({ playing: true, effectiveAtMs: 60_000 }, 10_000, 0), 1_500);
  assert.equal(startDelayMs({ playing: false, effectiveAtMs: 10_500 }, 10_000, 0), 0);
});

test('a seek is skipped while the player is within drift of the room', () => {
  assert.equal(needsSeek(30.3, 30, true), false);
  assert.equal(needsSeek(30.9, 30, true), true);
  assert.equal(needsSeek(30.2, 30, false), false);
  assert.equal(needsSeek(30.4, 30, false), true);
  assert.equal(needsSeek(Number.NaN, 30, true), true);
});

test('server refusals are final and transport failures are retried', () => {
  assert.equal(isRetryableLuvLinkError({ data: { code: 'stale_sequence', message: 'x' } }), false);
  assert.equal(isRetryableLuvLinkError({ data: { code: 'rate_limited', message: 'x' } }), true);
  assert.equal(isRetryableLuvLinkError(new Error('Connection lost')), true);
  assert.equal(isRetryableLuvLinkError(null), true);
});

test('a mutation is repeated after a transport failure, with growing waits', async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await retryLuvLink(async () => {
    calls += 1;
    if (calls < 3) throw new Error('offline');
    return 'ok';
  }, { sleep: async ms => { waits.push(ms); } });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [400, 1_000]);
});

test('a server refusal is not repeated', async () => {
  let calls = 0;
  await assert.rejects(retryLuvLink(async () => { calls += 1; throw { data: { code: 'stale_track', message: 'old' } }; }, { sleep: async () => undefined }));
  assert.equal(calls, 1);
});

test('retries stop with the last error when the attempts run out or the work no longer matters', async () => {
  let calls = 0;
  await assert.rejects(retryLuvLink(async () => { calls += 1; throw new Error('offline'); }, { delaysMs: [1, 1], sleep: async () => undefined }), /offline/);
  assert.equal(calls, 3);
  let current = true;
  calls = 0;
  await assert.rejects(retryLuvLink(async () => { calls += 1; current = false; throw new Error('offline'); }, { sleep: async () => undefined, isCurrent: () => current }), /offline/);
  assert.equal(calls, 1);
});

test('user-facing text comes from the server message when there is one', () => {
  assert.equal(readableLuvLinkError({ data: { code: 'x', message: 'Room is full.' } }), 'Room is full.');
  assert.equal(readableLuvLinkError(new Error('boom')), 'boom');
  assert.equal(readableLuvLinkError(7), 'That did not work. Try again.');
});

class FakeAudio extends EventTarget {
  readyState = 0;
  networkState = 1;
  error: unknown = null;
  preload = 'metadata';
  loads = 0;
  private attributes = new Map<string, string>();
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setSrc(value: string): void { this.attributes.set('src', value); }
  load(): void { this.loads += 1; }
  asElement(): HTMLMediaElement { return this as unknown as HTMLMediaElement; }
}

test('a track is ready only once it can play, and the preload hint is put back', async () => {
  const audio = new FakeAudio();
  const ready = waitForAudioReady(audio.asElement(), 1_000);
  assert.equal(audio.preload, 'auto');
  audio.readyState = 4;
  audio.dispatchEvent(new Event('canplay'));
  assert.equal(await ready, true);
  assert.equal(audio.preload, 'metadata');
});

test('readiness is immediate for a loaded track and refused for a failed one', async () => {
  const loaded = new FakeAudio();
  loaded.readyState = 4;
  assert.equal(await waitForAudioReady(loaded.asElement(), 10), true);
  const failed = new FakeAudio();
  failed.error = new Error('decode');
  assert.equal(await waitForAudioReady(failed.asElement(), 10), false);
  const errors = new FakeAudio();
  const pending = waitForAudioReady(errors.asElement(), 1_000);
  errors.error = new Error('network');
  errors.dispatchEvent(new Event('error'));
  assert.equal(await pending, false);
});

test('at the deadline metadata alone and an empty track are not ready to play', async () => {
  const header = new FakeAudio();
  header.readyState = 1;
  assert.equal(await waitForAudioReady(header.asElement(), 15), false);
  const empty = new FakeAudio();
  assert.equal(await waitForAudioReady(empty.asElement(), 15), false);
  assert.equal(empty.preload, 'metadata');
});

test('a seek waits for the new stream and then for its metadata', async () => {
  const audio = new FakeAudio();
  audio.setSrc('/api/stream/old');
  const source = waitForAudioSource(audio.asElement(), '/api/stream/new', 1_000);
  audio.setSrc('/api/stream/new');
  audio.dispatchEvent(new Event('loadstart'));
  assert.equal(await source, true);
  const metadata = waitForAudioMetadata(audio.asElement(), 1_000);
  audio.readyState = 1;
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await metadata, true);
  assert.equal(await waitForAudioSource(new FakeAudio().asElement(), '/never', 15), false);
  assert.equal(await waitForAudioMetadata(new FakeAudio().asElement(), 15), false);
});
