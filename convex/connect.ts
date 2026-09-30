import { getAuthUserId } from '@convex-dev/auth/server';
import { Presence } from '@convex-dev/presence';
import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError, v, type Infer } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { connectCommandArgs, connectCommandKind, playerSnapshot, repeatMode, songSnapshot } from './schema';

const presence = new Presence(components.presence);
const rateLimiter = new RateLimiter(components.rateLimiter, {
  connectCommands: { kind: 'fixed window', rate: 20, period: 10_000 }
});

const commandKind = connectCommandKind;
const songQueue = v.array(songSnapshot);
const stateView = v.object({
  activeDeviceId: v.optional(v.string()),
  song: v.optional(songSnapshot),
  queue: songQueue,
  isPlaying: v.boolean(),
  positionSec: v.number(),
  positionAt: v.number(),
  volume: v.number(),
  shuffle: v.boolean(),
  repeat: repeatMode,
  rev: v.number()
});

const deviceView = v.object({
  deviceId: v.string(),
  name: v.string(),
  kind: v.union(v.literal('web'), v.literal('android'), v.literal('ios')),
  appVersion: v.string(),
  canPlay: v.boolean(),
  isOnline: v.boolean(),
  isActive: v.boolean()
});

const commandView = v.object({
  commandId: v.id('connectCommands'),
  sourceDeviceId: v.string(),
  targetDeviceId: v.string(),
  issuedBy: v.string(),
  kind: commandKind,
  args: v.optional(connectCommandArgs),
  createdAt: v.number(),
  status: v.literal('pending')
});
const commandHistoryView = v.object({
  commandId: v.id('connectCommands'),
  sourceDeviceId: v.string(),
  targetDeviceId: v.string(),
  issuedBy: v.string(),
  kind: commandKind,
  args: v.optional(connectCommandArgs),
  createdAt: v.number(),
  status: v.union(v.literal('pending'), v.literal('done'), v.literal('failed')),
  error: v.optional(v.string())
});

const statePatch = v.object({
  song: v.optional(songSnapshot),
  queue: v.optional(songQueue),
  isPlaying: v.optional(v.boolean()),
  positionSec: v.optional(v.number()),
  volume: v.optional(v.number()),
  shuffle: v.optional(v.boolean()),
  repeat: v.optional(repeatMode)
});

const errorData = {
  unauthenticated: 'Sign in to use Connect.',
  device_not_registered: 'Register this device before using Connect.',
  device_owned_by_another_account: 'This device ID belongs to another account.',
  invalid_command: 'The command arguments do not match the command type.',
  rate_limited: 'Too many Connect commands. Try again shortly.',
  player_state_missing: 'There is no player state to transfer.',
  device_not_active: 'Only the active device can report playback state.',
  stale_revision: 'This playback state is out of date. Read the latest state and retry.',
  command_not_found: 'The command no longer exists.',
  command_not_target: 'Only the target device can acknowledge this command.'
} as const;

type ConnectErrorCode = keyof typeof errorData;
type ConnectCommandKind = Infer<typeof commandKind>;
type ConnectSongSnapshot = Infer<typeof songSnapshot>;
type ConnectPlayerSnapshot = Infer<typeof playerSnapshot>;

function fail(code: ConnectErrorCode, details?: Record<string, number | string>): never {
  throw new ConvexError({ code, message: errorData[code], ...details });
}

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<string> {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) fail('unauthenticated');
  return String(authUserId);
}

async function requireOwnedDevice(ctx: QueryCtx | MutationCtx, userId: string, deviceId: string): Promise<Doc<'devices'>> {
  const device = await ctx.db
    .query('devices')
    .withIndex('by_deviceId', (q) => q.eq('deviceId', deviceId))
    .unique();
  if (!device) fail('device_not_registered');
  if (device.userId !== userId) fail('device_owned_by_another_account');
  return device;
}

async function findPlayerState(ctx: QueryCtx | MutationCtx, userId: string): Promise<Doc<'playerState'> | null> {
  return await ctx.db
    .query('playerState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

function assertQueue(queue: readonly unknown[]): void {
  if (queue.length > 50) fail('invalid_command');
  for (const song of queue) assertSongSnapshot(song as ConnectSongSnapshot);
}

function assertSongSnapshot(song: ConnectSongSnapshot): void {
  if (
    song.ref.trim().length < 1 || song.ref.length > 512 ||
    song.title.trim().length < 1 || song.title.length > 300 ||
    song.artist.trim().length < 1 || song.artist.length > 300 ||
    (song.album !== undefined && song.album.length > 300) ||
    song.artwork.length > 2048 ||
    !Number.isFinite(song.duration) || song.duration < 0
  ) {
    fail('invalid_command');
  }
}

function assertPlayerSnapshot(snapshot: ConnectPlayerSnapshot): void {
  if (snapshot.song) assertSongSnapshot(snapshot.song);
  assertQueue(snapshot.queue);
  if (
    !Number.isFinite(snapshot.positionSec) || snapshot.positionSec < 0 ||
    !Number.isFinite(snapshot.volume) || snapshot.volume < 0 || snapshot.volume > 1
  ) {
    fail('invalid_command');
  }
}

function assertCommandPair(kind: ConnectCommandKind, args: unknown): void {
  if (kind === 'take_over') fail('invalid_command');

  if (kind === 'seek') {
    if (!args || typeof args !== 'object' || !('sec' in args)) fail('invalid_command');
    const sec = (args as { sec: unknown }).sec;
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) fail('invalid_command');
    return;
  }
  if (kind === 'volume') {
    if (!args || typeof args !== 'object' || !('v' in args)) fail('invalid_command');
    const volume = (args as { v: unknown }).v;
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) fail('invalid_command');
    return;
  }
  if (kind === 'shuffle') {
    if (!args || typeof args !== 'object' || !('on' in args) || typeof (args as { on: unknown }).on !== 'boolean') {
      fail('invalid_command');
    }
    return;
  }
  if (kind === 'repeat') {
    if (!args || typeof args !== 'object' || !('mode' in args)) fail('invalid_command');
    const mode = (args as { mode: unknown }).mode;
    if (mode !== 'off' && mode !== 'all' && mode !== 'one') fail('invalid_command');
    return;
  }
  if (kind === 'play_song' || kind === 'queue_add') {
    if (!args || typeof args !== 'object' || !('song' in args)) fail('invalid_command');
    assertSongSnapshot((args as { song: ConnectSongSnapshot }).song);
    const queue = (args as { queue?: unknown }).queue;
    if (kind === 'queue_add' && queue !== undefined) fail('invalid_command');
    if (queue !== undefined) {
      if (!Array.isArray(queue)) fail('invalid_command');
      assertQueue(queue);
    }
    return;
  }
  if (args !== undefined) fail('invalid_command');
}

async function enqueue(
  ctx: MutationCtx,
  userId: string,
  targetDeviceId: string,
  sourceDeviceId: string,
  kind: ConnectCommandKind,
  args: Doc<'connectCommands'>['args']
): Promise<{ commandId: Doc<'connectCommands'>['_id']; serverNow: number }> {
  const now = Date.now();
  const status = await rateLimiter.limit(ctx, 'connectCommands', { key: userId });
  if (!status.ok) fail('rate_limited', { retryAfterMs: status.retryAfter ?? 0 });

  const commandId = await ctx.db.insert('connectCommands', {
    userId,
    targetDeviceId,
    sourceDeviceId,
    issuedBy: userId,
    kind,
    ...(args === undefined ? {} : { args }),
    createdAt: now,
    status: 'pending'
  });
  return { commandId, serverNow: now };
}

/** Register stable metadata for the signed-in device. */
export const register = mutation({
  args: {
    deviceId: v.string(),
    name: v.string(),
    kind: v.union(v.literal('web'), v.literal('android'), v.literal('ios')),
    appVersion: v.string(),
    canPlay: v.boolean()
  },
  returns: v.object({ serverNow: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (
      args.deviceId.length < 1 || args.deviceId.length > 128 ||
      args.name.trim().length < 1 || args.name.length > 80 ||
      args.appVersion.length > 40
    ) {
      fail('invalid_command');
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('devices')
      .withIndex('by_deviceId', (q) => q.eq('deviceId', args.deviceId))
      .unique();
    if (existing && existing.userId !== userId) fail('device_owned_by_another_account');
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name.trim(),
        kind: args.kind,
        appVersion: args.appVersion,
        canPlay: args.canPlay,
        retentionCheckedAt: now
      });
    } else {
      await ctx.db.insert('devices', {
        userId,
        deviceId: args.deviceId,
        name: args.name.trim(),
        kind: args.kind,
        appVersion: args.appVersion,
        canPlay: args.canPlay,
        createdAt: now,
        retentionCheckedAt: now
      });
    }
    return { serverNow: now };
  }
});

/** Keep the registered device online in its account-specific Presence room. */
export const heartbeat = mutation({
  args: { deviceId: v.string() },
  returns: v.object({ serverNow: v.number() }),
  handler: async (ctx, { deviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    const now = Date.now();
    await presence.heartbeat(ctx, `connect:${userId}`, deviceId, deviceId, 60_000);
    return { serverNow: now };
  }
});

/** Devices are online according to Presence, never a query-time clock comparison. */
export const devices = query({
  args: {},
  returns: v.array(deviceView),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const [registered, player, onlinePresence] = await Promise.all([
      ctx.db
        .query('devices')
        .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
        .order('desc')
        .take(100),
      findPlayerState(ctx, userId),
      presence.listRoom(ctx, `connect:${userId}`, true, 100)
    ]);
    const online = new Set(onlinePresence.map(({ userId: deviceId }) => deviceId));
    const activeDeviceId = player?.activeDeviceId;
    const byId = new Map(registered.map((device) => [device.deviceId, device]));
    if (activeDeviceId && !byId.has(activeDeviceId)) {
      const active = await ctx.db
        .query('devices')
        .withIndex('by_deviceId', (q) => q.eq('deviceId', activeDeviceId))
        .unique();
      if (active?.userId === userId) byId.set(active.deviceId, active);
    }
    return [...byId.values()]
      .filter((device) => online.has(device.deviceId) || device.deviceId === activeDeviceId)
      .map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        kind: device.kind,
        appVersion: device.appVersion,
        canPlay: device.canPlay,
        isOnline: online.has(device.deviceId),
        isActive: device.deviceId === activeDeviceId
      }));
  }
});

/** Read this account's current cross-device playback state. */
export const state = query({
  args: {},
  returns: v.union(v.null(), stateView),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const player = await findPlayerState(ctx, userId);
    if (!player) return null;
    return {
      ...(player.activeDeviceId ? { activeDeviceId: player.activeDeviceId } : {}),
      ...(player.song ? { song: player.song } : {}),
      queue: player.queue,
      isPlaying: player.isPlaying,
      positionSec: player.positionSec,
      positionAt: player.positionAt,
      volume: player.volume,
      shuffle: player.shuffle,
      repeat: player.repeat,
      rev: player.rev
    };
  }
});

/** Read pending commands addressed to an owned device, oldest first. */
export const pendingFor = query({
  args: { deviceId: v.string() },
  returns: v.array(commandView),
  handler: async (ctx, { deviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    const rows = await ctx.db
      .query('connectCommands')
      .withIndex('by_targetDeviceId_and_status', (q) => q.eq('targetDeviceId', deviceId).eq('status', 'pending'))
      .order('asc')
      .take(50);
      return rows
        .filter((row) => row.userId === userId)
        .map((row) => ({
          commandId: row._id,
          sourceDeviceId: row.sourceDeviceId,
          targetDeviceId: row.targetDeviceId,
        issuedBy: row.issuedBy,
        kind: row.kind,
        ...(row.args ? { args: row.args } : {}),
        createdAt: row.createdAt,
        status: 'pending' as const
      }));
  }
});

/** Read incoming work and this device's recent command outcomes for acknowledgement UI. */
export const commandsFor = query({
  args: { deviceId: v.string() },
  returns: v.array(commandHistoryView),
  handler: async (ctx, { deviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    const [incoming, outgoing] = await Promise.all([
      ctx.db
        .query('connectCommands')
        .withIndex('by_targetDeviceId_and_status', (q) => q.eq('targetDeviceId', deviceId).eq('status', 'pending'))
        .order('asc')
        .take(50),
      ctx.db
        .query('connectCommands')
        .withIndex('by_sourceDeviceId_and_createdAt', (q) => q.eq('sourceDeviceId', deviceId))
        .order('desc')
        .take(50)
    ]);
    const rows = new Map<string, Doc<'connectCommands'>>();
    for (const row of [...incoming, ...outgoing]) {
      if (row.userId === userId) rows.set(row._id, row);
    }
    return [...rows.values()]
      .sort((a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id)))
      .map((row) => ({
        commandId: row._id,
        sourceDeviceId: row.sourceDeviceId,
        targetDeviceId: row.targetDeviceId,
        issuedBy: row.issuedBy,
        kind: row.kind,
        ...(row.args ? { args: row.args } : {}),
        createdAt: row.createdAt,
        status: row.status,
        ...(row.error ? { error: row.error } : {})
      }));
  }
});

/** The active player uses optimistic revision checks to prevent stale writes. */
export const report = mutation({
  args: {
    deviceId: v.string(),
    patch: statePatch,
    rev: v.number()
  },
  returns: v.object({ rev: v.number(), serverNow: v.number() }),
  handler: async (ctx, { deviceId, patch, rev }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    const player = await findPlayerState(ctx, userId);
    if (!player || player.activeDeviceId !== deviceId) fail('device_not_active');
    if (!Number.isInteger(rev) || player.rev !== rev) fail('stale_revision', { currentRev: player.rev });
    if (Object.values(patch).every((value) => value === undefined)) fail('invalid_command');
    if (patch.queue) assertQueue(patch.queue);
    if (patch.song) assertSongSnapshot(patch.song);
    if (patch.positionSec !== undefined && (!Number.isFinite(patch.positionSec) || patch.positionSec < 0)) {
      fail('invalid_command');
    }
    if (patch.volume !== undefined && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 1)) {
      fail('invalid_command');
    }
    const now = Date.now();
    await ctx.db.patch(player._id, { ...patch, positionAt: now, rev: player.rev + 1 });
    return { rev: player.rev + 1, serverNow: now };
  }
});

/** Claiming playback switches the single active-player lease for this account. */
export const claim = mutation({
  args: { deviceId: v.string(), snapshot: playerSnapshot },
  returns: v.object({ rev: v.number(), serverNow: v.number() }),
  handler: async (ctx, { deviceId, snapshot }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    assertPlayerSnapshot(snapshot);
    const now = Date.now();
    const player = await findPlayerState(ctx, userId);
    if (player) {
      const rev = player.rev + 1;
      await ctx.db.patch(player._id, {
        activeDeviceId: deviceId,
        song: snapshot.song,
        queue: snapshot.queue,
        isPlaying: snapshot.isPlaying,
        positionSec: snapshot.positionSec,
        positionAt: now,
        volume: snapshot.volume,
        shuffle: snapshot.shuffle,
        repeat: snapshot.repeat,
        rev
      });
      return { rev, serverNow: now };
    }
    const rev = 1;
    await ctx.db.insert('playerState', {
      userId,
      activeDeviceId: deviceId,
      ...(snapshot.song ? { song: snapshot.song } : {}),
      queue: snapshot.queue,
      isPlaying: snapshot.isPlaying,
      positionSec: snapshot.positionSec,
      positionAt: now,
      volume: snapshot.volume,
      shuffle: snapshot.shuffle,
      repeat: snapshot.repeat,
      rev
    });
    return { rev, serverNow: now };
  }
});

/** Queue one remote command after account ownership and rate-limit checks. */
export const send = mutation({
  args: {
    fromDeviceId: v.string(),
    targetDeviceId: v.string(),
    kind: commandKind,
    args: v.optional(connectCommandArgs)
  },
  returns: v.object({ commandId: v.id('connectCommands'), serverNow: v.number() }),
  handler: async (ctx, { fromDeviceId, targetDeviceId, kind, args }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, fromDeviceId);
    await requireOwnedDevice(ctx, userId, targetDeviceId);
    assertCommandPair(kind, args);
    return enqueue(ctx, userId, targetDeviceId, fromDeviceId, kind, args);
  }
});

/** Only the addressed device can complete its queued command. */
export const ack = mutation({
  args: {
    deviceId: v.string(),
    commandId: v.id('connectCommands'),
    ok: v.boolean(),
    error: v.optional(v.string())
  },
  returns: v.object({ updated: v.boolean(), serverNow: v.number() }),
  handler: async (ctx, { deviceId, commandId, ok, error }) => {
    const userId = await requireUser(ctx);
    const command = await ctx.db.get(commandId);
    if (!command || command.userId !== userId) fail('command_not_found');
    if (command.targetDeviceId !== deviceId) fail('command_not_target');
    await requireOwnedDevice(ctx, userId, deviceId);
    const now = Date.now();
    if (command.status !== 'pending') return { updated: false, serverNow: now };
    await ctx.db.patch(command._id, {
      status: ok ? 'done' : 'failed',
      ...(!ok && error ? { error: error.slice(0, 240) } : {})
    });
    return { updated: true, serverNow: now };
  }
});

/** Ask another owned device to load the current player state and claim playback. */
export const transfer = mutation({
  args: { fromDeviceId: v.string(), toDeviceId: v.string() },
  returns: v.object({ commandId: v.id('connectCommands'), serverNow: v.number() }),
  handler: async (ctx, { fromDeviceId, toDeviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, fromDeviceId);
    await requireOwnedDevice(ctx, userId, toDeviceId);
    const player = await findPlayerState(ctx, userId);
    if (!player) fail('player_state_missing');
    const stateSnapshot = {
      ...(player.song ? { song: player.song } : {}),
      queue: player.queue,
      isPlaying: player.isPlaying,
      positionSec: player.positionSec,
      positionAt: player.positionAt,
      volume: player.volume,
      shuffle: player.shuffle,
      repeat: player.repeat,
      rev: player.rev
    };
    return enqueue(ctx, userId, toDeviceId, fromDeviceId, 'take_over', { state: stateSnapshot });
  }
});

/** Remove expired commands and stale device registrations in small transactions. */
export const sweep = internalMutation({
  args: {},
  returns: v.object({ commandsRemoved: v.number(), devicesRemoved: v.number(), devicesChecked: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const commandCutoff = now - 2 * MINUTE;
    const staleCommands = await ctx.db
      .query('connectCommands')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', commandCutoff))
      .take(500);
    for (const command of staleCommands) await ctx.db.delete(command._id);

    const deviceCutoff = now - 30 * 24 * 60 * MINUTE;
    const staleCandidates = await ctx.db
      .query('devices')
      .withIndex('by_retentionCheckedAt', (q) => q.lt('retentionCheckedAt', deviceCutoff))
      .take(10);
    let devicesRemoved = 0;
    for (const device of staleCandidates) {
      const room = `connect:${device.userId}`;
      const roomPresence = await presence.listRoom(ctx, room, false, 1000);
      const entry = roomPresence.find(({ userId: presenceUserId }) => presenceUserId === device.deviceId);
      if (!entry && roomPresence.length >= 1000) {
        // Do not infer that a session is absent when a large room reached the read cap.
        await ctx.db.patch(device._id, { retentionCheckedAt: now });
      } else if (!entry || (!entry.online && entry.lastDisconnected <= deviceCutoff)) {
        await ctx.db.delete(device._id);
        if (entry) await presence.removeRoomUser(ctx, room, device.deviceId);
        devicesRemoved += 1;
      } else if (!entry.online) {
        // Recheck when this session reaches its 30-day offline retention limit.
        await ctx.db.patch(device._id, { retentionCheckedAt: entry.lastDisconnected });
      } else {
        // Online devices are checked again after another 30 days.
        await ctx.db.patch(device._id, { retentionCheckedAt: now });
      }
    }

    if (staleCommands.length === 500 || staleCandidates.length === 10) {
      await ctx.scheduler.runAfter(0, internal.connect.sweep, {});
    }
    return {
      commandsRemoved: staleCommands.length,
      devicesRemoved,
      devicesChecked: staleCandidates.length
    };
  }
});
