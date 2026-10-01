import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectSession } from './connectSession.ts';
import { createDevelopmentTrace, estimateSerializedByteLength, traceCatalogLookup } from './developmentTrace.ts';
import { MemoryTransport } from './memoryTransport.ts';
import { FakePlayerPort } from './testing.ts';
import type { Clock, ConnectPlayerState, ConnectTraceEvent, DeviceRegistration } from './types.ts';
import type { SongSnapshot } from '../../shared/songRef.ts';

const song: SongSnapshot = {
  ref: 'saavn:trace-fixture',
  title: 'Private Fixture Title',
  artist: 'Private Fixture Artist',
  artwork: 'https://images.example/private-fixture.jpg',
  duration: 180
};

class TraceClock implements Clock {
  private wall = 80_000;
  private mono = 0;
  private id = 0;
  private readonly timers = new Map<number, { callback: () => void; dueAt: number; intervalMs?: number }>();

  now = (): number => this.wall;
  monotonicNow = (): number => this.mono;
  advanceMonotonic(ms: number): void { this.mono += ms; }
  advance(ms: number): void {
    this.wall += ms;
    this.mono += ms;
    for (let fired = 0; fired < 1_000; fired++) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.wall)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) return;
      const [id, timer] = next;
      if (timer.intervalMs) this.timers.set(id, { ...timer, dueAt: timer.dueAt + timer.intervalMs });
      else this.timers.delete(id);
      timer.callback();
    }
    throw new Error('Trace clock exceeded its timer execution limit');
  }

  setTimeout(callback: () => void, delayMs = 0): number {
    const id = ++this.id;
    this.timers.set(id, { callback, dueAt: this.wall + delayMs });
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  setInterval(callback: () => void, intervalMs: number): number {
    const id = ++this.id;
    this.timers.set(id, { callback, dueAt: this.wall + intervalMs, intervalMs });
    return id;
  }
  clearInterval(handle: unknown): void { this.timers.delete(handle as number); }
  get timerCount(): number { return this.timers.size; }
}

class SyntheticDelayTransport extends MemoryTransport {
  readonly delays = [10, 20, 30, 40, 50];

  constructor(now: () => number, private readonly traceClock: TraceClock) { super(now); }

  override async send(...args: Parameters<MemoryTransport['send']>): ReturnType<MemoryTransport['send']> {
    this.traceClock.advanceMonotonic(this.delays.shift() ?? 0);
    return super.send(...args);
  }
}

const registration = (deviceId: string, kind: DeviceRegistration['kind']): DeviceRegistration => ({
  deviceId,
  name: 'Private display name',
  kind,
  appVersion: 'fixture',
  canPlay: true
});

function seedState(clock: TraceClock): ConnectPlayerState {
  return {
    activeDeviceId: 'web-source',
    song,
    queue: [],
    isPlaying: true,
    positionSec: 12,
    positionAt: clock.now(),
    volume: 0.8,
    shuffle: false,
    repeat: 'off',
    rev: 1,
    ownershipEpoch: 0
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 40; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

test('development tracing requires explicit development opt-in and a monotonic clock', () => {
  assert.equal(createDevelopmentTrace({ development: false, enabled: true, monotonicNow: () => 1 }), undefined);
  assert.equal(createDevelopmentTrace({ development: true, enabled: false, monotonicNow: () => 1 }), undefined);
  assert.equal(createDevelopmentTrace({ development: true, enabled: true }), undefined);
  assert.equal(createDevelopmentTrace({ development: true, enabled: true, monotonicNow: () => Number.NaN }), undefined);
});

test('the trace buffer stores only whitelisted fields, redacts opaque IDs, bounds history, and disposes', () => {
  let time = 4;
  const trace = createDevelopmentTrace({ development: true, enabled: true, monotonicNow: () => time++, maxEntries: 2 });
  assert.ok(trace);
  const unsafe = {
    event: 'input.started', operation: 'control', requestId: 'req-7', commandId: 'nithya@example.com', kind: 'pause',
    title: 'Private Fixture Title', payload: { token: 'never-store-this' }, rawError: 'private error text'
  } as unknown as ConnectTraceEvent;
  trace.record(unsafe);
  trace.record({ event: 'mutation.started', operation: 'send', count: 1, payloadBytes: 48 });
  trace.record({ event: 'mutation.completed', operation: 'send', outcome: 'ok', count: 1, durationMs: 3 });

  const entries = trace.snapshot();
  assert.equal(entries.length, 2);
  assert.deepEqual(Object.keys(entries[0] ?? {}).sort(), ['atMs', 'count', 'event', 'operation', 'payloadBytes']);
  assert.equal(JSON.stringify(entries).includes('nithya@example.com'), false);
  assert.equal(JSON.stringify(entries).includes('Private Fixture Title'), false);
  assert.equal(JSON.stringify(entries).includes('never-store-this'), false);

  trace.clear();
  trace.record(unsafe);
  assert.match(trace.snapshot()[0]?.commandId ?? '', /^id-[0-9a-f]{8}$/);
  trace.clear();
  assert.equal(trace.snapshot().length, 0);
  trace.record({ event: 'adapter.ready', operation: 'player', outcome: 'ok' });
  trace.dispose();
  trace.record({ event: 'adapter.ready', operation: 'player', outcome: 'ok' });
  assert.equal(trace.snapshot().length, 0);
});

test('byte estimates expose serialized size only and tolerate unserializable inputs', () => {
  const value = { title: 'Private Fixture Title', artwork: 'https://images.example/private-fixture.jpg', emoji: '🎵' };
  assert.equal(estimateSerializedByteLength(value), new TextEncoder().encode(JSON.stringify(value)).length);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(estimateSerializedByteLength(circular), undefined);
});

test('catalog tracing records deterministic duration and maximum in-flight concurrency without payloads', async () => {
  let time = 0;
  const trace = createDevelopmentTrace({ development: true, enabled: true, monotonicNow: () => time });
  assert.ok(trace);
  const resolveLookup: Array<(value: string) => void> = [];
  const lookup = () => new Promise<string>((resolve) => resolveLookup.push(resolve));

  const first = traceCatalogLookup(trace, lookup, () => time);
  time = 4;
  const second = traceCatalogLookup(trace, lookup, () => time);
  time = 9;
  resolveLookup[0]?.('private result');
  assert.equal(await first, 'private result');
  time = 15;
  resolveLookup[1]?.('another private result');
  assert.equal(await second, 'another private result');

  const entries = trace.snapshot();
  assert.deepEqual(entries.map((entry) => entry.event), [
    'catalog.requested', 'catalog.requested', 'catalog.completed', 'catalog.completed'
  ]);
  assert.deepEqual(entries.filter((entry) => entry.event === 'catalog.completed').map((entry) => entry.durationMs), [9, 11]);
  assert.equal(Math.max(...entries.map((entry) => entry.maxConcurrency ?? 0)), 2);
  assert.equal(JSON.stringify(entries).includes('private result'), false);

  const failed = traceCatalogLookup(trace, async () => {
    time += 7;
    throw new Error('private catalog failure');
  }, () => time);
  await assert.rejects(failed, /private catalog failure/);
  const failureEvent = trace.snapshot().at(-1);
  assert.equal(failureEvent?.outcome, 'failed');
  assert.equal(JSON.stringify(trace.snapshot()).includes('private catalog failure'), false);
});

test('session tracing measures synthetic sender confirmation, receiver intent, mutations, query callbacks, and timer cleanup', async () => {
  const clock = new TraceClock();
  const transport = new SyntheticDelayTransport(clock.now, clock);
  transport.seedState(seedState(clock));
  const trace = createDevelopmentTrace({ development: true, enabled: true, monotonicNow: clock.monotonicNow });
  assert.ok(trace);

  const sourcePlayer = new FakePlayerPort({
    song, queue: [], isPlaying: true, positionSec: 12, volume: 0.8, shuffle: false, repeat: 'off'
  });
  const receiverPlayer = new FakePlayerPort();
  const source = createConnectSession({ transport, player: sourcePlayer, device: registration('web-source', 'web'), clock, trace });
  const receiver = createConnectSession({
    transport, player: receiverPlayer, device: registration('phone-receiver', 'android'), clock, trace
  });
  source.setVisible(true);
  receiver.setVisible(true);
  await settle();

  for (let index = 0; index < 5; index++) {
    receiver.control({ kind: 'pause' });
    await settle();
  }

  const entries = trace.snapshot();
  const confirmations = entries.filter((entry) => entry.event === 'input.confirmed' && entry.operation === 'control');
  const samples = confirmations.map((entry) => entry.durationMs ?? -1).sort((a, b) => a - b);
  assert.deepEqual(samples, [10, 20, 30, 40, 50]);
  assert.equal(samples[Math.ceil(0.5 * samples.length) - 1], 30);
  assert.equal(samples[Math.ceil(0.95 * samples.length) - 1], 50);
  assert.equal(entries.filter((entry) => entry.event === 'mutation.started' && entry.operation === 'send').length, 5);
  assert.equal(entries.filter((entry) => entry.event === 'receiver.completed').length, 5);
  assert.ok(entries.some((entry) => entry.event === 'mutation.started' && entry.operation === 'complete'));
  assert.ok(entries.some((entry) => entry.event === 'query.delivered' && entry.operation === 'watch'));
  assert.ok(entries.some((entry) => entry.event === 'timer.scheduled' && entry.operation === 'command_timeout'));
  assert.ok(entries.some((entry) => entry.event === 'timer.cleared' && entry.operation === 'command_timeout'));
  assert.equal(JSON.stringify(entries).includes('Private Fixture Title'), false);
  assert.equal(JSON.stringify(entries).includes('Private display name'), false);

  source.dispose();
  receiver.dispose();
  assert.equal(clock.timerCount, 0);
});

test('a throwing trace writer cannot prevent playback commands from being acknowledged', async () => {
  const clock = new TraceClock();
  const transport = new MemoryTransport(clock.now);
  transport.seedState(seedState(clock));
  const sourcePlayer = new FakePlayerPort({
    song, queue: [], isPlaying: true, positionSec: 12, volume: 0.8, shuffle: false, repeat: 'off'
  });
  const receiverPlayer = new FakePlayerPort();
  const source = createConnectSession({ transport, player: sourcePlayer, device: registration('web-source', 'web'), clock });
  const receiver = createConnectSession({
    transport,
    player: receiverPlayer,
    device: registration('phone-receiver', 'android'),
    clock,
    trace: { record: () => { throw new Error('diagnostics unavailable'); } }
  });
  source.setVisible(true);
  receiver.setVisible(true);
  await settle();

  receiver.control({ kind: 'pause' });
  await settle();

  assert.equal(sourcePlayer.getSnapshot().isPlaying, false);
  assert.equal(receiver.view().pendingCommand, undefined);
  assert.equal(receiver.view().lastError, undefined);
  source.dispose();
  receiver.dispose();
});

test('autoplay failure records receiver and sender outcomes without private errors', async () => {
  const clock = new TraceClock();
  const transport = new MemoryTransport(clock.now);
  transport.seedState({ ...seedState(clock), isPlaying: false });
  const trace = createDevelopmentTrace({ development: true, enabled: true, monotonicNow: clock.monotonicNow });
  assert.ok(trace);
  const sourcePlayer = new FakePlayerPort({
    song, queue: [], isPlaying: false, positionSec: 12, volume: 0.8, shuffle: false, repeat: 'off'
  });
  sourcePlayer.rejectsAutoplay = true;
  const senderPlayer = new FakePlayerPort();
  const source = createConnectSession({ transport, player: sourcePlayer, device: registration('web-source', 'web'), clock, trace });
  const sender = createConnectSession({ transport, player: senderPlayer, device: registration('phone-sender', 'android'), clock, trace });
  source.setVisible(true);
  sender.setVisible(true);
  await settle();

  sender.control({ kind: 'play' });
  await settle();

  const entries = trace.snapshot();
  assert.ok(entries.some((entry) => entry.event === 'receiver.failed' && entry.outcome === 'needs_gesture'));
  assert.ok(entries.some((entry) => entry.event === 'input.failed' && entry.operation === 'control' && entry.outcome === 'needs_gesture'));
  assert.ok(entries.some((entry) => entry.event === 'mutation.completed' && entry.operation === 'complete' && entry.outcome === 'ok'));
  assert.equal(JSON.stringify(entries).includes('Private Fixture Title'), false);
  source.dispose();
  sender.dispose();
});

test('a feedback timeout records local duration and clears its pending timeout on disposal', async () => {
  const clock = new TraceClock();
  const transport = new MemoryTransport(clock.now);
  transport.seedState(seedState(clock));
  await transport.register({ ...registration('web-source', 'web'), protocolVersion: 2 });
  const trace = createDevelopmentTrace({ development: true, enabled: true, monotonicNow: clock.monotonicNow });
  assert.ok(trace);
  const sender = createConnectSession({
    transport,
    player: new FakePlayerPort(),
    device: registration('phone-sender', 'android'),
    clock,
    trace
  });
  sender.setVisible(true);
  await settle();

  sender.control({ kind: 'pause' });
  await settle();
  assert.ok(sender.view().pendingCommand);
  clock.advance(4_000);
  await settle();

  const timeout = trace.snapshot().find((entry) => entry.event === 'input.timed_out');
  assert.equal(timeout?.operation, 'control');
  assert.equal(timeout?.outcome, 'timeout');
  assert.equal(timeout?.durationMs, 4_000);
  assert.equal(sender.view().pendingCommand?.command.kind, 'pause');
  sender.dispose();
  assert.equal(clock.timerCount, 0);
});

test('disposing a pending command records disposal and clears session timers', async () => {
  const clock = new TraceClock();
  const transport = new MemoryTransport(clock.now);
  transport.seedState(seedState(clock));
  await transport.register({ ...registration('web-source', 'web'), protocolVersion: 2 });
  const trace = createDevelopmentTrace({ development: true, enabled: true, monotonicNow: clock.monotonicNow });
  assert.ok(trace);
  const sender = createConnectSession({
    transport,
    player: new FakePlayerPort(),
    device: registration('phone-sender', 'android'),
    clock,
    trace
  });
  sender.setVisible(true);
  await settle();
  sender.control({ kind: 'pause' });
  await settle();
  assert.ok(sender.view().pendingCommand);

  sender.dispose();

  assert.ok(trace.snapshot().some((entry) => entry.event === 'input.failed' && entry.outcome === 'disposed'));
  assert.ok(trace.snapshot().some((entry) => entry.event === 'timer.cleared' && entry.operation === 'command_timeout'));
  assert.equal(clock.timerCount, 0);
});
