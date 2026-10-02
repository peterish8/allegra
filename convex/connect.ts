/**
 * Connect: cross-device playback control. The wire contract is docs/connect-contract.md.
 *
 * Three documents per account carry the state:
 * - `connectOwnership`: who plays, and the epoch that moves on whenever that changes.
 * - `playerState`: what is playing. Changes with every position report.
 * - `connectCommands`: the queue between devices.
 *
 * V2 commands are fenced three ways: the sender names the epoch it saw, the server sets a
 * deadline, and the target reserves the command (beginV2) before touching its player. A command
 * from an older epoch, or past its deadline, is never begun and never completed as a success.
 *
 * A mutation that throws commits nothing, so a refusal (expired, superseded) cannot also record
 * the failure. The record is written by whichever transaction does commit: the claim that ended
 * the epoch, the job scheduled for the command's deadline, a completion, or the sweep.
 */
import { getAuthUserId } from '@convex-dev/auth/server';
import { Presence } from '@convex-dev/presence';
import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError, v, type Infer } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { assertSongSnapshot, connectCommandArgs, connectCommandKind, playerSnapshot, repeatMode, songSnapshot } from './schema';

const presence = new Presence(components.presence);
const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per account: every queued command, legacy or V2.
  connectCommands: { kind: 'fixed window', rate: 20, period: 10_000 },
  // Per device: sized so normal use never reaches them and a runaway loop does.
  connectClaim: { kind: 'token bucket', rate: 12, period: MINUTE, capacity: 6 },
  connectReport: { kind: 'token bucket', rate: 60, period: MINUTE, capacity: 20 },
  connectRegister: { kind: 'token bucket', rate: 10, period: MINUTE, capacity: 5 },
  connectHeartbeat: { kind: 'token bucket', rate: 4, period: MINUTE, capacity: 3 },
  connectDisconnect: { kind: 'token bucket', rate: 10, period: MINUTE, capacity: 5 }
});
type DeviceLimit = 'connectClaim' | 'connectReport' | 'connectRegister' | 'connectHeartbeat' | 'connectDisconnect';

/** Devices that send this or more use the V2 functions. A device with no version is legacy (1). */
const PROTOCOL_V2 = 2;
/** Devices that send this or more run `queue_remove`, `queue_move` and `queue_clear`; older apps drop them unread. */
const PROTOCOL_QUEUE_EDIT = 3;
const QUEUE_LIMIT = 50;
const HEARTBEAT_INTERVAL_MS = 60_000;
/** How long a command may wait before it must not run: controls, then anything that loads a song. */
const CONTROL_DEADLINE_MS = 15_000;
const LOADING_DEADLINE_MS = 60_000;
/** A legacy command has no deadline of its own; it lives as long as its row. */
const LEGACY_COMMAND_TTL_MS = 2 * MINUTE;
/** Finished V2 commands stay this long, so a retried request id still finds its command. */
const V2_RETENTION_MS = 10 * MINUTE;
/** The sweep fails a pending V2 command this long after its deadline (the deadline job normally got there first). */
const SWEEP_EXPIRY_GRACE_MS = MINUTE;

const commandKind = connectCommandKind;
const deviceKind = v.union(v.literal('web'), v.literal('android'), v.literal('ios'));
const songQueue = v.array(songSnapshot);
const commandStatus = v.union(v.literal('pending'), v.literal('done'), v.literal('failed'));
const releaseView = v.object({ positionSec: v.number(), resume: v.boolean() });

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
  rev: v.number(),
  ownershipEpoch: v.number(),
  handoff: v.optional(v.object({ commandId: v.id('connectCommands'), toDeviceId: v.string() }))
});

const deviceView = v.object({
  deviceId: v.string(),
  name: v.string(),
  kind: deviceKind,
  appVersion: v.string(),
  canPlay: v.boolean(),
  isOnline: v.boolean(),
  isActive: v.boolean(),
  protocolVersion: v.number()
});

/** Legacy: what commandsFor returns. */
const commandHistoryView = v.object({
  commandId: v.id('connectCommands'),
  sourceDeviceId: v.string(),
  targetDeviceId: v.string(),
  issuedBy: v.string(),
  kind: commandKind,
  args: v.optional(connectCommandArgs),
  createdAt: v.number(),
  status: commandStatus,
  error: v.optional(v.string())
});

const inboxRow = v.object({
  commandId: v.id('connectCommands'),
  sourceDeviceId: v.string(),
  kind: commandKind,
  args: v.optional(connectCommandArgs),
  createdAt: v.number(),
  requestId: v.optional(v.string()),
  executeBefore: v.optional(v.number()),
  expectedOwnershipEpoch: v.optional(v.number()),
  reservationToken: v.optional(v.string()),
  release: v.optional(releaseView)
});

const outcomeRow = v.object({
  commandId: v.id('connectCommands'),
  requestId: v.optional(v.string()),
  targetDeviceId: v.string(),
  kind: commandKind,
  createdAt: v.number(),
  status: commandStatus,
  began: v.optional(v.boolean()),
  error: v.optional(v.string()),
  errorCode: v.optional(v.string())
});

const sendReceipt = v.object({
  commandId: v.id('connectCommands'),
  serverNow: v.number(),
  executeBefore: v.number(),
  ownershipEpoch: v.number()
});

/** `song: null` clears the track; a field left out is unchanged. */
const statePatch = v.object({
  song: v.optional(v.union(songSnapshot, v.null())),
  queue: v.optional(songQueue),
  isPlaying: v.optional(v.boolean()),
  positionSec: v.optional(v.number()),
  volume: v.optional(v.number()),
  shuffle: v.optional(v.boolean()),
  repeat: v.optional(repeatMode)
});

const commandOutcome = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), code: v.string(), error: v.optional(v.string()) })
);

const errorData = {
  unauthenticated: 'Sign in to use Connect.',
  device_not_registered: 'Register this device before using Connect.',
  device_owned_by_another_account: 'This device ID belongs to another account.',
  invalid_command: 'The command arguments do not match the command type.',
  rate_limited: 'Too many Connect requests. Try again shortly.',
  player_state_missing: 'There is no player state to transfer.',
  device_not_active: 'Only the active device can report playback state.',
  stale_revision: 'This playback state is out of date. Read the latest state and retry.',
  command_not_found: 'The command no longer exists.',
  command_not_target: 'Only the target device can acknowledge this command.',
  stale_ownership: 'Playback moved to another device. Read the latest state and retry.',
  command_expired: 'The command was not run in time.',
  request_conflict: 'This request ID was already used for a different command.',
  update_required: 'Update Allegra on that device to control it from here.',
  target_cannot_play: 'That device cannot play right now.',
  target_not_active: 'That device is no longer the one playing.',
  reservation_mismatch: 'This command is reserved by another run of the player.',
  handoff_missing: 'There is no transfer waiting on this device.'
} as const;

/** Why a command failed, as stored in `errorCode`. The text is the default shown to the sender. */
const failureText = {
  needs_gesture: 'Tap play on that device to start playback.',
  not_found: 'That song could not be loaded.',
  expired: 'The command was not run in time.',
  superseded: 'Playback moved to another device first.',
  cannot_play: 'That device cannot play right now.',
  owner_unreachable: 'The device that was playing did not respond.',
  command_failed: 'The command could not be completed.'
} as const;

type ConnectErrorCode = keyof typeof errorData;
type FailureCode = keyof typeof failureText;
type ConnectCommandKind = Infer<typeof commandKind>;
type ConnectSongSnapshot = Infer<typeof songSnapshot>;
type ConnectPlayerSnapshot = Infer<typeof playerSnapshot>;
type ConnectStatePatch = Infer<typeof statePatch>;
type Command = Doc<'connectCommands'>;
type Player = Doc<'playerState'>;
type DeviceView = Infer<typeof deviceView>;

function fail(code: ConnectErrorCode, details?: Record<string, number | string | undefined>): never {
  const extra: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value !== undefined) extra[key] = value;
  }
  throw new ConvexError({ code, message: errorData[code], ...extra });
}

const isFailureCode = (code: string): code is FailureCode => code in failureText;
export const roomOf = (userId: string): string => `connect:${userId}`;

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

async function findPlayerState(ctx: QueryCtx | MutationCtx, userId: string): Promise<Player | null> {
  return await ctx.db
    .query('playerState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

async function findOwnershipRow(ctx: QueryCtx | MutationCtx, userId: string): Promise<Doc<'connectOwnership'> | null> {
  return await ctx.db
    .query('connectOwnership')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

interface Ownership {
  /** Null for an account that last claimed before this table existed. */
  readonly row: Doc<'connectOwnership'> | null;
  readonly activeDeviceId: string | undefined;
  readonly epoch: number;
  readonly handoff: Doc<'connectOwnership'>['handoff'];
}

/** Who is active. Without a row (no claim since V2 shipped) it is what the player state says, at epoch 0. */
async function readOwnership(ctx: QueryCtx | MutationCtx, userId: string, player: Player | null): Promise<Ownership> {
  const row = await findOwnershipRow(ctx, userId);
  if (row) return { row, activeDeviceId: row.activeDeviceId, epoch: row.epoch, handoff: row.handoff };
  return { row: null, activeDeviceId: player?.activeDeviceId, epoch: 0, handoff: undefined };
}

const ownershipDetails = (own: Ownership): Record<string, number | string | undefined> => ({
  currentEpoch: own.epoch,
  activeDeviceId: own.activeDeviceId
});

async function limitDevice(ctx: MutationCtx, name: DeviceLimit, userId: string, deviceId: string): Promise<void> {
  const status = await rateLimiter.limit(ctx, name, { key: `${userId}:${deviceId}` });
  if (!status.ok) fail('rate_limited', { retryAfterMs: Math.ceil(status.retryAfter ?? 0) });
}

/** Online per Presence. Reads this device's Presence rows only, never the whole room. */
async function isDeviceOnline(ctx: QueryCtx | MutationCtx, userId: string, deviceId: string): Promise<boolean> {
  const rooms = await presence.listUser(ctx, deviceId, true, 4);
  return rooms.some(({ roomId }) => roomId === roomOf(userId));
}

// ── Validation ───────────────────────────────────────────────────────────────

const rejectInvalid = (): never => fail('invalid_command');

function assertQueue(queue: readonly ConnectSongSnapshot[]): void {
  if (queue.length > QUEUE_LIMIT) fail('invalid_command');
  for (const song of queue) assertSongSnapshot(song, rejectInvalid);
}

function assertPlayerSnapshot(snapshot: ConnectPlayerSnapshot): void {
  if (snapshot.song) assertSongSnapshot(snapshot.song, rejectInvalid);
  assertQueue(snapshot.queue);
  if (
    !Number.isFinite(snapshot.positionSec) || snapshot.positionSec < 0 ||
    !Number.isFinite(snapshot.volume) || snapshot.volume < 0 || snapshot.volume > 1
  ) {
    fail('invalid_command');
  }
}

function assertStatePatch(patch: ConnectStatePatch): void {
  if (Object.values(patch).every((value) => value === undefined)) fail('invalid_command');
  if (patch.queue) assertQueue(patch.queue);
  if (patch.song) assertSongSnapshot(patch.song, rejectInvalid);
  if (patch.positionSec !== undefined && (!Number.isFinite(patch.positionSec) || patch.positionSec < 0)) {
    fail('invalid_command');
  }
  if (patch.volume !== undefined && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 1)) {
    fail('invalid_command');
  }
}

const isQueueIndex = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < QUEUE_LIMIT;
const isSongRef = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const isQueueEdit = (kind: ConnectCommandKind): boolean =>
  kind === 'queue_remove' || kind === 'queue_move' || kind === 'queue_clear';

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
    assertSongSnapshot((args as { song: ConnectSongSnapshot }).song, rejectInvalid);
    const { queue, positionSec, next, more } = args as { queue?: unknown; positionSec?: unknown; next?: unknown; more?: unknown };
    if (kind === 'queue_add' && (queue !== undefined || positionSec !== undefined)) fail('invalid_command');
    if (kind === 'play_song' && (next !== undefined || more !== undefined)) fail('invalid_command');
    if (more !== undefined) {
      // With `song` itself, one command carries a whole queue at most.
      if (!Array.isArray(more) || more.length >= QUEUE_LIMIT) fail('invalid_command');
      assertQueue(more as ConnectSongSnapshot[]);
    }
    if (queue !== undefined) {
      if (!Array.isArray(queue)) fail('invalid_command');
      assertQueue(queue as ConnectSongSnapshot[]);
    }
    if (positionSec !== undefined && (typeof positionSec !== 'number' || !Number.isFinite(positionSec) || positionSec < 0)) {
      fail('invalid_command');
    }
    return;
  }
  if (kind === 'queue_remove') {
    if (!args || typeof args !== 'object' || !('index' in args) || !('ref' in args)) fail('invalid_command');
    const { index, ref } = args as { index: unknown; ref: unknown };
    if (!isQueueIndex(index) || !isSongRef(ref)) fail('invalid_command');
    return;
  }
  if (kind === 'queue_move') {
    if (!args || typeof args !== 'object' || !('from' in args) || !('to' in args) || !('ref' in args)) fail('invalid_command');
    const { from, to, ref } = args as { from: unknown; to: unknown; ref: unknown };
    if (!isQueueIndex(from) || !isQueueIndex(to) || !isSongRef(ref)) fail('invalid_command');
    return;
  }
  if (args !== undefined) fail('invalid_command');
}

/** Structural equality for command arguments (plain JSON values). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = b as Record<string, unknown>;
  if (left.length !== Object.values(right).filter((value) => value !== undefined).length) return false;
  return left.every(([key, value]) => sameValue(value, right[key]));
}

// ── Position ─────────────────────────────────────────────────────────────────

function clampPosition(positionSec: number, song: ConnectSongSnapshot | undefined): number {
  const floor = Math.max(0, positionSec);
  return song && song.duration > 0 ? Math.min(floor, song.duration) : floor;
}

/** Where the stored state says playback is at `now`: it has moved on only while playing. */
function positionAtNow(player: Player, now: number): number {
  if (!player.isPlaying) return player.positionSec;
  return clampPosition(player.positionSec + Math.max(0, now - player.positionAt) / 1000, player.song);
}

/**
 * The fields a validated patch writes.
 *
 * The anchor rule: `positionAt` says when `positionSec` was true, so it moves only with it. A
 * patch that carries a position sets both. A patch that flips play/pause without one first moves
 * the stored position on to now, then anchors it there. Anything else (volume, shuffle, repeat,
 * queue) leaves both alone, so a volume change cannot make a playing song appear to jump back.
 */
function patchedFields(player: Player, patch: ConnectStatePatch, now: number): Partial<Omit<Player, '_id' | '_creationTime'>> {
  const { song, positionSec, ...rest } = patch;
  const fields: Partial<Omit<Player, '_id' | '_creationTime'>> = { ...rest };
  // `undefined` in a db patch removes the field: that is how null clears the track.
  if (song !== undefined) fields.song = song === null ? undefined : song;
  if (positionSec !== undefined) {
    fields.positionSec = positionSec;
    fields.positionAt = now;
  } else if (patch.isPlaying !== undefined && patch.isPlaying !== player.isPlaying) {
    fields.positionSec = positionAtNow(player, now);
    fields.positionAt = now;
  }
  return fields;
}

async function applyPatch(ctx: MutationCtx, player: Player, patch: ConnectStatePatch, now: number): Promise<number> {
  const rev = player.rev + 1;
  await ctx.db.patch('playerState', player._id, { ...patchedFields(player, patch, now), rev });
  return rev;
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** When a command stops being runnable. Legacy commands had no deadline: they lived as long as their row. */
const deadlineOf = (command: Command): number => command.executeBefore ?? command.createdAt + LEGACY_COMMAND_TTL_MS;
/** A transfer whose ownership has already moved to its target. Past that point it is not expired or superseded. */
const isActivated = (command: Command): boolean => command.kind === 'take_over' && command.release !== undefined;

/** Removing, moving and clearing need no catalog lookup, so they keep the short deadline. */
const deadlineFor = (kind: ConnectCommandKind): number =>
  kind === 'play_song' || kind === 'queue_add' || kind === 'take_over' ? LOADING_DEADLINE_MS : CONTROL_DEADLINE_MS;

async function clearHandoffOf(ctx: MutationCtx, command: Command): Promise<void> {
  if (command.kind !== 'take_over') return;
  const row = await findOwnershipRow(ctx, command.userId);
  if (row?.handoff?.commandId === command._id) await ctx.db.patch('connectOwnership', row._id, { handoff: undefined });
}

/** Ends a pending command as failed, and takes back the handoff it was waiting on. */
async function failCommand(ctx: MutationCtx, command: Command, errorCode: FailureCode, error?: string): Promise<void> {
  await ctx.db.patch('connectCommands', command._id, {
    status: 'failed',
    errorCode,
    error: (error?.trim() || failureText[errorCode]).slice(0, 240)
  });
  await clearHandoffOf(ctx, command);
}

/** A V2 command that ran out of time: `superseded` when ownership moved under it, else `expired`. */
async function expireCommandRow(ctx: MutationCtx, command: Command): Promise<void> {
  const row = await findOwnershipRow(ctx, command.userId);
  const superseded =
    !isActivated(command) && command.expectedOwnershipEpoch !== undefined && row !== null && row.epoch !== command.expectedOwnershipEpoch;
  await failCommand(ctx, command, superseded ? 'superseded' : 'expired');
}

/** The thrown form of a command that can no longer be begun or prepared. */
function refuseTerminal(command: Command, own: Ownership): never {
  if (command.status === 'failed' && command.errorCode === 'expired') fail('command_expired');
  if (command.status === 'failed' && command.errorCode === 'superseded') fail('stale_ownership', ownershipDetails(own));
  if (command.status === 'failed' && command.errorCode === 'cannot_play') fail('target_cannot_play');
  fail('command_not_found');
}

/** Checks every runnable command must pass. Throws; the stored failure is written by a transaction that commits. */
function assertRunnable(command: Command, own: Ownership, device: Doc<'devices'>, now: number): void {
  if (command.status !== 'pending') refuseTerminal(command, own);
  if (!isActivated(command)) {
    if (now >= deadlineOf(command)) fail('command_expired');
    if (command.expectedOwnershipEpoch !== undefined && command.expectedOwnershipEpoch !== own.epoch) {
      fail('stale_ownership', ownershipDetails(own));
    }
  }
  if (!device.canPlay) fail('target_cannot_play');
}

/** The command, if it belongs to this account and is addressed to this owned device. */
async function requireTargetedCommand(
  ctx: MutationCtx,
  userId: string,
  deviceId: string,
  commandId: Id<'connectCommands'>
): Promise<{ command: Command; device: Doc<'devices'> }> {
  const command = await ctx.db.get('connectCommands', commandId);
  // Another account's command is indistinguishable from one that does not exist.
  if (!command || command.userId !== userId) fail('command_not_found');
  if (command.targetDeviceId !== deviceId) fail('command_not_target');
  const device = await requireOwnedDevice(ctx, userId, deviceId);
  return { command, device };
}

/**
 * Makes `toDeviceId` the active device at the next epoch, drops any handoff, and fails this
 * account's pending V2 commands from the epoch that just ended (they were addressed to an owner
 * that no longer is). `keep` is the transfer being carried out. Returns the new epoch.
 */
async function moveOwnership(
  ctx: MutationCtx,
  userId: string,
  own: Ownership,
  toDeviceId: string,
  keep?: Id<'connectCommands'>
): Promise<number> {
  const epoch = own.epoch + 1;
  if (own.row) {
    await ctx.db.patch('connectOwnership', own.row._id, { activeDeviceId: toDeviceId, epoch, handoff: undefined });
  } else {
    await ctx.db.insert('connectOwnership', { userId, activeDeviceId: toDeviceId, epoch });
  }
  if (own.handoff && own.handoff.commandId !== keep) {
    const waiting = await ctx.db.get('connectCommands', own.handoff.commandId);
    if (waiting?.status === 'pending') await failCommand(ctx, waiting, 'superseded');
  }
  // Newest first: past the read bound, the older ones are refused when begun and failed at their deadline.
  const pending = await ctx.db
    .query('connectCommands')
    .withIndex('by_userId_and_status', (q) => q.eq('userId', userId).eq('status', 'pending'))
    .order('desc')
    .take(100);
  for (const command of pending) {
    if (command._id === keep || command.expectedOwnershipEpoch === undefined || command.expectedOwnershipEpoch >= epoch) continue;
    await failCommand(ctx, command, 'superseded');
  }
  return epoch;
}

interface V2Binding {
  readonly requestId: string;
  readonly expectedOwnershipEpoch: number;
}

async function enqueue(
  ctx: MutationCtx,
  userId: string,
  targetDeviceId: string,
  sourceDeviceId: string,
  kind: ConnectCommandKind,
  args: Command['args'],
  v2?: V2Binding
): Promise<{ commandId: Id<'connectCommands'>; serverNow: number; executeBefore: number }> {
  const now = Date.now();
  const status = await rateLimiter.limit(ctx, 'connectCommands', { key: userId });
  if (!status.ok) fail('rate_limited', { retryAfterMs: Math.ceil(status.retryAfter ?? 0) });

  const executeBefore = now + (v2 ? deadlineFor(kind) : LEGACY_COMMAND_TTL_MS);
  const commandId = await ctx.db.insert('connectCommands', {
    userId,
    targetDeviceId,
    sourceDeviceId,
    issuedBy: userId,
    kind,
    ...(args === undefined ? {} : { args }),
    createdAt: now,
    status: 'pending',
    ...(v2 ? { requestId: v2.requestId, expectedOwnershipEpoch: v2.expectedOwnershipEpoch, executeBefore } : {})
  });
  // The deadline is materialized by a job, not by a query comparing against the clock.
  if (v2) await ctx.scheduler.runAfter(executeBefore - now, internal.connect.expireCommand, { commandId });
  return { commandId, serverNow: now, executeBefore };
}

/** The command an earlier call with this request id created, or null. Throws when the id was used for something else. */
async function findRequest(
  ctx: MutationCtx,
  userId: string,
  sourceDeviceId: string,
  requestId: string,
  same: (command: Command) => boolean
): Promise<Command | null> {
  if (requestId.length < 8 || requestId.length > 64) fail('invalid_command');
  const existing = await ctx.db
    .query('connectCommands')
    .withIndex('by_userId_and_sourceDeviceId_and_requestId', (q) =>
      q.eq('userId', userId).eq('sourceDeviceId', sourceDeviceId).eq('requestId', requestId)
    )
    .first();
  if (existing && !same(existing)) fail('request_conflict');
  return existing;
}

const receiptOf = (command: Command, now: number): Infer<typeof sendReceipt> => ({
  commandId: command._id,
  // A fresh clock sample; the deadline and epoch are the ones the first call was given.
  serverNow: now,
  executeBefore: deadlineOf(command),
  ownershipEpoch: command.expectedOwnershipEpoch ?? 0
});

function requireV2Target(target: Doc<'devices'>): void {
  if (!target.canPlay) fail('target_cannot_play');
  if ((target.protocolVersion ?? 1) < PROTOCOL_V2) fail('update_required');
}

// ── Devices ──────────────────────────────────────────────────────────────────

/**
 * The device list for an account. Reads registrations, Presence and `connectOwnership`; it reads
 * `playerState` only for an account with no ownership row yet, so a position report does not
 * re-run this for every device (convex/connect.test.ts holds it to that).
 */
export async function listDevices(ctx: QueryCtx, userId: string): Promise<DeviceView[]> {
  const [registered, ownership, onlinePresence] = await Promise.all([
    ctx.db
      .query('devices')
      .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .take(100),
    findOwnershipRow(ctx, userId),
    presence.listRoom(ctx, roomOf(userId), true, 100)
  ]);
  const activeDeviceId = ownership ? ownership.activeDeviceId : (await findPlayerState(ctx, userId))?.activeDeviceId;
  const online = new Set(onlinePresence.map(({ userId: deviceId }) => deviceId));
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
      isActive: device.deviceId === activeDeviceId,
      protocolVersion: device.protocolVersion ?? 1
    }));
}

/** Register this device for the signed-in account and mark it online, in one step. */
export const register = mutation({
  args: {
    deviceId: v.string(),
    name: v.string(),
    kind: deviceKind,
    appVersion: v.string(),
    canPlay: v.boolean(),
    protocolVersion: v.optional(v.number())
  },
  returns: v.object({ serverNow: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (
      args.deviceId.length < 1 || args.deviceId.length > 128 ||
      args.name.trim().length < 1 || args.name.length > 80 ||
      args.appVersion.length > 40 ||
      (args.protocolVersion !== undefined &&
        (!Number.isInteger(args.protocolVersion) || args.protocolVersion < 1 || args.protocolVersion > 1000))
    ) {
      fail('invalid_command');
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('devices')
      .withIndex('by_deviceId', (q) => q.eq('deviceId', args.deviceId))
      .unique();
    if (existing && existing.userId !== userId) fail('device_owned_by_another_account');
    await limitDevice(ctx, 'connectRegister', userId, args.deviceId);
    if (existing) {
      await ctx.db.patch('devices', existing._id, {
        name: args.name.trim(),
        kind: args.kind,
        appVersion: args.appVersion,
        canPlay: args.canPlay,
        // Left out by a legacy client: the device is legacy again, whatever it ran before.
        protocolVersion: args.protocolVersion,
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
        ...(args.protocolVersion === undefined ? {} : { protocolVersion: args.protocolVersion }),
        createdAt: now,
        retentionCheckedAt: now
      });
    }
    // Online from this moment, not from the first heartbeat a minute later.
    await presence.heartbeat(ctx, roomOf(userId), args.deviceId, args.deviceId, HEARTBEAT_INTERVAL_MS);
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
    await limitDevice(ctx, 'connectHeartbeat', userId, deviceId);
    const now = Date.now();
    await presence.heartbeat(ctx, roomOf(userId), deviceId, deviceId, HEARTBEAT_INTERVAL_MS);
    return { serverNow: now };
  }
});

/**
 * A device says it is leaving (signed out, tab closed, app in the background with nothing
 * playing): it goes offline now instead of 2.5 heartbeats later. If it was the one playing, its
 * sound has stopped, so the state is paused where the song had reached. The others then stop
 * showing a clock that runs on, and can pick the song up from there.
 */
export const disconnect = mutation({
  args: { deviceId: v.string() },
  returns: v.object({ serverNow: v.number() }),
  handler: async (ctx, { deviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    await limitDevice(ctx, 'connectDisconnect', userId, deviceId);
    const now = Date.now();
    // Presence only hands a session's token out from a heartbeat.
    const { sessionToken } = await presence.heartbeat(ctx, roomOf(userId), deviceId, deviceId, HEARTBEAT_INTERVAL_MS);
    await presence.disconnect(ctx, sessionToken);
    const player = await findPlayerState(ctx, userId);
    if (player?.isPlaying) {
      const own = await readOwnership(ctx, userId, player);
      if (own.activeDeviceId === deviceId) await applyPatch(ctx, player, { isPlaying: false }, now);
    }
    return { serverNow: now };
  }
});

/** Devices are online according to Presence, never a query-time clock comparison. */
export const devices = query({
  args: {},
  returns: v.array(deviceView),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await listDevices(ctx, userId);
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
    const own = await readOwnership(ctx, userId, player);
    return {
      ...(own.activeDeviceId ? { activeDeviceId: own.activeDeviceId } : {}),
      ...(player.song ? { song: player.song } : {}),
      queue: player.queue,
      isPlaying: player.isPlaying,
      positionSec: player.positionSec,
      positionAt: player.positionAt,
      volume: player.volume,
      shuffle: player.shuffle,
      repeat: player.repeat,
      rev: player.rev,
      ownershipEpoch: own.epoch,
      ...(own.handoff ? { handoff: { commandId: own.handoff.commandId, toDeviceId: own.handoff.toDeviceId } } : {})
    };
  }
});

const byCreatedThenId = (a: Command, b: Command): number =>
  a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id));

/** Legacy: incoming work and this device's recent command outcomes in one list. V2 clients use inboxFor and outcomesFor. */
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
    const rows = new Map<string, Command>();
    for (const row of [...incoming, ...outgoing]) {
      if (row.userId === userId) rows.set(row._id, row);
    }
    return [...rows.values()]
      .sort(byCreatedThenId)
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

/**
 * Pending commands addressed to this device, oldest first. A command past its deadline stays
 * here until a mutation or the deadline job fails it; beginV2 is what refuses to run it.
 */
export const inboxFor = query({
  args: { deviceId: v.string() },
  returns: v.array(inboxRow),
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
      .sort(byCreatedThenId)
      .map((row) => ({
        commandId: row._id,
        sourceDeviceId: row.sourceDeviceId,
        kind: row.kind,
        ...(row.args ? { args: row.args } : {}),
        createdAt: row.createdAt,
        ...(row.requestId === undefined ? {} : { requestId: row.requestId }),
        ...(row.executeBefore === undefined ? {} : { executeBefore: row.executeBefore }),
        ...(row.expectedOwnershipEpoch === undefined ? {} : { expectedOwnershipEpoch: row.expectedOwnershipEpoch }),
        ...(row.reservationToken === undefined ? {} : { reservationToken: row.reservationToken }),
        ...(row.release === undefined ? {} : { release: row.release })
      }));
  }
});

/** How the 20 most recent commands this device sent turned out, oldest first. No arguments: a queue is not echoed back. */
export const outcomesFor = query({
  args: { deviceId: v.string() },
  returns: v.array(outcomeRow),
  handler: async (ctx, { deviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    const rows = await ctx.db
      .query('connectCommands')
      .withIndex('by_sourceDeviceId_and_createdAt', (q) => q.eq('sourceDeviceId', deviceId))
      .order('desc')
      .take(20);
    return rows
      .filter((row) => row.userId === userId)
      .sort(byCreatedThenId)
      .map((row) => ({
        commandId: row._id,
        ...(row.requestId === undefined ? {} : { requestId: row.requestId }),
        targetDeviceId: row.targetDeviceId,
        kind: row.kind,
        createdAt: row.createdAt,
        status: row.status,
        // The target has reserved it (beginV2) and is working: the sender keeps waiting to the deadline.
        ...(row.status === 'pending' && row.beganAt !== undefined ? { began: true } : {}),
        ...(row.error ? { error: row.error } : {}),
        ...(row.errorCode ? { errorCode: row.errorCode } : {})
      }));
  }
});

/** The active player reports what changed. Revision and ownership epoch stop a stale write. */
export const report = mutation({
  args: {
    deviceId: v.string(),
    patch: statePatch,
    rev: v.number(),
    expectedOwnershipEpoch: v.optional(v.number())
  },
  returns: v.object({ rev: v.number(), serverNow: v.number() }),
  handler: async (ctx, { deviceId, patch, rev, expectedOwnershipEpoch }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    const player = await findPlayerState(ctx, userId);
    const own = await readOwnership(ctx, userId, player);
    if (!player || own.activeDeviceId !== deviceId) fail('device_not_active');
    if (expectedOwnershipEpoch !== undefined && expectedOwnershipEpoch !== own.epoch) {
      fail('stale_ownership', ownershipDetails(own));
    }
    if (!Number.isInteger(rev) || player.rev !== rev) fail('stale_revision', { currentRev: player.rev });
    assertStatePatch(patch);
    await limitDevice(ctx, 'connectReport', userId, deviceId);
    const now = Date.now();
    // An account from before the ownership table gets its row on the first write, at the epoch readers already assume.
    if (!own.row) await ctx.db.insert('connectOwnership', { userId, activeDeviceId: deviceId, epoch: own.epoch });
    return { rev: await applyPatch(ctx, player, patch, now), serverNow: now };
  }
});

/**
 * Claiming playback makes this device the single active player for the account.
 *
 * A new owner moves the epoch on, which ends every command and transfer bound to the old one. A
 * claim by the device that is already active only writes its snapshot: the epoch stays, so a
 * client that claims repeatedly does not invalidate its own controllers.
 */
export const claim = mutation({
  args: { deviceId: v.string(), snapshot: playerSnapshot, expectedOwnershipEpoch: v.optional(v.number()) },
  returns: v.object({ rev: v.number(), serverNow: v.number(), ownershipEpoch: v.number() }),
  handler: async (ctx, { deviceId, snapshot, expectedOwnershipEpoch }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    assertPlayerSnapshot(snapshot);
    const now = Date.now();
    const player = await findPlayerState(ctx, userId);
    const own = await readOwnership(ctx, userId, player);
    if (expectedOwnershipEpoch !== undefined && expectedOwnershipEpoch !== own.epoch) {
      fail('stale_ownership', ownershipDetails(own));
    }
    await limitDevice(ctx, 'connectClaim', userId, deviceId);

    let ownershipEpoch = own.epoch;
    if (own.activeDeviceId !== deviceId) {
      ownershipEpoch = await moveOwnership(ctx, userId, own, deviceId);
    } else if (!own.row) {
      await ctx.db.insert('connectOwnership', { userId, activeDeviceId: deviceId, epoch: own.epoch });
    }

    const rev = (player?.rev ?? 0) + 1;
    const playback = {
      queue: snapshot.queue,
      isPlaying: snapshot.isPlaying,
      positionSec: snapshot.positionSec,
      positionAt: now,
      volume: snapshot.volume,
      shuffle: snapshot.shuffle,
      repeat: snapshot.repeat,
      rev
    };
    if (player) {
      // activeDeviceId is still written here so code from before connectOwnership keeps working after a rollback.
      await ctx.db.patch('playerState', player._id, { activeDeviceId: deviceId, song: snapshot.song, ...playback });
    } else {
      await ctx.db.insert('playerState', {
        userId,
        activeDeviceId: deviceId,
        ...(snapshot.song ? { song: snapshot.song } : {}),
        ...playback
      });
    }
    return { rev, serverNow: now, ownershipEpoch };
  }
});

/** Legacy: queue one remote command after account ownership and rate-limit checks. */
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
    const target = await requireOwnedDevice(ctx, userId, targetDeviceId);
    if (!target.canPlay) fail('target_cannot_play');
    assertCommandPair(kind, args);
    const { commandId, serverNow } = await enqueue(ctx, userId, targetDeviceId, fromDeviceId, kind, args);
    return { commandId, serverNow };
  }
});

/**
 * Queue one command for the active device, bound to the epoch the sender saw and to a deadline
 * the server picks. The request id makes a retry after an uncertain failure safe: it returns the
 * command the first attempt created and spends no quota.
 */
export const sendV2 = mutation({
  args: {
    fromDeviceId: v.string(),
    targetDeviceId: v.string(),
    requestId: v.string(),
    expectedOwnershipEpoch: v.number(),
    kind: commandKind,
    args: v.optional(connectCommandArgs)
  },
  returns: sendReceipt,
  handler: async (ctx, { fromDeviceId, targetDeviceId, requestId, expectedOwnershipEpoch, kind, args }) => {
    const userId = await requireUser(ctx);
    const earlier = await findRequest(
      ctx,
      userId,
      fromDeviceId,
      requestId,
      (command) => command.kind === kind && command.targetDeviceId === targetDeviceId && sameValue(command.args, args)
    );
    if (earlier) return receiptOf(earlier, Date.now());

    await requireOwnedDevice(ctx, userId, fromDeviceId);
    const target = await requireOwnedDevice(ctx, userId, targetDeviceId);
    assertCommandPair(kind, args);
    const own = await readOwnership(ctx, userId, await findPlayerState(ctx, userId));
    if (own.activeDeviceId !== targetDeviceId) fail('target_not_active', ownershipDetails(own));
    if (own.epoch !== expectedOwnershipEpoch) fail('stale_ownership', ownershipDetails(own));
    requireV2Target(target);
    if (isQueueEdit(kind) && (target.protocolVersion ?? 1) < PROTOCOL_QUEUE_EDIT) fail('update_required');
    const queued = await enqueue(ctx, userId, targetDeviceId, fromDeviceId, kind, args, { requestId, expectedOwnershipEpoch });
    return { ...queued, ownershipEpoch: own.epoch };
  }
});

/** Only the addressed device can complete its queued command. Legacy: V2 clients use completeV2. */
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
    const { command } = await requireTargetedCommand(ctx, userId, deviceId, commandId);
    const now = Date.now();
    if (command.status !== 'pending') return { updated: false, serverNow: now };
    await ctx.db.patch('connectCommands', command._id, {
      status: ok ? 'done' : 'failed',
      ...(!ok && error ? { error: error.slice(0, 240) } : {}),
      ...(!ok && command.requestId !== undefined ? { errorCode: 'command_failed' } : {})
    });
    await clearHandoffOf(ctx, command);
    return { updated: true, serverNow: now };
  }
});

function transferState(player: Player, ownershipEpoch: number): NonNullable<Command['args']> {
  return {
    state: {
      ...(player.song ? { song: player.song } : {}),
      queue: player.queue,
      isPlaying: player.isPlaying,
      positionSec: player.positionSec,
      positionAt: player.positionAt,
      volume: player.volume,
      shuffle: player.shuffle,
      repeat: player.repeat,
      rev: player.rev,
      ownershipEpoch
    }
  };
}

/** Legacy: ask another owned device to load the current player state and claim playback. */
export const transfer = mutation({
  args: { fromDeviceId: v.string(), toDeviceId: v.string() },
  returns: v.object({ commandId: v.id('connectCommands'), serverNow: v.number() }),
  handler: async (ctx, { fromDeviceId, toDeviceId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, fromDeviceId);
    await requireOwnedDevice(ctx, userId, toDeviceId);
    const player = await findPlayerState(ctx, userId);
    if (!player) fail('player_state_missing');
    const own = await readOwnership(ctx, userId, player);
    const { commandId, serverNow } = await enqueue(ctx, userId, toDeviceId, fromDeviceId, 'take_over', transferState(player, own.epoch));
    return { commandId, serverNow };
  }
});

/**
 * Ask a device to take playback over. It only queues the request: ownership moves in prepareV2
 * (nobody to wait for) or releaseV2 (the owner has confirmed it paused), never here.
 */
export const transferV2 = mutation({
  args: {
    fromDeviceId: v.string(),
    toDeviceId: v.string(),
    requestId: v.string(),
    expectedOwnershipEpoch: v.number()
  },
  returns: sendReceipt,
  handler: async (ctx, { fromDeviceId, toDeviceId, requestId, expectedOwnershipEpoch }) => {
    const userId = await requireUser(ctx);
    const earlier = await findRequest(
      ctx,
      userId,
      fromDeviceId,
      requestId,
      // The state snapshot moves with every report, so a retry is the same transfer when it names the same device.
      (command) => command.kind === 'take_over' && command.targetDeviceId === toDeviceId
    );
    if (earlier) return receiptOf(earlier, Date.now());

    await requireOwnedDevice(ctx, userId, fromDeviceId);
    requireV2Target(await requireOwnedDevice(ctx, userId, toDeviceId));
    const player = await findPlayerState(ctx, userId);
    if (!player?.song) fail('player_state_missing');
    const own = await readOwnership(ctx, userId, player);
    if (own.epoch !== expectedOwnershipEpoch) fail('stale_ownership', ownershipDetails(own));
    const queued = await enqueue(ctx, userId, toDeviceId, fromDeviceId, 'take_over', transferState(player, own.epoch), {
      requestId,
      expectedOwnershipEpoch
    });
    return { ...queued, ownershipEpoch: own.epoch };
  }
});

/**
 * The target reserves a command before it touches its player. A command that is expired, from an
 * older epoch, or addressed to a device that cannot play is refused here and must not run.
 * Calling again for the same pending command returns the same token.
 */
export const beginV2 = mutation({
  args: { deviceId: v.string(), commandId: v.id('connectCommands') },
  returns: v.object({ reservationToken: v.string(), serverNow: v.number(), executeBefore: v.number() }),
  handler: async (ctx, { deviceId, commandId }) => {
    const userId = await requireUser(ctx);
    const { command, device } = await requireTargetedCommand(ctx, userId, deviceId, commandId);
    const now = Date.now();
    const own = await readOwnership(ctx, userId, command.status === 'pending' ? await findPlayerState(ctx, userId) : null);
    assertRunnable(command, own, device, now);
    const executeBefore = deadlineOf(command);
    if (command.reservationToken !== undefined) {
      return { reservationToken: command.reservationToken, serverNow: now, executeBefore };
    }
    const reservationToken = crypto.randomUUID();
    await ctx.db.patch('connectCommands', command._id, { reservationToken, beganAt: now });
    return { reservationToken, serverNow: now, executeBefore };
  }
});

/**
 * The destination of a transfer has the song loaded, paused. Either ownership moves to it now, or
 * it must wait for the current owner to pause first.
 *
 * It moves now when there is nobody to wait for: no owner, the owner is this device, the stored
 * state is paused, or Presence has given the owner up as offline. That last owner cannot confirm
 * anything (a closed laptop, a killed app), so the destination starts where the song would have
 * reached; if the owner is in fact still playing it stops as soon as it reconnects and sees the
 * new epoch. An owner that Presence still counts online, legacy ones included, must confirm its
 * pause through releaseV2, and its silence is a failed transfer.
 */
export const prepareV2 = mutation({
  args: { deviceId: v.string(), commandId: v.id('connectCommands'), reservationToken: v.string() },
  returns: v.union(
    v.object({
      status: v.literal('activated'),
      serverNow: v.number(),
      rev: v.number(),
      ownershipEpoch: v.number(),
      positionSec: v.number(),
      resume: v.boolean()
    }),
    v.object({ status: v.literal('awaiting_release'), serverNow: v.number() })
  ),
  handler: async (ctx, { deviceId, commandId, reservationToken }) => {
    const userId = await requireUser(ctx);
    const { command, device } = await requireTargetedCommand(ctx, userId, deviceId, commandId);
    if (command.kind !== 'take_over') fail('invalid_command');
    const now = Date.now();
    const player = await findPlayerState(ctx, userId);
    const own = await readOwnership(ctx, userId, player);
    assertRunnable(command, own, device, now);
    if (command.reservationToken === undefined || command.reservationToken !== reservationToken) fail('reservation_mismatch');
    if (!player) fail('player_state_missing');
    // Already moved (by releaseV2, or by an earlier call whose reply was lost): the same answer again.
    if (command.release) {
      return {
        status: 'activated' as const,
        serverNow: now,
        rev: player.rev,
        ownershipEpoch: own.epoch,
        positionSec: command.release.positionSec,
        resume: command.release.resume
      };
    }

    const ownerId = own.activeDeviceId;
    const waitForOwner =
      ownerId !== undefined && ownerId !== deviceId && player.isPlaying && (await isDeviceOnline(ctx, userId, ownerId));

    if (waitForOwner) {
      if (own.handoff?.commandId !== command._id) {
        // The newest transfer wins the handoff; the one it replaces can no longer complete.
        if (own.handoff) {
          const replaced = await ctx.db.get('connectCommands', own.handoff.commandId);
          if (replaced?.status === 'pending') await failCommand(ctx, replaced, 'superseded');
        }
        const handoff = { commandId: command._id, toDeviceId: deviceId, executeBefore: deadlineOf(command) };
        if (own.row) await ctx.db.patch('connectOwnership', own.row._id, { handoff });
        else await ctx.db.insert('connectOwnership', { userId, activeDeviceId: ownerId, epoch: own.epoch, handoff });
      }
      return { status: 'awaiting_release' as const, serverNow: now };
    }

    // Paused: the stored position. Playing (an owner that went offline): where it has got to since.
    const positionSec = positionAtNow(player, now);
    const resume = player.isPlaying;
    const ownershipEpoch = await moveOwnership(ctx, userId, own, deviceId, command._id);
    const rev = player.rev + 1;
    await ctx.db.patch('playerState', player._id, { activeDeviceId: deviceId, isPlaying: false, positionSec, positionAt: now, rev });
    await ctx.db.patch('connectCommands', command._id, { release: { positionSec, resume } });
    return { status: 'activated' as const, serverNow: now, rev, ownershipEpoch, positionSec, resume };
  }
});

/**
 * The owner answers a handoff after its player has confirmed the pause: it hands over the exact
 * position and whether it was playing. In one transaction the destination becomes the owner at
 * the next epoch, the state is paused at that position, the handoff is cleared and the command
 * carries `release` so the destination can start.
 */
export const releaseV2 = mutation({
  args: {
    deviceId: v.string(),
    commandId: v.id('connectCommands'),
    expectedOwnershipEpoch: v.number(),
    positionSec: v.number(),
    resume: v.boolean()
  },
  returns: v.object({ serverNow: v.number(), rev: v.number(), ownershipEpoch: v.number() }),
  handler: async (ctx, { deviceId, commandId, expectedOwnershipEpoch, positionSec, resume }) => {
    const userId = await requireUser(ctx);
    await requireOwnedDevice(ctx, userId, deviceId);
    if (!Number.isFinite(positionSec) || positionSec < 0) fail('invalid_command');
    const now = Date.now();
    const player = await findPlayerState(ctx, userId);
    const own = await readOwnership(ctx, userId, player);
    const found = await ctx.db.get('connectCommands', commandId);
    const command = found?.userId === userId ? found : null;
    // A repeat of a release that already landed (its reply was lost): the same answer again.
    if (command?.release && player && own.epoch === expectedOwnershipEpoch + 1 && own.activeDeviceId === command.targetDeviceId) {
      return { serverNow: now, rev: player.rev, ownershipEpoch: own.epoch };
    }
    if (own.activeDeviceId !== deviceId) fail('device_not_active');
    if (own.epoch !== expectedOwnershipEpoch) fail('stale_ownership', ownershipDetails(own));
    const handoff = own.handoff;
    if (!handoff || handoff.commandId !== commandId || command?.status !== 'pending') fail('handoff_missing');
    if (now >= handoff.executeBefore) fail('command_expired');
    if (!player) fail('player_state_missing');

    const exact = clampPosition(positionSec, player.song);
    const ownershipEpoch = await moveOwnership(ctx, userId, own, handoff.toDeviceId, command._id);
    const rev = player.rev + 1;
    await ctx.db.patch('playerState', player._id, {
      activeDeviceId: handoff.toDeviceId,
      isPlaying: false,
      positionSec: exact,
      positionAt: now,
      rev
    });
    await ctx.db.patch('connectCommands', command._id, { release: { positionSec: exact, resume } });
    return { serverNow: now, rev, ownershipEpoch };
  }
});

/**
 * The target reports how a command went and, on success, the state it left the player in: one
 * transaction instead of a report followed by an acknowledgement.
 *
 * Never throws for a command that can no longer succeed: it records why (expired, superseded)
 * and answers `completed`, because a thrown error would record nothing. `conflict` means the
 * state moved under the patch: nothing was finalized, send it again with `currentRev`. The audio
 * action is not repeated.
 */
export const completeV2 = mutation({
  args: {
    deviceId: v.string(),
    commandId: v.id('connectCommands'),
    reservationToken: v.string(),
    outcome: commandOutcome,
    patch: v.optional(statePatch),
    rev: v.optional(v.number())
  },
  returns: v.union(
    v.object({ status: v.literal('completed'), serverNow: v.number(), rev: v.number(), ownershipEpoch: v.number() }),
    v.object({ status: v.literal('conflict'), serverNow: v.number(), currentRev: v.number() })
  ),
  handler: async (ctx, { deviceId, commandId, reservationToken, outcome, patch, rev }) => {
    const userId = await requireUser(ctx);
    const { command } = await requireTargetedCommand(ctx, userId, deviceId, commandId);
    const now = Date.now();
    const player = await findPlayerState(ctx, userId);
    const own = await readOwnership(ctx, userId, player);
    const completed = (currentRev: number) =>
      ({ status: 'completed' as const, serverNow: now, rev: currentRev, ownershipEpoch: own.epoch });

    // Already finished (a retried completion, or failed by a claim or its deadline): the recorded result stands.
    if (command.status !== 'pending') return completed(player?.rev ?? 0);

    // A refusal needs no reservation: a device may fail a command it never began.
    const reserved = command.reservationToken !== undefined;
    if (reserved ? command.reservationToken !== reservationToken : outcome.ok) fail('reservation_mismatch');
    if (!outcome.ok && !isFailureCode(outcome.code)) fail('invalid_command');
    const hasPatch = patch !== undefined && Object.values(patch).some((value) => value !== undefined);
    if (patch && hasPatch) assertStatePatch(patch);

    if (!isActivated(command)) {
      if (now >= deadlineOf(command)) {
        await failCommand(ctx, command, 'expired');
        return completed(player?.rev ?? 0);
      }
      if (command.expectedOwnershipEpoch !== undefined && command.expectedOwnershipEpoch !== own.epoch) {
        await failCommand(ctx, command, 'superseded');
        return completed(player?.rev ?? 0);
      }
    }
    if (!outcome.ok) {
      await failCommand(ctx, command, outcome.code as FailureCode, outcome.error);
      return completed(player?.rev ?? 0);
    }
    // A V2 transfer succeeds only through prepareV2 or releaseV2: that is where ownership moves.
    if (command.kind === 'take_over' && command.requestId !== undefined && !command.release) fail('handoff_missing');

    let currentRev = player?.rev ?? 0;
    // The patch describes the account's player only when this device is the one playing.
    if (patch && hasPatch) {
      if (!player) fail('player_state_missing');
      if (own.activeDeviceId !== deviceId) fail('device_not_active');
      if (rev === undefined || rev !== player.rev) return { status: 'conflict' as const, serverNow: now, currentRev: player.rev };
      currentRev = await applyPatch(ctx, player, patch, now);
    }
    await ctx.db.patch('connectCommands', command._id, { status: 'done' });
    await clearHandoffOf(ctx, command);
    return completed(currentRev);
  }
});

/** Scheduled for a V2 command's deadline: a command still pending then is failed, and its handoff taken back. */
export const expireCommand = internalMutation({
  args: { commandId: v.id('connectCommands') },
  returns: v.null(),
  handler: async (ctx, { commandId }) => {
    const command = await ctx.db.get('connectCommands', commandId);
    // A transfer that already moved ownership is left for its target to complete; the sweep ends it if it never does.
    if (!command || command.status !== 'pending' || isActivated(command)) return null;
    if (Date.now() < deadlineOf(command)) return null;
    await expireCommandRow(ctx, command);
    return null;
  }
});

/** Remove old commands and stale device registrations in small transactions, and fail what its deadline job missed. */
export const sweep = internalMutation({
  args: {},
  returns: v.object({
    commandsRemoved: v.number(),
    commandsExpired: v.number(),
    devicesRemoved: v.number(),
    devicesChecked: v.number()
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const BATCH = 200;
    let more = false;

    // Pending V2 commands well past their deadline. Failing one takes it out of this range, and clears its handoff.
    const overdue = await ctx.db
      .query('connectCommands')
      .withIndex('by_status_and_executeBefore_and_createdAt', (q) =>
        q.eq('status', 'pending').gte('executeBefore', 0).lt('executeBefore', now - SWEEP_EXPIRY_GRACE_MS)
      )
      .take(BATCH);
    for (const command of overdue) await expireCommandRow(ctx, command);
    more ||= overdue.length === BATCH;

    // Legacy rows (no deadline) keep their two minutes.
    let commandsRemoved = 0;
    for (const status of ['pending', 'done', 'failed'] as const) {
      const legacy = await ctx.db
        .query('connectCommands')
        .withIndex('by_status_and_executeBefore_and_createdAt', (q) =>
          q.eq('status', status).eq('executeBefore', undefined).lt('createdAt', now - LEGACY_COMMAND_TTL_MS)
        )
        .take(BATCH);
      for (const command of legacy) await ctx.db.delete('connectCommands', command._id);
      commandsRemoved += legacy.length;
      more ||= legacy.length === BATCH;
    }

    // V2 rows stay ten minutes so a retried request id finds them. Any still pending here was failed above.
    const old = await ctx.db
      .query('connectCommands')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', now - V2_RETENTION_MS))
      .take(BATCH);
    for (const command of old) {
      await clearHandoffOf(ctx, command);
      await ctx.db.delete('connectCommands', command._id);
    }
    commandsRemoved += old.length;
    more ||= old.length === BATCH;

    const deviceCutoff = now - 30 * 24 * 60 * MINUTE;
    const staleCandidates = await ctx.db
      .query('devices')
      .withIndex('by_retentionCheckedAt', (q) => q.lt('retentionCheckedAt', deviceCutoff))
      .take(10);
    let devicesRemoved = 0;
    for (const device of staleCandidates) {
      const room = roomOf(device.userId);
      const roomPresence = await presence.listRoom(ctx, room, false, 1000);
      const entry = roomPresence.find(({ userId: presenceUserId }) => presenceUserId === device.deviceId);
      if (!entry && roomPresence.length >= 1000) {
        // Do not infer that a session is absent when a large room reached the read cap.
        await ctx.db.patch('devices', device._id, { retentionCheckedAt: now });
      } else if (!entry || (!entry.online && entry.lastDisconnected <= deviceCutoff)) {
        await ctx.db.delete('devices', device._id);
        if (entry) await presence.removeRoomUser(ctx, room, device.deviceId);
        devicesRemoved += 1;
      } else if (!entry.online) {
        // Recheck when this session reaches its 30-day offline retention limit.
        await ctx.db.patch('devices', device._id, { retentionCheckedAt: entry.lastDisconnected });
      } else {
        // Online devices are checked again after another 30 days.
        await ctx.db.patch('devices', device._id, { retentionCheckedAt: now });
      }
    }

    if (more || staleCandidates.length === 10) {
      await ctx.scheduler.runAfter(0, internal.connect.sweep, {});
    }
    return {
      commandsRemoved,
      commandsExpired: overdue.length,
      devicesRemoved,
      devicesChecked: staleCandidates.length
    };
  }
});
