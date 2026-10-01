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
