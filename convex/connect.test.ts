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

async function registerV2Device(
  client: ReturnType<typeof asUser>,
  deviceId: string,
  canPlay = true,
  protocolVersion = 2
) {
  return await client.mutation(api.connect.register, {
    deviceId,
    name: deviceId,
    kind: 'web',
    appVersion: 'test-v2',
    canPlay,
    protocolVersion
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

  it('marks a registered device online immediately through Presence', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'browser');
    await client.mutation(api.connect.claim, { deviceId: 'browser', snapshot: playerSnapshot });

    expect(await client.query(api.connect.devices, {})).toMatchObject([
      { deviceId: 'browser', isOnline: true, isActive: true }
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

  it('deduplicates V2 requests, rejects changed retries, and refuses a legacy active target', async () => {
    const t = backend();
    const client = asUser(t, 'users:v2-listener');
    await registerV2Device(client, 'browser-v2');
    await registerV2Device(client, 'phone-v2');
    await registerDevice(client, 'legacy-device');
    const claim = await client.mutation(api.connect.claim, { deviceId: 'browser-v2', snapshot: playerSnapshot });
    expect(claim.ownershipEpoch).toBe(1);

    const input = {
      fromDeviceId: 'phone-v2',
      targetDeviceId: 'browser-v2',
      requestId: 'stable-request-01',
      expectedOwnershipEpoch: claim.ownershipEpoch,
      kind: 'pause' as const
    };
    const first = await client.mutation(api.connect.sendV2, input);
    const retry = await client.mutation(api.connect.sendV2, input);
    expect(retry.commandId).toBe(first.commandId);
    expect(await client.query(api.connect.inboxFor, { deviceId: 'browser-v2' })).toMatchObject([
      { commandId: first.commandId, requestId: input.requestId, expectedOwnershipEpoch: 1 }
    ]);
    await expectCode(client.mutation(api.connect.sendV2, { ...input, kind: 'play' }), 'request_conflict');

    const legacyClaim = await client.mutation(api.connect.claim, {
      deviceId: 'legacy-device', snapshot: playerSnapshot, expectedOwnershipEpoch: 1
    });
    await expectCode(client.mutation(api.connect.sendV2, {
      ...input,
      requestId: 'another-request-02',
      targetDeviceId: 'legacy-device',
      expectedOwnershipEpoch: legacyClaim.ownershipEpoch
    }), 'update_required');
  });

  it('reserves commands, leaves conflicts pending, and applies only the rebased completion', async () => {
    const t = backend();
    const client = asUser(t, 'users:v2-completion');
    await registerV2Device(client, 'active');
    await registerV2Device(client, 'remote');
    const claim = await client.mutation(api.connect.claim, { deviceId: 'active', snapshot: playerSnapshot });
    const sent = await client.mutation(api.connect.sendV2, {
      fromDeviceId: 'remote', targetDeviceId: 'active', requestId: 'completion-req-1',
      expectedOwnershipEpoch: claim.ownershipEpoch, kind: 'pause'
    });
    const firstBegin = await client.mutation(api.connect.beginV2, { deviceId: 'active', commandId: sent.commandId });
    const retryBegin = await client.mutation(api.connect.beginV2, { deviceId: 'active', commandId: sent.commandId });
    expect(retryBegin.reservationToken).toBe(firstBegin.reservationToken);

    const current = await client.query(api.connect.state, {});
    if (!current) throw new Error('claimed player state was missing');
    const report = await client.mutation(api.connect.report, {
      deviceId: 'active', patch: { volume: 0.5 }, rev: current.rev,
      expectedOwnershipEpoch: current.ownershipEpoch
    });
    expect(await client.mutation(api.connect.completeV2, {
      deviceId: 'active', commandId: sent.commandId, reservationToken: firstBegin.reservationToken,
      outcome: { ok: true }, patch: { isPlaying: false, positionSec: 12 }, rev: current.rev
    })).toMatchObject({ status: 'conflict', currentRev: report.rev });
    expect(await client.query(api.connect.inboxFor, { deviceId: 'active' })).toMatchObject([
      { commandId: sent.commandId, reservationToken: firstBegin.reservationToken }
    ]);

    const completed = await client.mutation(api.connect.completeV2, {
      deviceId: 'active', commandId: sent.commandId, reservationToken: firstBegin.reservationToken,
      outcome: { ok: true }, patch: { isPlaying: false, positionSec: 12 }, rev: report.rev
    });
    expect(completed).toMatchObject({ status: 'completed', rev: report.rev + 1 });
    if (completed.status !== 'completed') throw new Error('completion unexpectedly conflicted');
    expect(await client.mutation(api.connect.completeV2, {
      deviceId: 'active', commandId: sent.commandId, reservationToken: firstBegin.reservationToken,
      outcome: { ok: true }, patch: { positionSec: 99 }, rev: report.rev
    })).toMatchObject({ status: 'completed', rev: completed.rev });
    const outcomes = await client.query(api.connect.outcomesFor, { deviceId: 'remote' });
    expect(outcomes).toMatchObject([{ commandId: sent.commandId, status: 'done', requestId: 'completion-req-1' }]);
    expect(outcomes[0]).not.toHaveProperty('args');
  });

  it('waits for a legacy playing owner to confirm pause and never activates an unreachable source', async () => {
    const t = backend();
    const client = asUser(t, 'users:v2-transfer');
    await registerDevice(client, 'legacy-owner');
    await registerV2Device(client, 'v2-destination');
    const claim = await client.mutation(api.connect.claim, { deviceId: 'legacy-owner', snapshot: playerSnapshot });
    const sent = await client.mutation(api.connect.transferV2, {
      fromDeviceId: 'legacy-owner', toDeviceId: 'v2-destination', requestId: 'transfer-req-01',
      expectedOwnershipEpoch: claim.ownershipEpoch
    });
    const begun = await client.mutation(api.connect.beginV2, { deviceId: 'v2-destination', commandId: sent.commandId });
    expect(await client.mutation(api.connect.prepareV2, {
      deviceId: 'v2-destination', commandId: sent.commandId, reservationToken: begun.reservationToken
    })).toMatchObject({ status: 'awaiting_release' });
    expect(await client.query(api.connect.state, {})).toMatchObject({
      activeDeviceId: 'legacy-owner', isPlaying: true, ownershipEpoch: claim.ownershipEpoch,
      handoff: { commandId: sent.commandId, toDeviceId: 'v2-destination' }
    });

    await client.mutation(api.connect.completeV2, {
      deviceId: 'v2-destination', commandId: sent.commandId, reservationToken: begun.reservationToken,
      outcome: { ok: false, code: 'owner_unreachable' }
    });
    expect(await client.query(api.connect.state, {})).toMatchObject({
      activeDeviceId: 'legacy-owner', isPlaying: true, ownershipEpoch: claim.ownershipEpoch
    });
    expect(await client.query(api.connect.outcomesFor, { deviceId: 'legacy-owner' })).toMatchObject([
      { commandId: sent.commandId, status: 'failed', errorCode: 'owner_unreachable' }
    ]);
  });

  it('sends a V2 transfer with the epoch it was queued under', async () => {
    // Android builds from a8577af drop a take_over whose state has no ownershipEpoch, so the
    // transfer never starts and expires 60 s later. Keep sending it.
    const t = backend();
    const client = asUser(t, 'users:v2-epoch');
    await registerV2Device(client, 'laptop');
    await registerV2Device(client, 'phone');
    const claim = await client.mutation(api.connect.claim, { deviceId: 'laptop', snapshot: playerSnapshot });
    const sent = await client.mutation(api.connect.transferV2, {
      fromDeviceId: 'laptop', toDeviceId: 'phone', requestId: 'epoch-transfer-1',
      expectedOwnershipEpoch: claim.ownershipEpoch
    });
    expect(await client.query(api.connect.inboxFor, { deviceId: 'phone' })).toMatchObject([
      {
        commandId: sent.commandId,
        kind: 'take_over',
        expectedOwnershipEpoch: claim.ownershipEpoch,
        args: { state: { song, rev: claim.rev, ownershipEpoch: claim.ownershipEpoch } }
      }
    ]);

    // The sender learns the target picked it up, so it waits for the deadline instead of 4 s.
    expect((await client.query(api.connect.outcomesFor, { deviceId: 'laptop' }))[0]).not.toHaveProperty('began');
    await client.mutation(api.connect.beginV2, { deviceId: 'phone', commandId: sent.commandId });
    expect(await client.query(api.connect.outcomesFor, { deviceId: 'laptop' })).toMatchObject([
      { commandId: sent.commandId, status: 'pending', began: true }
    ]);
  });

  it('takes playback from a playing owner that has gone offline, where the song would have reached', async () => {
    const t = backend();
    const client = asUser(t, 'users:v2-dead-owner');
    await registerV2Device(client, 'closed-laptop');
    await registerV2Device(client, 'phone');
    const claim = await client.mutation(api.connect.claim, {
      deviceId: 'closed-laptop', snapshot: { ...playerSnapshot, positionSec: 30 }
    });
    // The laptop's heartbeats ran out: Presence counts it offline, the stored state still says playing.
    await t.run(async (ctx) => {
      const { sessionToken } = await presence.heartbeat(ctx, 'connect:users:v2-dead-owner', 'closed-laptop', 'closed-laptop', 60_000);
      await presence.disconnect(ctx, sessionToken);
    });
    expect(await client.query(api.connect.devices, {})).toContainEqual(
      expect.objectContaining({ deviceId: 'closed-laptop', isOnline: false, isActive: true })
    );

    const sent = await client.mutation(api.connect.transferV2, {
      fromDeviceId: 'phone', toDeviceId: 'phone', requestId: 'dead-owner-pull-1',
      expectedOwnershipEpoch: claim.ownershipEpoch
    });
    const begun = await client.mutation(api.connect.beginV2, { deviceId: 'phone', commandId: sent.commandId });
    const prepared = await client.mutation(api.connect.prepareV2, {
      deviceId: 'phone', commandId: sent.commandId, reservationToken: begun.reservationToken
    });

    expect(prepared).toMatchObject({ status: 'activated', resume: true, ownershipEpoch: claim.ownershipEpoch + 1 });
    if (prepared.status !== 'activated') throw new Error('the transfer waited for an owner that cannot answer');
    expect(prepared.positionSec).toBeGreaterThanOrEqual(30);
    expect(await client.query(api.connect.state, {})).toMatchObject({
      activeDeviceId: 'phone', isPlaying: false, ownershipEpoch: claim.ownershipEpoch + 1
    });
    // The laptop wakes up later: its report is refused, which is what stops its audio.
    await expectCode(client.mutation(api.connect.report, {
      deviceId: 'closed-laptop', patch: { positionSec: 99 }, rev: claim.rev, expectedOwnershipEpoch: claim.ownershipEpoch
    }), 'device_not_active');
  });

  it('takes a leaving device offline at once and pauses the playback it owned', async () => {
    const t = backend();
    const client = asUser(t, 'users:leaving');
    await registerV2Device(client, 'laptop');
    await registerV2Device(client, 'phone');
    await client.mutation(api.connect.claim, { deviceId: 'laptop', snapshot: { ...playerSnapshot, positionSec: 12 } });

    await client.mutation(api.connect.disconnect, { deviceId: 'phone' });
    expect((await client.query(api.connect.devices, {})).map(({ deviceId }) => deviceId)).toEqual(['laptop']);
    expect(await client.query(api.connect.state, {})).toMatchObject({ isPlaying: true, rev: 1 });

    await client.mutation(api.connect.disconnect, { deviceId: 'laptop' });
    expect(await client.query(api.connect.devices, {})).toMatchObject([
      { deviceId: 'laptop', isOnline: false, isActive: true }
    ]);
    const paused = await client.query(api.connect.state, {});
    expect(paused).toMatchObject({ activeDeviceId: 'laptop', isPlaying: false, rev: 2 });
    expect(paused?.positionSec).toBeGreaterThanOrEqual(12);

    // Coming back is an ordinary register.
    await registerV2Device(client, 'phone');
    expect((await client.query(api.connect.devices, {})).map(({ deviceId }) => deviceId).sort()).toEqual(['laptop', 'phone']);
    await expectCode(asUser(t, 'users:someone-else').mutation(api.connect.disconnect, { deviceId: 'laptop' }), 'device_owned_by_another_account');
  });

  it('queues queue edits for a device that understands them and refuses them for an older app', async () => {
    const t = backend();
    const client = asUser(t, 'users:queue-edits');
    await registerV2Device(client, 'player', true, 3);
    await registerV2Device(client, 'old-player', true, 2);
    await registerV2Device(client, 'remote', true, 3);
    const claim = await client.mutation(api.connect.claim, { deviceId: 'player', snapshot: playerSnapshot });
    const base = { fromDeviceId: 'remote', targetDeviceId: 'player', expectedOwnershipEpoch: claim.ownershipEpoch };

    await client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-01', kind: 'queue_add', args: { song, next: true } });
    await client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-02', kind: 'queue_remove', args: { index: 0, ref: song.ref } });
    await client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-03', kind: 'queue_move', args: { from: 2, to: 0, ref: song.ref } });
    await client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-04', kind: 'queue_clear' });
    await client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-05', kind: 'play_song', args: { song, positionSec: 42 } });
    const inbox = await client.query(api.connect.inboxFor, { deviceId: 'player' });
    expect(inbox.map(({ kind }) => kind)).toEqual(['queue_add', 'queue_remove', 'queue_move', 'queue_clear', 'play_song']);
    expect(inbox.map(({ args }) => args)).toEqual([
      { song, next: true },
      { index: 0, ref: song.ref },
      { from: 2, to: 0, ref: song.ref },
      undefined,
      { song, positionSec: 42 }
    ]);

    await expectCode(client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-06', kind: 'queue_remove', args: { index: -1, ref: song.ref } }), 'invalid_command');
    await expectCode(client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-07', kind: 'queue_move', args: { from: 0, to: 50, ref: song.ref } }), 'invalid_command');
    await expectCode(client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-08', kind: 'queue_clear', args: { index: 0, ref: song.ref } }), 'invalid_command');
    await expectCode(client.mutation(api.connect.sendV2, { ...base, requestId: 'queue-edit-09', kind: 'play_song', args: { song, positionSec: -1 } }), 'invalid_command');

    const oldClaim = await client.mutation(api.connect.claim, { deviceId: 'old-player', snapshot: playerSnapshot });
    const old = { fromDeviceId: 'remote', targetDeviceId: 'old-player', expectedOwnershipEpoch: oldClaim.ownershipEpoch };
    await expectCode(client.mutation(api.connect.sendV2, { ...old, requestId: 'queue-edit-10', kind: 'queue_clear' }), 'update_required');
    // It reads a play-next as a plain add, so that one still goes through.
    await client.mutation(api.connect.sendV2, { ...old, requestId: 'queue-edit-11', kind: 'queue_add', args: { song, next: true } });
  });

  it('sweeps stale offline devices while retaining current registrations', async () => {
    const t = backend();
    const client = asUser(t, 'users:listener');
    await registerDevice(client, 'online-device');
    await registerDevice(client, 'recently-registered-device');
    await client.mutation(api.connect.heartbeat, { deviceId: 'online-device' });

    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const online = await ctx.db
        .query('devices')
        .withIndex('by_deviceId', (q) => q.eq('deviceId', 'online-device'))
        .unique();
      if (!online) throw new Error('online test device was not registered');
      await ctx.db.insert('devices', {
        userId: 'users:listener',
        deviceId: 'stale-device',
        name: 'stale-device',
        kind: 'web',
        appVersion: 'test',
        canPlay: true,
        createdAt: thirtyOneDaysAgo,
        retentionCheckedAt: thirtyOneDaysAgo
      });
      await ctx.db.patch(online._id, { retentionCheckedAt: thirtyOneDaysAgo });
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
    expect(result).toMatchObject({ commandsRemoved: 1, devicesRemoved: 1, devicesChecked: 2 });
    const remaining = await t.run(async (ctx) =>
      await ctx.db.query('devices').withIndex('by_userId_and_createdAt', (q) => q.eq('userId', 'users:listener')).collect()
    );
    expect(remaining.map(({ deviceId }) => deviceId).sort()).toEqual(['online-device', 'recently-registered-device']);
  });
});
