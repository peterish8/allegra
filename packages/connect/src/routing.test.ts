import assert from 'node:assert/strict';
import test from 'node:test';

import { decidePlaybackRoute, isControllingAnotherDevice, ownerOfflineMessage, whenRouteReady } from './routing.ts';
import type { ConnectDevice, ConnectView } from './types.ts';

const laptop: ConnectDevice = {
  deviceId: 'web-a', name: 'Chrome on Windows', kind: 'web', appVersion: 'web-connect-1', canPlay: true, isOnline: true, protocolVersion: 3
};
const phone: ConnectDevice = {
  deviceId: 'phone-b', name: 'Pixel 8', kind: 'android', appVersion: '1.0.7', canPlay: true, isOnline: true, protocolVersion: 3
};

function view(overrides: Partial<ConnectView> = {}): ConnectView {
  return {
    ready: true,
    devices: [laptop, phone],
    activeDevice: laptop,
    activeDeviceId: laptop.deviceId,
    isThisDeviceActive: false,
    activeDeviceOnline: true,
    ownershipEpoch: 3,
    queue: [],
    queueEditable: true,
    isPlaying: true,
    livePosition: 12,
    volume: 1,
    shuffle: false,
    repeat: 'off',
    queuedCommands: 0,
    autoplayBlocked: false,
    ...overrides
  };
}

test('a pick goes to the other device while it plays and is online', () => {
  assert.deepEqual(decidePlaybackRoute({ view: view(), deviceId: 'phone-b' }), {
    kind: 'remote', deviceId: 'web-a', deviceName: 'Chrome on Windows'
  });
  // Even with nothing loaded there (no song in the view): the pick is what it will play.
  assert.equal(decidePlaybackRoute({ view: view({ isPlaying: false }), deviceId: 'phone-b' }).kind, 'remote');
});

function withoutActiveDevice(source: ConnectView): ConnectView {
  const { activeDeviceId, activeDevice, ...rest } = source;
  void activeDeviceId;
  void activeDevice;
  return rest;
}

test('a pick plays here when nothing else plays, this device plays, or Connect is off', () => {
  assert.deepEqual(decidePlaybackRoute({ view: null, deviceId: null }), { kind: 'local' });
  assert.deepEqual(decidePlaybackRoute({ view: view(), deviceId: null }), { kind: 'local' });
  assert.deepEqual(decidePlaybackRoute({ view: withoutActiveDevice(view({ activeDeviceOnline: false })), deviceId: 'phone-b' }), { kind: 'local' });
  assert.deepEqual(
    decidePlaybackRoute({ view: view({ activeDeviceId: 'phone-b', activeDevice: phone, isThisDeviceActive: true }), deviceId: 'phone-b' }),
    { kind: 'local' }
  );
});

test('a Listen Together room keeps every pick on this device', () => {
  assert.deepEqual(decidePlaybackRoute({ view: view(), deviceId: 'phone-b', heldLocally: true }), { kind: 'local' });
});

test('an offline owner means play here, naming the device that went quiet', () => {
  assert.deepEqual(decidePlaybackRoute({ view: view({ activeDeviceOnline: false }), deviceId: 'phone-b' }), {
    kind: 'local_owner_offline', deviceName: 'Chrome on Windows'
  });
  const { activeDevice, ...unnamed } = view({ activeDeviceOnline: false });
  void activeDevice;
  assert.deepEqual(decidePlaybackRoute({ view: unnamed, deviceId: 'phone-b' }), {
    kind: 'local_owner_offline', deviceName: 'your other device'
  });
});

test('a view left over from before this device listened again waits, whatever it says', () => {
  // Left in the background while it played: the old state still names this phone as the player.
  const stale = view({ ready: false, activeDeviceId: 'phone-b', activeDevice: phone, isThisDeviceActive: true });
  assert.deepEqual(decidePlaybackRoute({ view: stale, deviceId: 'phone-b' }), { kind: 'wait' });
  assert.deepEqual(decidePlaybackRoute({ view: view({ ready: false }), deviceId: 'phone-b' }), { kind: 'wait' });
  // Once the wait is over, the view it has decides.
  assert.deepEqual(decidePlaybackRoute({ view: stale, deviceId: 'phone-b', staleOk: true }), { kind: 'local' });
  assert.equal(decidePlaybackRoute({ view: view({ ready: false }), deviceId: 'phone-b', staleOk: true }).kind, 'remote');
});

test('this device is a remote only while another online device plays', () => {
  assert.equal(isControllingAnotherDevice(view(), 'phone-b'), true);
  assert.equal(isControllingAnotherDevice(view({ activeDeviceOnline: false }), 'phone-b'), false);
  assert.equal(isControllingAnotherDevice(view(), 'web-a'), false);
  assert.equal(isControllingAnotherDevice(view(), null), false);
  assert.equal(isControllingAnotherDevice(null, 'phone-b'), false);
});

test('the offline notice names the device', () => {
  assert.equal(ownerOfflineMessage('Chrome on Windows'), 'Chrome on Windows is offline, so this plays here.');
});

function fakeSession(initial: ConnectView) {
  let current = initial;
  const listeners = new Set<(next: ConnectView) => void>();
  return {
    view: () => current,
    subscribe(listener: (next: ConnectView) => void) {
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
    publish(next: ConnectView) {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
    get listenerCount() { return listeners.size; }
  };
}

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    setTimeout: (callback: () => void) => { pending.set(++id, callback); return id; },
    clearTimeout: (handle: unknown) => { pending.delete(handle as number); },
    fireAll: () => { for (const [key, callback] of [...pending]) { pending.delete(key); callback(); } },
    get size() { return pending.size; }
  };
}

test('waiting for a fresh view ends when it arrives, and leaves nothing behind', async () => {
  const session = fakeSession(view({ ready: false }));
  const timers = fakeTimers();
  let settled = false;
  const waiting = whenRouteReady(session, timers).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  session.publish(view({ ready: true }));
  await waiting;
  assert.equal(settled, true);
  assert.equal(session.listenerCount, 0);
  assert.equal(timers.size, 0);
});

test('waiting for a fresh view gives up after its time and leaves nothing behind', async () => {
  const session = fakeSession(view({ ready: false }));
  const timers = fakeTimers();
  const waiting = whenRouteReady(session, timers);
  timers.fireAll();
  await waiting;
  assert.equal(session.listenerCount, 0);
});

test('a view that is already fresh needs no wait', async () => {
  const session = fakeSession(view());
  const timers = fakeTimers();
  await whenRouteReady(session, timers);
  assert.equal(timers.size, 0);
  assert.equal(session.listenerCount, 0);
});
