import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectSession } from './connectSession.ts';
import { MemoryTransport } from './memoryTransport.ts';
import { FakePlayerPort } from './testing.ts';
import type { Clock, ConnectPlayerState, DeviceRegistration, PlayerPort } from './types.ts';
import type { SongSnapshot } from '../../shared/songRef.ts';

const song: SongSnapshot = {
  ref: 'saavn:track-1',
  title: 'Blue Hour',
  artist: 'Nila',
  artwork: 'https://images.example/blue-hour.jpg',
  duration: 212
};
const nextSong: SongSnapshot = {
  ref: 'gaana:track-2',
  title: 'Monsoon Window',
  artist: 'Ravi',
  artwork: 'https://images.example/monsoon-window.jpg',
  duration: 198
};

class TestClock implements Clock {
  private value = 50_000;
  private id = 0;
  private readonly timers = new Map<number, { readonly callback: () => void; readonly dueAt: number; readonly intervalMs?: number }>();

  now(): number { return this.value; }
  setTimeout(callback: () => void, delayMs = 0): number {
    const id = ++this.id;
    this.timers.set(id, { callback, dueAt: this.value + delayMs });
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  setInterval(callback: () => void, intervalMs: number): number {
    const id = ++this.id;
    this.timers.set(id, { callback, dueAt: this.value + intervalMs, intervalMs });
    return id;
  }
  clearInterval(handle: unknown): void { this.timers.delete(handle as number); }
  get timerCount(): number { return this.timers.size; }
  advance(ms: number): void {
    this.value += ms;
    for (let fired = 0; fired < 1_000; fired++) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.value)
        .sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
      if (!next) return;
      const [id, timer] = next;
      if (timer.intervalMs) this.timers.set(id, { ...timer, dueAt: timer.dueAt + timer.intervalMs });
      else this.timers.delete(id);
      timer.callback();
    }
    throw new Error('Test clock exceeded its timer execution limit');
  }
}

class DuplicateDeliveryTransport extends MemoryTransport {
  override watch(deviceId: string, listener: Parameters<MemoryTransport['watch']>[1]): () => void {
    return super.watch(deviceId, (snapshot) => {
      listener(snapshot);
      listener(snapshot);
    });
  }
}

class RetryAckTransport extends MemoryTransport {
  ackAttempts = 0;

  override async ack(...args: Parameters<MemoryTransport['ack']>): Promise<ReturnType<MemoryTransport['ack']> extends Promise<infer T> ? T : never> {
    this.ackAttempts++;
    if (this.ackAttempts === 1) throw new Error('network offline');
    return super.ack(...args);
  }
}

class ReportInspectTransport extends MemoryTransport {
  readonly patches: Array<import('./types.ts').PlayerStatePatch> = [];

  override async report(...args: Parameters<MemoryTransport['report']>): ReturnType<MemoryTransport['report']> {
    this.patches.push(args[1]);
    return super.report(...args);
  }
}

class DeferredClaimTransport extends MemoryTransport {
  deferNextClaim = false;
  private beginClaim!: () => void;
  private releaseHeldClaim!: () => void;
  readonly claimStarted = new Promise<void>((resolve) => { this.beginClaim = resolve; });
  private readonly heldClaim = new Promise<void>((resolve) => { this.releaseHeldClaim = resolve; });

  releaseClaim(): void { this.releaseHeldClaim(); }

  override async claim(...args: Parameters<MemoryTransport['claim']>): ReturnType<MemoryTransport['claim']> {
    if (this.deferNextClaim) {
      this.deferNextClaim = false;
      this.beginClaim();
      await this.heldClaim;
    }
    return super.claim(...args);
  }
}

const device = (deviceId: string, name: string): DeviceRegistration => ({
  deviceId,
  name,
  kind: deviceId.startsWith('web') ? 'web' : 'android',
  appVersion: 'test',
  canPlay: true
});

function state(clock: TestClock, overrides: Partial<ConnectPlayerState> = {}): ConnectPlayerState {
  return {
    activeDeviceId: 'web-a',
    song,
    queue: [nextSong],
    isPlaying: true,
    positionSec: 37,
    positionAt: clock.now(),
    volume: 0.8,
    shuffle: false,
    repeat: 'off',
    rev: 4,
    ...overrides
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function sessionPair(options: {
  readonly bRejectsAutoplay?: boolean;
  readonly bLoadResult?: 'ok' | 'not_found' | 'needs_gesture';
  readonly aWithoutOptionalActions?: boolean;
  readonly sourceState?: Partial<ConnectPlayerState>;
  readonly transportFactory?: (clock: TestClock) => MemoryTransport;
} = {}) {
  const clock = new TestClock();
  const transport = options.transportFactory?.(clock) ?? new MemoryTransport(() => clock.now());
  const sourceState = state(clock, options.sourceState);
  transport.seedState(sourceState);
  const playerA = new FakePlayerPort({
    song,
    queue: [nextSong],
    isPlaying: true,
    positionSec: 37,
    volume: sourceState.volume,
    shuffle: sourceState.shuffle,
    repeat: sourceState.repeat
  });
  const playerB = new FakePlayerPort();
  playerB.rejectsAutoplay = options.bRejectsAutoplay ?? false;
  playerB.nextLoadResult = options.bLoadResult ?? 'ok';
  const sessionA = createConnectSession({ transport, player: options.aWithoutOptionalActions ? withoutOptionalActions(playerA) : playerA, device: device('web-a', 'Laptop'), clock });
  const sessionB = createConnectSession({ transport, player: playerB, device: device('phone-b', 'Pixel 8'), clock });
  sessionA.setVisible(true);
  sessionB.setVisible(true);
  await settle();
  return { clock, transport, playerA, playerB, sessionA, sessionB };
}

function withoutOptionalActions(player: FakePlayerPort): PlayerPort {
  return {
    getSnapshot: () => player.getSnapshot(),
    onChange: listener => player.onChange(listener),
    play: () => player.play(),
    pause: () => player.pause(),
    seek: sec => player.seek(sec),
    setVolume: volume => player.setVolume(volume),
    load: (song, queue, options) => player.load(song, queue, options)
  };
}

test('a remote pause is applied once and the sender sees its acknowledgement', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({
    transportFactory: (clock) => new DuplicateDeliveryTransport(() => clock.now())
  });

  sessionB.control({ kind: 'pause' });
  await settle();

  assert.equal(playerA.calls.filter((call) => call.method === 'pause').length, 1);
  assert.equal(sessionA.view().isPlaying, false);
  assert.equal(sessionB.view().isPlaying, false);
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().lastError, undefined);
  sessionA.dispose();
  sessionB.dispose();
});

test('a remote play blocked by autoplay fails with a stable needs_gesture acknowledgement', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ sourceState: { isPlaying: false } });
  playerA.update({ isPlaying: false });
  playerA.rejectsAutoplay = true;
  await settle();

  sessionB.control({ kind: 'play' });
  await settle();

  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(sessionB.view().lastError, 'needs_gesture');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('a remote play_song blocked by autoplay fails with a stable needs_gesture acknowledgement', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair();
  playerA.nextLoadResult = 'needs_gesture';

  sessionB.control({ kind: 'play_song', song: nextSong });
  await settle();

  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(sessionB.view().lastError, 'needs_gesture');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().song?.ref, song.ref);
  sessionA.dispose();
  sessionB.dispose();
});

test('a next fallback that cannot autoplay is acknowledged as failed', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ aWithoutOptionalActions: true });
  playerA.rejectsAutoplay = true;

  sessionB.control({ kind: 'next' });
  await settle();

  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(sessionB.view().lastError, 'needs_gesture');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().song?.ref, song.ref);
  sessionA.dispose();
  sessionB.dispose();
});

test('a queue_add fallback that cannot resume playback is acknowledged as failed', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ aWithoutOptionalActions: true });
  playerA.rejectsAutoplay = true;

  sessionB.control({ kind: 'queue_add', song: nextSong });
  await settle();

  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(sessionB.view().lastError, 'needs_gesture');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.deepEqual(sessionB.view().queue, [nextSong]);
  sessionA.dispose();
  sessionB.dispose();
});

test('a second device claim pauses the previously active player', async () => {
  const { playerA, playerB, sessionA, sessionB } = await sessionPair();

  playerB.update({ song, isPlaying: true });
  await settle();

  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  assert.equal(sessionB.view().isThisDeviceActive, true);
  assert.equal(playerA.getSnapshot().isPlaying, false);
  assert.equal(playerA.calls.filter((call) => call.method === 'pause').length, 1);
  sessionA.dispose();
  sessionB.dispose();
});

test('transfer loads the current position and queue before the new device claims playback', async () => {
  const { playerA, playerB, sessionA, sessionB } = await sessionPair();

  const result = await sessionA.transferTo('phone-b');
  await settle();

  assert.deepEqual(result, { ok: true });
  const load = [...playerB.calls].reverse().find((call) => call.method === 'load');
  assert.ok(load);
  assert.equal((load.args[2] as { positionSec: number }).positionSec, 37);
  assert.deepEqual(load.args[1], [nextSong]);
  assert.equal((load.args[2] as { play: boolean }).play, true);
  assert.equal(sessionB.view().activeDeviceId, 'phone-b');
  assert.equal(sessionB.view().isPlaying, true);
  assert.equal(playerA.getSnapshot().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('transferring back to this device loads live position, queue, settings, and claims only after load', async () => {
  const { clock, transport, playerA, playerB, sessionA, sessionB } = await sessionPair({
    sourceState: { shuffle: true, repeat: 'all' },
    transportFactory: (clock) => new DeferredClaimTransport(() => clock.now())
  });
  const deferredTransport = transport as DeferredClaimTransport;
  assert.deepEqual(await sessionA.transferTo('phone-b'), { ok: true });
  clock.advance(2_500);
  deferredTransport.deferNextClaim = true;

  const transferBack = sessionA.transferTo('web-a');
  await deferredTransport.claimStarted;
  assert.equal(playerA.getSnapshot().isPlaying, true);
  assert.equal(playerB.getSnapshot().isPlaying, true);
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  deferredTransport.releaseClaim();
  const result = await transferBack;

  assert.deepEqual(result, { ok: true });
  const load = [...playerA.calls].reverse().find((call) => call.method === 'load');
  assert.ok(load);
  assert.equal((load.args[2] as { positionSec: number }).positionSec, 39.5);
  assert.deepEqual(load.args[1], [nextSong]);
  assert.equal(playerA.getSnapshot().isPlaying, true);
  assert.equal(playerA.getSnapshot().volume, 0.8);
  assert.equal(playerA.getSnapshot().shuffle, true);
  assert.equal(playerA.getSnapshot().repeat, 'all');
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  assert.equal(playerB.getSnapshot().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('a local transfer keeps the remote source active on missing songs or blocked autoplay', async () => {
  const { transport, playerA, playerB, sessionA, sessionB } = await sessionPair();
  assert.deepEqual(await sessionA.transferTo('phone-b'), { ok: true });

  playerA.nextLoadResult = 'not_found';
  const missing = await sessionA.transferTo('web-a');
  assert.deepEqual(missing, { ok: false, reason: 'not_found', error: 'not_found' });
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  assert.equal(playerB.getSnapshot().isPlaying, true);

  playerA.nextLoadResult = 'ok';
  playerA.rejectsAutoplay = true;
  const blocked = await sessionA.transferTo('web-a');
  assert.deepEqual(blocked, { ok: false, reason: 'failed', error: 'needs_gesture' });
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(playerB.getSnapshot().isPlaying, true);

  playerA.rejectsAutoplay = false;
  transport.online = false;
  assert.deepEqual(await sessionA.transferTo('web-a'), {
    ok: false,
    reason: 'offline',
    error: 'offline'
  });
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  assert.equal(playerA.getSnapshot().isPlaying, false);
  assert.equal(playerB.getSnapshot().isPlaying, true);

  transport.online = true;
  assert.deepEqual(await sessionA.transferTo('web-a'), { ok: true });
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  sessionA.dispose();
  sessionB.dispose();
});

test('an unavailable recording fails transfer without interrupting the source', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ bLoadResult: 'not_found' });

  const result = await sessionA.transferTo('phone-b');
  await settle();

  assert.deepEqual(result, { ok: false, reason: 'not_found', error: 'not_found' });
  assert.equal(playerA.getSnapshot().isPlaying, true);
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  sessionA.dispose();
  sessionB.dispose();
});

test('an incoming transfer keeps its source active when autoplay is blocked and can be retried', async () => {
  const { playerB, sessionA, sessionB } = await sessionPair({ bRejectsAutoplay: true });

  assert.deepEqual(await sessionA.transferTo('phone-b'), {
    ok: false,
    reason: 'failed',
    error: 'needs_gesture'
  });
  assert.equal(sessionB.view().autoplayBlocked, true);
  assert.equal(sessionB.view().isThisDeviceActive, false);
  assert.equal(sessionB.view().isPlaying, true);
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  assert.equal(sessionA.view().isPlaying, true);
  assert.equal(playerB.getSnapshot().isPlaying, false);

  playerB.rejectsAutoplay = false;
  assert.deepEqual(await sessionA.transferTo('phone-b'), { ok: true });
  assert.equal(sessionB.view().autoplayBlocked, false);
  assert.equal(sessionB.view().isPlaying, true);
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  sessionA.dispose();
  sessionB.dispose();
});

test('the last session is restored paused at its saved position', async () => {
  const clock = new TestClock();
  const transport = new MemoryTransport(() => clock.now());
  transport.seedState(state(clock, { positionSec: 81, queue: [nextSong] }));
  const player = new FakePlayerPort();
  const session = createConnectSession({ transport, player, device: device('phone-new', 'New phone'), clock });

  session.setVisible(true);
  await settle();

  const load = player.calls.find((call) => call.method === 'load');
  assert.ok(load);
  assert.equal((load.args[2] as { positionSec: number }).positionSec, 81);
  assert.equal((load.args[2] as { play: boolean }).play, false);
  assert.equal(player.getSnapshot().isPlaying, false);
  assert.deepEqual(player.getSnapshot().queue, [nextSong]);
  session.dispose();
});

test('an offline remote command rolls back optimism and clears its pending state', async () => {
  const { transport, sessionB } = await sessionPair();
  transport.online = false;

  sessionB.control({ kind: 'pause' });
  await settle();

  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().isPlaying, true);
  assert.equal(sessionB.view().lastError, 'Connect is offline');
  sessionB.dispose();
});

test('a failed acknowledgement retries without applying the command again', async () => {
  const { clock, transport, playerA, sessionA, sessionB } = await sessionPair({
    transportFactory: (clock) => new RetryAckTransport(() => clock.now())
  });
  const retryTransport = transport as RetryAckTransport;

  sessionB.control({ kind: 'pause' });
  await settle();
  assert.equal(playerA.calls.filter((call) => call.method === 'pause').length, 1);
  assert.equal(sessionB.view().pendingCommand?.command.kind, 'pause');
  assert.equal(retryTransport.ackAttempts, 1);

  clock.advance(1_000);
  await settle();

  assert.equal(playerA.calls.filter((call) => call.method === 'pause').length, 1);
  assert.equal(retryTransport.ackAttempts, 2);
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().lastError, undefined);
  sessionA.dispose();
  sessionB.dispose();
});

test('an unresponsive target times out without pausing the source', async () => {
  const { clock, playerA, sessionA, sessionB } = await sessionPair();
  sessionB.setVisible(false);

  const transfer = sessionA.transferTo('phone-b');
  await settle();
  clock.advance(4_000);
  const result = await transfer;

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'timeout');
  assert.equal(playerA.getSnapshot().isPlaying, true);
  assert.equal(sessionA.view().pendingCommand, undefined);
  assert.match(sessionA.view().lastError ?? '', /Couldn't reach Pixel 8/);
  sessionA.dispose();
  sessionB.dispose();
});

test('offline registration retries at a bounded interval and recovers', async () => {
  const clock = new TestClock();
  const transport = new MemoryTransport(() => clock.now());
  transport.online = false;
  const session = createConnectSession({ transport, player: new FakePlayerPort(), device: device('web-a', 'Laptop'), clock });

  session.setVisible(true);
  await settle();
  assert.equal(session.view().lastError, 'offline');
  assert.equal(clock.timerCount, 1);

  clock.advance(5_000);
  await settle();
  assert.equal(clock.timerCount, 1);
  transport.online = true;
  clock.advance(5_000);
  await settle();
  assert.equal(session.view().lastError, undefined);
  assert.equal(session.view().devices.some((entry) => entry.deviceId === 'web-a'), true);
  session.dispose();
  assert.equal(clock.timerCount, 0);
});

test('disposing settles in-flight work and clears watches and timers', async () => {
  const { clock, playerA, sessionA, sessionB } = await sessionPair();
  let updates = 0;
  sessionA.subscribe(() => updates++);
  const transfer = sessionA.transferTo('phone-b');

  sessionA.dispose();
  const result = await transfer;
  assert.deepEqual(result, { ok: false, reason: 'offline' });
  const updatesAtDispose = updates;
  playerA.update({ isPlaying: false });
  assert.equal(updates, updatesAtDispose);

  sessionB.dispose();
  assert.equal(clock.timerCount, 0);
});

test('player reports leave the server-owned position anchor out of the patch', async () => {
  const { clock, transport, playerA, sessionA, sessionB } = await sessionPair({
    transportFactory: (clock) => new ReportInspectTransport(() => clock.now())
  });
  playerA.update({ volume: 0.7 });
  await settle();

  const patches = (transport as ReportInspectTransport).patches;
  assert.ok(patches.length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(patches[0], 'positionAt'), false);
  sessionA.dispose();
  sessionB.dispose();
});
