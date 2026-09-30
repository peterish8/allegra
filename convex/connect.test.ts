/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { Presence } from '@convex-dev/presence';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { describe, expect, it } from 'vitest';

import { api, components, internal } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};
const presence = new Presence(components.presence);

const song = {
  ref: 'saavn:catalog-song',
  title: 'A song for testing',
  artist: 'Allegra Test Artist',
  album: 'Connect tests',
  artwork: 'https://cdn.example.test/cover.jpg',
  duration: 213
};
const playerSnapshot = {
  song,
  queue: [],
  isPlaying: true,
  positionSec: 0,
  volume: 0.8,
  shuffle: false,
  repeat: 'off' as const
};

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

function asUser(t: ReturnType<typeof backend>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session` });
}

async function registerDevice(
  client: ReturnType<typeof asUser>,
  deviceId: string,
  canPlay = true
) {
  return await client.mutation(api.connect.register, {
    deviceId,
    name: deviceId,
    kind: 'web',
    appVersion: 'test',
    canPlay
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({
    data: expect.objectContaining({ code })
  });
}

describe('Connect backend', () => {
  it('requires auth and keeps device IDs owned by the account that registered them', async () => {
    const t = backend();
    await expectCode(t.query(api.connect.state, {}), 'unauthenticated');

    const owner = asUser(t, 'users:owner');
    const other = asUser(t, 'users:other');
    await registerDevice(owner, 'shared-install');

    await expectCode(
      registerDevice(other, 'shared-install'),
      'device_owned_by_another_account'
    );
    await expectCode(
      other.mutation(api.connect.send, {
        fromDeviceId: 'shared-install',
        targetDeviceId: 'shared-install',
        kind: 'pause'
      }),
      'device_owned_by_another_account'
    );
    expect(await other.query(api.connect.devices, {})).toEqual([]);
  });

  it('keeps one active player and rejects reports from the former device', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'browser');
    await registerDevice(client, 'phone');

    expect(await client.mutation(api.connect.claim, { deviceId: 'browser', snapshot: playerSnapshot })).toMatchObject({ rev: 1 });
    expect(await client.mutation(api.connect.claim, { deviceId: 'phone', snapshot: playerSnapshot })).toMatchObject({ rev: 2 });
    expect(await client.query(api.connect.state, {})).toMatchObject({ activeDeviceId: 'phone', rev: 2 });
    expect(await client.query(api.connect.devices, {})).toContainEqual(
      expect.objectContaining({ deviceId: 'phone', isActive: true })
    );

    await expectCode(
      client.mutation(api.connect.report, {
        deviceId: 'browser',
        patch: { isPlaying: false },
        rev: 2
      }),
      'device_not_active'
    );
  });

  it('uses Presence for online status and retains an offline active player', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'browser');
    await client.mutation(api.connect.claim, { deviceId: 'browser', snapshot: playerSnapshot });

    expect(await client.query(api.connect.devices, {})).toMatchObject([
      { deviceId: 'browser', isOnline: false, isActive: true }
    ]);
    await client.mutation(api.connect.heartbeat, { deviceId: 'browser' });
    expect(await client.query(api.connect.devices, {})).toMatchObject([
      { deviceId: 'browser', isOnline: true, isActive: true }
    ]);
  });

  it('delivers commands only to their target and exposes ack outcomes to the source device', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'remote');
    await registerDevice(client, 'player');
    const { commandId } = await client.mutation(api.connect.send, {
      fromDeviceId: 'remote',
      targetDeviceId: 'player',
      kind: 'pause'
    });

    expect(await client.query(api.connect.commandsFor, { deviceId: 'remote' })).toMatchObject([
      { commandId, sourceDeviceId: 'remote', targetDeviceId: 'player', kind: 'pause', status: 'pending' }
    ]);
    expect(await client.query(api.connect.commandsFor, { deviceId: 'player' })).toMatchObject([
      { commandId, sourceDeviceId: 'remote', targetDeviceId: 'player', kind: 'pause', status: 'pending' }
    ]);

    await expectCode(
      client.mutation(api.connect.ack, {
        deviceId: 'remote',
        commandId,
        ok: true
      }),
      'command_not_target'
    );
    expect(await client.mutation(api.connect.ack, {
      deviceId: 'player',
      commandId,
      ok: false,
      error: 'The player could not pause.'
    })).toMatchObject({ updated: true });
    expect(await client.mutation(api.connect.ack, {
      deviceId: 'player',
      commandId,
      ok: false
    })).toMatchObject({ updated: false });
    expect(await client.query(api.connect.commandsFor, { deviceId: 'remote' })).toMatchObject([
      { commandId, status: 'failed', error: 'The player could not pause.' }
    ]);
    expect(await client.query(api.connect.commandsFor, { deviceId: 'player' })).toEqual([]);
  });

  it('limits each account to 20 queued commands per fixed ten-second window', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'remote');
    await registerDevice(client, 'player');

    for (let index = 0; index < 20; index += 1) {
      await client.mutation(api.connect.send, {
        fromDeviceId: 'remote',
        targetDeviceId: 'player',
        kind: 'pause'
      });
    }
    await expectCode(
      client.mutation(api.connect.send, {
        fromDeviceId: 'remote',
        targetDeviceId: 'player',
        kind: 'pause'
      }),
      'rate_limited'
    );
    expect(await client.query(api.connect.commandsFor, { deviceId: 'remote' })).toHaveLength(20);
  });

  it('transfers the complete playback snapshot to another owned device', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'browser');
    await registerDevice(client, 'phone');
    await client.mutation(api.connect.claim, { deviceId: 'browser', snapshot: playerSnapshot });
    await client.mutation(api.connect.report, {
      deviceId: 'browser',
      patch: { positionSec: 37, queue: [song], shuffle: true, repeat: 'all' },
      rev: 1
    });

    const { commandId } = await client.mutation(api.connect.transfer, {
      fromDeviceId: 'browser',
      toDeviceId: 'phone'
    });
    expect(await client.query(api.connect.commandsFor, { deviceId: 'phone' })).toMatchObject([
      {
        commandId,
        kind: 'take_over',
        args: {
          state: {
            song,
            queue: [song],
            positionSec: 37,
            shuffle: true,
            repeat: 'all',
            rev: 2
          }
        }
      }
    ]);
  });

  it('sweeps expired commands and stale offline devices while retaining online devices', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'stale-device');
    await registerDevice(client, 'online-device');
    await registerDevice(client, 'recently-offline-device');
    await client.mutation(api.connect.heartbeat, { deviceId: 'online-device' });
    const recentSession = await t.run(async (ctx) =>
      await presence.heartbeat(ctx, 'connect:users:listener', 'recently-offline-device', 'recently-offline-device', 60_000)
    );
    await t.run(async (ctx) => await presence.disconnect(ctx, recentSession.sessionToken));

    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const stale = await ctx.db
        .query('devices')
        .withIndex('by_deviceId', (q) => q.eq('deviceId', 'stale-device'))
        .unique();
      const online = await ctx.db
        .query('devices')
        .withIndex('by_deviceId', (q) => q.eq('deviceId', 'online-device'))
        .unique();
      const recentlyOffline = await ctx.db
        .query('devices')
        .withIndex('by_deviceId', (q) => q.eq('deviceId', 'recently-offline-device'))
        .unique();
      if (!stale || !online || !recentlyOffline) throw new Error('test devices were not registered');
      await ctx.db.patch(stale._id, { retentionCheckedAt: thirtyOneDaysAgo });
      await ctx.db.patch(online._id, { retentionCheckedAt: thirtyOneDaysAgo });
      await ctx.db.patch(recentlyOffline._id, { retentionCheckedAt: thirtyOneDaysAgo });
      await ctx.db.insert('connectCommands', {
        userId: 'users:listener',
        sourceDeviceId: 'stale-device',
        targetDeviceId: 'online-device',
        issuedBy: 'users:listener',
        kind: 'pause',
        createdAt: Date.now() - 3 * 60 * 1000,
        status: 'failed',
        error: 'expired'
      });
    });

    const result = await t.mutation(internal.connect.sweep, {});
    expect(result).toMatchObject({ commandsRemoved: 1, devicesRemoved: 1, devicesChecked: 3 });
    const remaining = await t.run(async (ctx) =>
      await ctx.db.query('devices').withIndex('by_userId_and_createdAt', (q) => q.eq('userId', 'users:listener')).collect()
    );
    expect(remaining.map(({ deviceId }) => deviceId).sort()).toEqual(['online-device', 'recently-offline-device']);
    const offlineRecord = remaining.find(({ deviceId }) => deviceId === 'recently-offline-device');
    expect(offlineRecord?.retentionCheckedAt).toBeGreaterThan(thirtyOneDaysAgo);
  });
});
