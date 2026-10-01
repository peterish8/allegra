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

class RetryCompleteTransport extends MemoryTransport {
  completeAttempts = 0;

  override async complete(...args: Parameters<MemoryTransport['complete']>): ReturnType<MemoryTransport['complete']> {
    this.completeAttempts++;
    if (this.completeAttempts === 1) throw new Error('network offline');
    return super.complete(...args);
  }
}

class RetryBeginTransport extends MemoryTransport {
  beginAttempts = 0;

  override async begin(...args: Parameters<MemoryTransport['begin']>): ReturnType<MemoryTransport['begin']> {
    this.beginAttempts++;
    if (this.beginAttempts === 1) throw new Error('temporary connection loss');
    return super.begin(...args);
  }
}

class ReportInspectTransport extends MemoryTransport {
  readonly patches: Array<import('./types.ts').PlayerStatePatch> = [];

  override async report(...args: Parameters<MemoryTransport['report']>): ReturnType<MemoryTransport['report']> {
    this.patches.push(args[1]);
    return super.report(...args);
  }
}

class DeferredPausePlayer extends FakePlayerPort {
  deferNextPause = false;
  private beginPause!: () => void;
  private finishPause!: () => void;
  readonly pauseStarted = new Promise<void>((resolve) => { this.beginPause = resolve; });
  private readonly heldPause = new Promise<void>((resolve) => { this.finishPause = resolve; });

  releasePause(): void { this.finishPause(); }

  override async pause(): Promise<void> {
    if (this.deferNextPause) {
      this.deferNextPause = false;
      this.beginPause();
      await this.heldPause;
    }
    await super.pause();
  }
}

class DelayedReportTransport extends MemoryTransport {
  holdUpdates = false;
  holdNextReport = false;
  conflictNextReport = false;
  maxConcurrentReports = 0;
  readonly reports: Array<{ rev: number; patch: import('./types.ts').PlayerStatePatch }> = [];
  private concurrentReports = 0;
  private beginReport!: () => void;
  private releaseHeldReport!: () => void;
  readonly reportStarted = new Promise<void>(resolve => { this.beginReport = resolve; });
  private readonly heldReport = new Promise<void>(resolve => { this.releaseHeldReport = resolve; });

  releaseReport(): void { this.releaseHeldReport(); }

  override watch(deviceId: string, listener: Parameters<MemoryTransport['watch']>[1]): () => void {
    return super.watch(deviceId, snapshot => { if (!this.holdUpdates) listener(snapshot); });
  }

  override async report(...args: Parameters<MemoryTransport['report']>): ReturnType<MemoryTransport['report']> {
    this.concurrentReports++;
    this.maxConcurrentReports = Math.max(this.maxConcurrentReports, this.concurrentReports);
    try {
      if (this.conflictNextReport) {
        this.conflictNextReport = false;
        const otherWrite = await super.report(args[0], { ...args[1], volume: 1 }, args[2]);
        throw Object.assign(new Error('[CONVEX M(connect:report)] Server Error'), {
          data: { code: 'stale_revision', currentRev: otherWrite.rev }
        });
      }
      if (this.holdNextReport) {
        this.holdNextReport = false;
        this.beginReport();
        await this.heldReport;
      }
      const result = await super.report(...args);
      this.reports.push({ rev: args[2].rev, patch: args[1] });
      return result;
    } finally {
      this.concurrentReports--;
    }
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
    ownershipEpoch: 0,
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

test('playback updates stay ordered when reports and reactive state arrive late', async () => {
  const pair = await sessionPair({ transportFactory: clock => new DelayedReportTransport(() => clock.now()) });
  const transport = pair.transport as DelayedReportTransport;
  transport.holdUpdates = true;
  transport.holdNextReport = true;
  pair.sessionA.control({ kind: 'volume', v: 0.25 });
  await transport.reportStarted;
  pair.sessionA.control({ kind: 'seek', sec: 90 });
  await settle();
  transport.releaseReport();
  await settle();

  assert.equal(transport.maxConcurrentReports, 1);
  assert.deepEqual(transport.reports.map(report => report.rev), [4, 5]);
  assert.equal(transport.reports[1]?.patch.positionSec, 90);
  assert.equal(transport.reports[1]?.patch.volume, undefined);
  assert.equal(pair.sessionA.view().lastError, undefined);
  pair.sessionA.dispose();
  pair.sessionB.dispose();
});

test('a stale report retries its final state without waiting for another player event', async () => {
  const pair = await sessionPair({ transportFactory: clock => new DelayedReportTransport(() => clock.now()) });
  const transport = pair.transport as DelayedReportTransport;
  transport.holdUpdates = true;
  transport.conflictNextReport = true;
  pair.sessionA.control({ kind: 'volume', v: 0.25 });
  await settle();

  assert.deepEqual(transport.reports.map(report => report.rev), [5]);
  assert.equal(transport.reports[0]?.patch.volume, 0.25);
  assert.equal(pair.sessionA.view().lastError, undefined);
  pair.sessionA.dispose();
  pair.sessionB.dispose();
});

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
  assert.equal(sessionB.view().lastError, 'Tap play on that device to start playback.');
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
  assert.equal(sessionB.view().lastError, 'Tap play on that device to start playback.');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().song?.ref, nextSong.ref);
  sessionA.dispose();
  sessionB.dispose();
});

test('a next fallback that cannot autoplay is acknowledged as failed', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ aWithoutOptionalActions: true });
  playerA.rejectsAutoplay = true;

  sessionB.control({ kind: 'next' });
  await settle();

  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(sessionB.view().lastError, 'Tap play on that device to start playback.');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().song?.ref, nextSong.ref);
  sessionA.dispose();
  sessionB.dispose();
});

test('a queue_add fallback that cannot resume playback is acknowledged as failed', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ aWithoutOptionalActions: true });
  playerA.rejectsAutoplay = true;

  sessionB.control({ kind: 'queue_add', song: nextSong });
  await settle();

  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(sessionB.view().lastError, 'Tap play on that device to start playback.');
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.deepEqual(sessionB.view().queue, [nextSong, nextSong]);
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
  assert.equal((load.args[2] as { play: boolean }).play, false);
  assert.equal(sessionB.view().activeDeviceId, 'phone-b');
  assert.equal(sessionB.view().isPlaying, true);
  assert.equal(playerA.getSnapshot().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('transferring back waits for the former owner to confirm pause before playback resumes', async () => {
  const clock = new TestClock();
  const transport = new MemoryTransport(() => clock.now());
  transport.seedState(state(clock, { shuffle: true, repeat: 'all' }));
  const playerA = new FakePlayerPort({ song, queue: [nextSong], isPlaying: true, positionSec: 37, volume: 0.8, shuffle: true, repeat: 'all' });
  const playerB = new DeferredPausePlayer();
  const sessionA = createConnectSession({ transport, player: playerA, device: device('web-a', 'Laptop'), clock });
  const sessionB = createConnectSession({ transport, player: playerB, device: device('phone-b', 'Pixel 8'), clock });
  sessionA.setVisible(true);
  sessionB.setVisible(true);
  await settle();
  assert.deepEqual(await sessionA.transferTo('phone-b'), { ok: true });
  clock.advance(2_500);
  playerB.deferNextPause = true;

  const transferBack = sessionA.transferTo('web-a');
  await playerB.pauseStarted;
  assert.equal(playerA.getSnapshot().isPlaying, false);
  assert.equal(playerB.getSnapshot().isPlaying, true);
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  playerB.releasePause();
  const result = await transferBack;

  assert.deepEqual(result, { ok: true });
  const load = [...playerA.calls].reverse().find((call) => call.method === 'load');
  assert.ok(load);
  assert.equal((load.args[2] as { positionSec: number }).positionSec, 39.5);
  assert.deepEqual(load.args[1], [nextSong]);
  assert.equal((load.args[2] as { play: boolean }).play, false);
  assert.equal(playerA.getSnapshot().isPlaying, true);
  assert.equal(playerA.getSnapshot().volume, 0.8);
  assert.equal(playerA.getSnapshot().shuffle, true);
  assert.equal(playerA.getSnapshot().repeat, 'all');
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  assert.equal(playerB.getSnapshot().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('a missing local recording preserves the current owner, while autoplay failure follows confirmed pause', async () => {
  const { playerA, playerB, sessionA, sessionB } = await sessionPair();
  assert.deepEqual(await sessionA.transferTo('phone-b'), { ok: true });

  playerA.nextLoadResult = 'not_found';
  const missing = await sessionA.transferTo('web-a');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'not_found');
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  assert.equal(playerB.getSnapshot().isPlaying, true);

  playerA.nextLoadResult = 'ok';
  playerA.rejectsAutoplay = true;
  const blocked = await sessionA.transferTo('web-a');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'needs_gesture');
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  assert.equal(sessionA.view().autoplayBlocked, true);
  assert.equal(playerB.getSnapshot().isPlaying, false);
  assert.equal(playerA.getSnapshot().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('an unavailable recording fails transfer without interrupting the source', async () => {
  const { playerA, sessionA, sessionB } = await sessionPair({ bLoadResult: 'not_found' });

  const result = await sessionA.transferTo('phone-b');
  await settle();

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'not_found');
  assert.equal(playerA.getSnapshot().isPlaying, true);
  assert.equal(sessionA.view().activeDeviceId, 'web-a');
  sessionA.dispose();
  sessionB.dispose();
});

test('autoplay failure after confirmed pause leaves the new owner paused and reports the gesture requirement', async () => {
  const { playerB, sessionA, sessionB } = await sessionPair({ bRejectsAutoplay: true });

  const blocked = await sessionA.transferTo('phone-b');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'needs_gesture');
  assert.equal(sessionB.view().autoplayBlocked, true);
  assert.equal(sessionB.view().isThisDeviceActive, true);
  assert.equal(sessionB.view().isPlaying, false);
  assert.equal(sessionA.view().activeDeviceId, 'phone-b');
  assert.equal(sessionA.view().isPlaying, false);
  assert.equal(playerB.getSnapshot().isPlaying, false);

  playerB.rejectsAutoplay = false;
  sessionB.control({ kind: 'play' });
  await settle();
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

test('an offline remote command times out honestly while retaining its unresolved delivery', async () => {
  const { clock, transport, sessionB } = await sessionPair();
  transport.online = false;

  sessionB.control({ kind: 'pause' });
  await settle();
  clock.advance(4_000);
  await settle();

  assert.equal(sessionB.view().pendingCommand?.command.kind, 'pause');
  assert.equal(sessionB.view().isPlaying, true);
  assert.equal(sessionB.view().lastError, "Couldn't reach Laptop.");
  sessionB.dispose();
});

test('a lost completion reply retries without applying the command again', async () => {
  const { clock, transport, playerA, sessionA, sessionB } = await sessionPair({
    transportFactory: (clock) => new RetryCompleteTransport(() => clock.now())
  });
  const retryTransport = transport as RetryCompleteTransport;

  sessionB.control({ kind: 'pause' });
  await settle();
  assert.equal(playerA.calls.filter((call) => call.method === 'pause').length, 1);
  assert.equal(sessionB.view().pendingCommand?.command.kind, 'pause');
  assert.equal(retryTransport.completeAttempts, 1);

  clock.advance(1_000);
  await settle();

  assert.equal(playerA.calls.filter((call) => call.method === 'pause').length, 1);
  assert.equal(retryTransport.completeAttempts, 2);
  assert.equal(sessionB.view().pendingCommand, undefined);
  assert.equal(sessionB.view().lastError, undefined);
  sessionA.dispose();
  sessionB.dispose();
});

test('an uncertain reservation failure retries the inbox without dropping the command', async () => {
  const pair = await sessionPair({
    transportFactory: clock => new RetryBeginTransport(() => clock.now())
  });
  const retryTransport = pair.transport as RetryBeginTransport;

  pair.sessionB.control({ kind: 'pause' });
  await settle();
  assert.equal(retryTransport.beginAttempts, 1);
  assert.equal(pair.playerA.calls.filter(call => call.method === 'pause').length, 0);

  pair.clock.advance(500);
  await settle();

  assert.equal(retryTransport.beginAttempts, 2);
  assert.equal(pair.playerA.calls.filter(call => call.method === 'pause').length, 1);
  assert.equal(pair.sessionB.view().pendingCommand, undefined);
  assert.equal(pair.sessionB.view().lastError, undefined);
  pair.sessionA.dispose();
  pair.sessionB.dispose();
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
  assert.equal(sessionA.view().pendingCommand?.command.kind, 'pause');
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
  assert.equal(session.view().lastError, 'Connect is offline.');
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
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'offline');
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

class SlowLoadPlayer extends FakePlayerPort {
  private beginLoad!: () => void;
  private releaseLoad!: () => void;
  readonly loadStarted = new Promise<void>((resolve) => { this.beginLoad = resolve; });
  private readonly heldLoad = new Promise<void>((resolve) => { this.releaseLoad = resolve; });

  finishLoad(): void { this.releaseLoad(); }

  override async load(...args: Parameters<FakePlayerPort['load']>): ReturnType<FakePlayerPort['load']> {
    this.beginLoad();
    await this.heldLoad;
    return super.load(...args);
  }
}

test('a transfer the target has begun keeps waiting past the input timeout and succeeds', async () => {
  // The catalog lookup and buffering on the target routinely take longer than the 4 s pick-up
  // window. The sender used to report "not reachable" while the music then moved anyway.
  const clock = new TestClock();
  const transport = new MemoryTransport(() => clock.now());
  transport.seedState(state(clock));
  const playerA = new FakePlayerPort({ song, queue: [nextSong], isPlaying: true, positionSec: 37, volume: 0.8 });
  const playerB = new SlowLoadPlayer();
  const sessionA = createConnectSession({ transport, player: playerA, device: device('web-a', 'Laptop'), clock });
  const sessionB = createConnectSession({ transport, player: playerB, device: device('phone-b', 'Pixel 8'), clock });
  sessionA.setVisible(true);
  sessionB.setVisible(true);
  await settle();

  const transfer = sessionA.transferTo('phone-b');
  let settled = false;
  let early: unknown;
  void transfer.then((value) => { settled = true; early = value; });
  await playerB.loadStarted;
  await settle();
  clock.advance(6_000);
  await settle();
  assert.equal(settled, false, JSON.stringify(early));
  assert.equal(sessionA.view().lastError, undefined);
  assert.equal(playerA.getSnapshot().isPlaying, true);

  playerB.finishLoad();
  assert.deepEqual(await transfer, { ok: true });
  await settle();
  assert.equal(sessionB.view().activeDeviceId, 'phone-b');
  assert.equal(playerB.getSnapshot().isPlaying, true);
  assert.equal(playerA.getSnapshot().isPlaying, false);
  sessionA.dispose();
  sessionB.dispose();
});

test('a transfer nobody picks up still fails at the pick-up window', async () => {
  const { clock, sessionA, sessionB } = await sessionPair();
  sessionB.dispose();

  const transfer = sessionA.transferTo('phone-b');
  await settle();
  clock.advance(4_000);
  const result = await transfer;

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'timeout');
  sessionA.dispose();
});
