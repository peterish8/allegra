import assert from 'node:assert/strict';
import test from 'node:test';

import { createConvexTransport, decodeInbox, decodeOutcomes, type ConvexWireClient } from './convexWire.ts';

class FakeWire implements ConvexWireClient {
  readonly calls: Array<{ readonly name: string; readonly args: Record<string, unknown> }> = [];
  readonly values = new Map<string, unknown>();
  readonly listeners = new Map<string, () => void>();
  response: unknown = { commandId: 'commands:one', serverNow: 1_000, executeBefore: 16_000, ownershipEpoch: 4 };

  async mutation(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    return this.response;
  }

  watchQuery(name: string): { onUpdate(callback: () => void): () => void; current(): unknown } {
    return {
      onUpdate: callback => {
        this.listeners.set(name, callback);
        return () => this.listeners.delete(name);
      },
      current: () => this.values.get(name)
    };
  }

  publish(name: string, value: unknown): void {
    this.values.set(name, value);
    this.listeners.get(name)?.();
  }
}

test('V2 watch waits for every first server result and stops every subscription', () => {
  const client = new FakeWire();
  const transport = createConvexTransport(client);
  const received: unknown[] = [];
  const stop = transport.watch('web-one', snapshot => received.push(snapshot));

  assert.equal(received.length, 0);
  client.publish('connect:devices', []);
  client.publish('connect:state', null);
  client.publish('connect:inboxFor', []);
  assert.equal(received.length, 0);
  client.publish('connect:outcomesFor', []);
  assert.deepEqual(received, [{ devices: [], inbox: [], outcomes: [] }]);

  stop();
  assert.equal(client.listeners.size, 0);
});

test('send omits empty args and returns the server receipt without making up time', async () => {
  const client = new FakeWire();
  const transport = createConvexTransport(client);
  const receipt = await transport.send({
    fromDeviceId: 'web-one', targetDeviceId: 'phone-two', requestId: 'request-001',
    expectedOwnershipEpoch: 4, command: { kind: 'pause' }
  });

  assert.deepEqual(receipt, { commandId: 'commands:one', serverNow: 1_000, executeBefore: 16_000, ownershipEpoch: 4 });
  assert.deepEqual(client.calls, [{
    name: 'connect:sendV2',
    args: { fromDeviceId: 'web-one', targetDeviceId: 'phone-two', requestId: 'request-001', expectedOwnershipEpoch: 4, kind: 'pause' }
  }]);
});

test('malformed inbox and outcome rows are dropped without casting opaque arguments', () => {
  const inbox = decodeInbox([
    { commandId: 'commands:bad', sourceDeviceId: 'web', kind: 'seek', args: { sec: '12' }, createdAt: 1 },
    { commandId: 'commands:ok', sourceDeviceId: 'web', kind: 'seek', args: { sec: 12 }, createdAt: 2 },
    null
  ]);
  const outcomes = decodeOutcomes([
    { commandId: 'commands:done', targetDeviceId: 'phone', kind: 'pause', createdAt: 3, status: 'done', args: { private: true } },
    { commandId: 'commands:bad', targetDeviceId: 'phone', kind: 'unknown', createdAt: 4, status: 'pending' },
    null
  ]);

  assert.deepEqual(inbox, [{
    id: 'commands:ok', sourceDeviceId: 'web', command: { kind: 'seek', sec: 12 }, createdAt: 2
  }]);
  assert.deepEqual(outcomes, [{
    id: 'commands:done', targetDeviceId: 'phone', kind: 'pause', createdAt: 3, status: 'done'
  }]);
});

test('a transfer decodes in the shape the server sends, with or without its epoch', () => {
  // convex/connect.ts transferState: a PlayerStateSnapshot, never an active device or handoff.
  const song = { ref: 'saavn:abc123', title: 'Kesariya', artist: 'Arijit Singh', artwork: 'https://c.example/a.jpg', duration: 268 };
  const state = { song, queue: [], isPlaying: true, positionSec: 42, positionAt: 9_000, volume: 0.7, shuffle: false, repeat: 'off', rev: 5 };
  const row = (id: string, args: unknown) => ({
    commandId: id, sourceDeviceId: 'web', kind: 'take_over', args, createdAt: 10,
    requestId: `request-${id}`, executeBefore: 70_000, expectedOwnershipEpoch: 3
  });

  const inbox = decodeInbox([
    row('commands:no-epoch', { state }),
    row('commands:epoch', { state: { ...state, ownershipEpoch: 3 } }),
    row('commands:bad-epoch', { state: { ...state, ownershipEpoch: 'three' } })
  ]);

  assert.deepEqual(inbox?.map(item => item.id), ['commands:epoch', 'commands:no-epoch']);
  const withoutEpoch = inbox?.find(item => item.id === 'commands:no-epoch');
  assert.deepEqual(withoutEpoch?.command, { kind: 'take_over', state });
  assert.equal(withoutEpoch?.expectedOwnershipEpoch, 3);
});

test('queue edits and a timed play_song decode, and a malformed one is dropped', () => {
  const song = { ref: 'saavn:abc123', title: 'Kesariya', artist: 'Arijit Singh', artwork: 'https://c.example/a.jpg', duration: 268 };
  const row = (id: string, kind: string, args?: unknown) => ({ commandId: id, sourceDeviceId: 'web', kind, ...(args === undefined ? {} : { args }), createdAt: 10 });

  const inbox = decodeInbox([
    row('c:1', 'queue_add', { song, next: true }),
    row('c:2', 'queue_remove', { index: 2, ref: song.ref }),
    row('c:3', 'queue_move', { from: 3, to: 0, ref: song.ref }),
    row('c:4', 'queue_clear'),
    row('c:5', 'play_song', { song, positionSec: 42 }),
    row('c:6', 'queue_remove', { index: -1, ref: song.ref }),
    row('c:7', 'queue_move', { from: 1.5, to: 0, ref: song.ref }),
    row('c:8', 'queue_remove', { index: 1 })
  ]);

  assert.deepEqual(inbox?.map((item) => item.command), [
    { kind: 'queue_add', song, next: true },
    { kind: 'queue_remove', index: 2, ref: song.ref },
    { kind: 'queue_move', from: 3, to: 0, ref: song.ref },
    { kind: 'queue_clear' },
    { kind: 'play_song', song, positionSec: 42 }
  ]);
  assert.deepEqual(decodeOutcomes([
    { commandId: 'c:4', targetDeviceId: 'phone', kind: 'queue_clear', createdAt: 3, status: 'done' }
  ])?.map((item) => item.kind), ['queue_clear']);
});
