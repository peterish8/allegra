import assert from 'node:assert/strict';
import test from 'node:test';

import { accountIdFromToken, deviceIdForAccount, type DeviceIdStorage } from './connectDeviceId.ts';

class MemoryStorage implements DeviceIdStorage {
  private readonly values = new Map<string, string>();
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('persists a distinct base id for each account and reuses it for the same account', () => {
  const storage = new MemoryStorage();
  let sequence = 0;
  const createId = () => `uuid-${++sequence}`;

  const first = deviceIdForAccount('user/one', storage, createId);
  const other = deviceIdForAccount('user:two', storage, createId);
  const again = deviceIdForAccount('user/one', storage, createId);

  assert.equal(first, 'web-uuid-1');
  assert.equal(other, 'web-uuid-2');
  assert.equal(again, first);
  assert.equal(sequence, 2);
});

test('keeps the dev harness suffix separate from the shared account base id', () => {
  const storage = new MemoryStorage();
  const createId = () => 'shared';

  assert.equal(deviceIdForAccount('user', storage, createId, 'phone'), 'web-shared:phone');
  assert.equal(deviceIdForAccount('user', storage, createId, 'laptop'), 'web-shared:laptop');
  assert.equal(deviceIdForAccount('user', storage, () => 'unused'), 'web-shared');
});

test('reads only a string subject from the auth token for local scoping', () => {
  const token = `header.${btoa(JSON.stringify({ sub: 'account-123' })).replace(/=/g, '')}.signature`;
  assert.equal(accountIdFromToken(token), 'account-123');
  assert.equal(accountIdFromToken(null), null);
  assert.equal(accountIdFromToken('not-a-token'), null);
});
