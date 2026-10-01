import { connectError } from './errors.ts';
import type {
  CommandOutcome,
  CommandOutcomeInput,
  CompleteResult,
  ConnectDevice,
  ConnectPlayerState,
  ConnectSnapshot,
  ConnectTransport,
  DeviceRegistration,
  InboxCommand,
  PlayerSnapshot,
  PlayerStatePatch,
  PrepareResult,
  RemoteCommand,
  SendReceipt,
  TransferState
} from './types.ts';
import type { SongSnapshot } from '../../shared/songRef.ts';

const LEGACY_COMMAND_TTL_MS = 2 * 60_000;
const CONTROL_DEADLINE_MS = 15_000;
const LOAD_DEADLINE_MS = 60_000;
const V2 = 2;
const FAILURE_TEXT: Record<NonNullable<CommandOutcome['errorCode']>, string> = {
  needs_gesture: 'Tap play on that device to start playback.',
  not_found: 'That song could not be loaded.',
  expired: 'The command was not run in time.',
  superseded: 'Playback moved to another device first.',
  cannot_play: 'That device cannot play right now.',
  owner_unreachable: 'The device that was playing did not respond.',
  command_failed: 'The command could not be completed.'
};

interface StoredCommand extends Omit<InboxCommand, 'release' | 'reservationToken'> {
  readonly targetDeviceId: string;
  status: 'pending' | 'done' | 'failed';
  errorCode?: CommandOutcome['errorCode'];
  error?: string;
  reservationToken?: string;
  beganAt?: number;
  release?: { readonly positionSec: number; readonly resume: boolean };
}

export type MemoryOperation = 'register' | 'heartbeat' | 'report' | 'claim' | 'send' | 'transfer' | 'begin' | 'prepare' | 'release' | 'complete';

interface RateLimit {
  readonly burst: number;
  readonly perMinute: number;
}

const RATE_LIMITS: Record<'register' | 'heartbeat' | 'report' | 'claim', RateLimit> = {
  register: { burst: 5, perMinute: 10 },
  heartbeat: { burst: 3, perMinute: 4 },
  report: { burst: 20, perMinute: 60 },
  claim: { burst: 6, perMinute: 12 }
};

const EMPTY_PLAYER: PlayerSnapshot = {
  queue: [], isPlaying: false, positionSec: 0, volume: 1, shuffle: false, repeat: 'off'
};

/** Deterministic in-process backend with the same fences and delivery rules as Convex. */
export class MemoryTransport implements ConnectTransport {
  private readonly devices = new Map<string, ConnectDevice>();
  private readonly listeners = new Map<string, Set<(snapshot: ConnectSnapshot) => void>>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly commandRequests = new Map<string, string>();
  private readonly operationDelays = new Map<MemoryOperation, number[]>();
  private readonly droppedReplies = new Map<MemoryOperation, number>();
  private readonly forcedOffline = new Set<string>();
  private readonly rateEvents = new Map<string, number[]>();
  private commandTimes: number[] = [];
  private state: ConnectPlayerState | undefined;
  private commandSequence = 0;
  private reservationSequence = 0;
  /** Simulate an unavailable transport endpoint. A dropped reply is applied before it is lost. */
  online = true;

  constructor(private readonly now: () => number = Date.now) {}

  /** Test hook: delay the next invocation of this transport method. */
  delayNext(operation: MemoryOperation, milliseconds: number): void {
    const queue = this.operationDelays.get(operation) ?? [];
    queue.push(Math.max(0, milliseconds));
    this.operationDelays.set(operation, queue);
  }

  /** Test hook: apply the next invocation, then simulate its response being lost. */
  dropNextReply(operation: MemoryOperation): void {
    this.droppedReplies.set(operation, (this.droppedReplies.get(operation) ?? 0) + 1);
  }

  /** Test hook: represent presence as offline while leaving the stored registration intact. */
  setDeviceOffline(deviceId: string, offline = true): void {
    if (offline) this.forcedOffline.add(deviceId);
    else this.forcedOffline.delete(deviceId);
    this.publish();
  }

  /** Test hook for exercising the legacy receiver update gate. */
  setProtocolVersion(deviceId: string, protocolVersion: number): void {
    const device = this.devices.get(deviceId);
    if (device) {
      this.devices.set(deviceId, { ...device, protocolVersion });
      this.publish();
    }
  }

  seedState(state: Partial<ConnectPlayerState> & PlayerSnapshot): void {
    const serverNow = this.now();
    this.state = {
      ...state,
      queue: [...state.queue],
      positionAt: state.positionAt ?? serverNow,
      rev: state.rev ?? 0,
      ownershipEpoch: state.ownershipEpoch ?? 0
    };
    this.publish();
  }

  async register(device: DeviceRegistration): Promise<{ readonly serverNow: number }> {
    return this.invoke('register', () => {
      this.limit('register', device.deviceId, 5, 10);
      const serverNow = this.now();
      const row: ConnectDevice = {
        ...device,
        isOnline: !this.forcedOffline.has(device.deviceId),
        protocolVersion: device.protocolVersion ?? 1
      };
      this.devices.set(device.deviceId, row);
      if (!this.state) this.state = { ...EMPTY_PLAYER, positionAt: serverNow, rev: 0, ownershipEpoch: 0 };
      this.publish();
      return { serverNow };
    });
  }

  async heartbeat(deviceId: string): Promise<{ readonly serverNow: number }> {
    return this.invoke('heartbeat', () => {
      this.limit('heartbeat', deviceId, 3, 4);
      const serverNow = this.now();
      const device = this.devices.get(deviceId);
      if (device) this.devices.set(deviceId, { ...device, isOnline: !this.forcedOffline.has(deviceId) });
      this.publish();
      return { serverNow };
    });
  }

  watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void {
    let group = this.listeners.get(deviceId);
    if (!group) { group = new Set(); this.listeners.set(deviceId, group); }
    group.add(listener);
    listener(this.snapshot(deviceId));
    return () => {
      group?.delete(listener);
      if (group?.size === 0) this.listeners.delete(deviceId);
    };
  }

  async report(
    deviceId: string,
    patch: PlayerStatePatch,
    expected: { readonly rev: number; readonly ownershipEpoch: number }
  ): Promise<{ readonly serverNow: number; readonly rev: number }> {
    return this.invoke('report', () => {
      this.limit('report', deviceId, 20, 60);
      const now = this.now();
      const state = this.state;
      if (!state || state.activeDeviceId !== deviceId) throw connectError('device_not_active');
      if (state.ownershipEpoch !== expected.ownershipEpoch) throw connectError('stale_ownership', { currentEpoch: state.ownershipEpoch });
      if (state.rev !== expected.rev) throw connectError('stale_revision', { currentRev: state.rev });
      this.assertPatch(patch);
      const fields: Partial<ConnectPlayerState> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (key === 'song' && value === null) continue;
        (fields as Record<string, unknown>)[key] = key === 'queue' ? [...value as readonly SongSnapshot[]] : value;
      }
      const song = patch.song === undefined ? state.song : patch.song ?? undefined;
      const positionSec = patch.positionSec !== undefined
        ? patch.positionSec
        : patch.isPlaying !== undefined && patch.isPlaying !== state.isPlaying
          ? this.positionAt(state, now)
          : state.positionSec;
      const positionAt = patch.positionSec !== undefined || (patch.isPlaying !== undefined && patch.isPlaying !== state.isPlaying)
        ? now
        : state.positionAt;
      const { song: _previousSong, ...withoutSong } = state;
      this.state = {
        ...withoutSong,
        ...fields,
        ...(song ? { song } : {}),
        positionSec: this.clampPosition(positionSec, song),
        positionAt,
        rev: state.rev + 1
      };
      this.publish();
      return { serverNow: now, rev: this.state.rev };
    });
  }

  async claim(
    deviceId: string,
    snapshot: PlayerSnapshot,
    expectedOwnershipEpoch?: number
  ): Promise<{ readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }> {
    return this.invoke('claim', () => {
      this.limit('claim', deviceId, 6, 12);
      this.requireDevice(deviceId);
      const now = this.now();
      const before = this.state;
      const epoch = before?.ownershipEpoch ?? 0;
      if (expectedOwnershipEpoch !== undefined && expectedOwnershipEpoch !== epoch) {
        throw connectError('stale_ownership', { currentEpoch: epoch });
      }
      const nextEpoch = before?.activeDeviceId === deviceId ? epoch : epoch + 1;
      const rev = (before?.rev ?? 0) + 1;
      this.state = { ...snapshot, queue: [...snapshot.queue], activeDeviceId: deviceId, positionAt: now, rev, ownershipEpoch: nextEpoch };
      if (nextEpoch !== epoch) this.supersedeCommands(epoch);
      this.publish();
      return { serverNow: now, rev, ownershipEpoch: nextEpoch };
    });
  }

  async send(input: {
    readonly fromDeviceId: string;
    readonly targetDeviceId: string;
    readonly requestId: string;
    readonly expectedOwnershipEpoch: number;
    readonly command: RemoteCommand;
  }): Promise<SendReceipt> {
    return this.invoke('send', () => {
      if (input.command.kind === 'take_over') throw connectError('invalid_command');
      const match = this.findRequest(input.fromDeviceId, input.requestId);
      if (match) {
        if (match.targetDeviceId !== input.targetDeviceId || !this.same(match.command, input.command)) throw connectError('request_conflict');
        return this.receipt(match);
      }
      this.requireDevice(input.fromDeviceId);
      const target = this.requireDevice(input.targetDeviceId);
      this.assertV2Target(target);
      this.assertActiveTarget(input.targetDeviceId, input.expectedOwnershipEpoch);
      this.limitCommands();
      this.assertCommand(input.command);
      const now = this.now();
      const row = this.enqueue(input.fromDeviceId, input.targetDeviceId, input.requestId, input.expectedOwnershipEpoch, input.command, now);
      this.publish();
      return this.receipt(row);
    });
  }

  async transfer(input: {
    readonly fromDeviceId: string;
    readonly toDeviceId: string;
    readonly requestId: string;
    readonly expectedOwnershipEpoch: number;
  }): Promise<SendReceipt> {
    return this.invoke('transfer', () => {
      const match = this.findRequest(input.fromDeviceId, input.requestId);
      if (match) {
        if (match.targetDeviceId !== input.toDeviceId || match.command.kind !== 'take_over') throw connectError('request_conflict');
        return this.receipt(match);
      }
      this.requireDevice(input.fromDeviceId);
      this.assertV2Target(this.requireDevice(input.toDeviceId));
      this.assertActiveTarget(this.state?.activeDeviceId, input.expectedOwnershipEpoch);
      const state = this.state;
      if (!state?.song) throw connectError('player_state_missing');
      this.limitCommands();
      const now = this.now();
      // Exactly what convex/connect.ts transferState sends: no active device, no handoff.
      const takeover: TransferState = {
        ...(state.song ? { song: state.song } : {}),
        queue: [...state.queue], isPlaying: state.isPlaying, positionSec: state.positionSec,
        positionAt: state.positionAt, volume: state.volume, shuffle: state.shuffle, repeat: state.repeat,
        rev: state.rev, ownershipEpoch: state.ownershipEpoch
      };
      const row = this.enqueue(input.fromDeviceId, input.toDeviceId, input.requestId, input.expectedOwnershipEpoch, { kind: 'take_over', state: takeover }, now);
      this.publish();
      return this.receipt(row);
    });
  }

  async begin(deviceId: string, commandId: string): Promise<{ readonly reservationToken: string; readonly serverNow: number; readonly executeBefore: number }> {
    return this.invoke('begin', () => {
      const row = this.requireTargeted(deviceId, commandId);
      const now = this.now();
      this.assertRunnable(row, deviceId, now);
      const first = row.beganAt === undefined;
      row.reservationToken ??= `memory-reservation-${++this.reservationSequence}`;
      row.beganAt ??= now;
      // Convex re-runs the sender's outcomesFor on this write; it now shows `began`.
      if (first) this.publish();
      return { reservationToken: row.reservationToken, serverNow: now, executeBefore: this.deadline(row) };
    });
  }

  async prepare(deviceId: string, commandId: string, reservationToken: string): Promise<PrepareResult> {
    return this.invoke('prepare', () => {
      const row = this.requireTargeted(deviceId, commandId);
      if (row.command.kind !== 'take_over') throw connectError('invalid_command');
      const now = this.now();
      this.assertRunnable(row, deviceId, now);
      this.assertReservation(row, reservationToken);
      const state = this.state;
      if (!state?.song) throw connectError('player_state_missing');
      if (row.release) return {
        status: 'activated', serverNow: now, rev: state.rev, ownershipEpoch: state.ownershipEpoch,
        positionSec: row.release.positionSec, resume: row.release.resume
      };

      const ownerId = state.activeDeviceId;
      if (ownerId !== undefined && ownerId !== deviceId && state.isPlaying) {
        const current = state.handoff;
        if (current && current.commandId !== row.id) {
          const replaced = this.commands.get(current.commandId);
          if (replaced?.status === 'pending') this.fail(replaced, 'superseded');
        }
        this.state = { ...state, handoff: { commandId, toDeviceId: deviceId } };
        this.publish();
        return { status: 'awaiting_release', serverNow: now };
      }

      const positionSec = this.clampPosition(state.isPlaying ? this.positionAt(state, now) : state.positionSec, state.song);
      const resume = state.isPlaying;
      const epoch = state.ownershipEpoch + (ownerId === deviceId ? 0 : 1);
      const { handoff: _handoff, ...withoutHandoff } = state;
      const activated: ConnectPlayerState = { ...withoutHandoff, activeDeviceId: deviceId, ownershipEpoch: epoch, isPlaying: false, positionSec, positionAt: now, rev: state.rev + 1 };
      this.state = activated;
      row.release = { positionSec, resume };
      if (epoch !== state.ownershipEpoch) this.supersedeCommands(state.ownershipEpoch, row.id);
      this.publish();
      return { status: 'activated', serverNow: now, rev: activated.rev, ownershipEpoch: epoch, positionSec, resume };
    });
  }

  async release(input: {
    readonly deviceId: string;
    readonly commandId: string;
    readonly expectedOwnershipEpoch: number;
    readonly positionSec: number;
    readonly resume: boolean;
  }): Promise<{ readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }> {
    return this.invoke('release', () => {
      this.requireDevice(input.deviceId);
      if (!Number.isFinite(input.positionSec) || input.positionSec < 0) throw connectError('invalid_command');
      const row = this.commands.get(input.commandId);
      const state = this.state;
      const now = this.now();
      if (row?.release && state && state.ownershipEpoch === input.expectedOwnershipEpoch + 1 && state.activeDeviceId === row.targetDeviceId) {
        return { serverNow: now, rev: state.rev, ownershipEpoch: state.ownershipEpoch };
      }
      if (!state || state.activeDeviceId !== input.deviceId) throw connectError('device_not_active');
      if (state.ownershipEpoch !== input.expectedOwnershipEpoch) throw connectError('stale_ownership', { currentEpoch: state.ownershipEpoch });
      if (!row || row.status !== 'pending' || state.handoff?.commandId !== input.commandId) throw connectError('handoff_missing');
      if (now >= this.deadline(row)) throw connectError('command_expired');
      const positionSec = this.clampPosition(input.positionSec, state.song);
      const ownershipEpoch = state.ownershipEpoch + 1;
      const { handoff: _handoff, ...withoutHandoff } = state;
      this.state = { ...withoutHandoff, activeDeviceId: row.targetDeviceId, ownershipEpoch, isPlaying: false, positionSec, positionAt: now, rev: state.rev + 1 };
      row.release = { positionSec, resume: input.resume };
      this.supersedeCommands(input.expectedOwnershipEpoch, row.id);
      this.publish();
      return { serverNow: now, rev: state.rev + 1, ownershipEpoch };
    });
  }

  async complete(input: {
    readonly deviceId: string;
    readonly commandId: string;
    readonly reservationToken: string;
    readonly outcome: CommandOutcomeInput;
    readonly patch?: PlayerStatePatch;
    readonly rev?: number;
  }): Promise<CompleteResult> {
    return this.invoke('complete', () => {
      const row = this.requireTargeted(input.deviceId, input.commandId);
      const now = this.now();
      const state = this.state;
      if (row.status !== 'pending') return { status: 'completed', serverNow: now, rev: state?.rev ?? 0, ownershipEpoch: state?.ownershipEpoch ?? 0 };
      if (row.reservationToken !== undefined) this.assertReservation(row, input.reservationToken);
      else if (input.outcome.ok) throw connectError('reservation_mismatch');
      if (input.outcome.ok === false && !this.isFailure(input.outcome.code)) throw connectError('invalid_command');
      const hasPatch = input.patch !== undefined && Object.values(input.patch).some((value) => value !== undefined);
      if (input.patch && hasPatch) this.assertPatch(input.patch);

      if (!row.release && now >= this.deadline(row)) {
        this.fail(row, 'expired');
        this.publish();
        return { status: 'completed', serverNow: now, rev: state?.rev ?? 0, ownershipEpoch: state?.ownershipEpoch ?? 0 };
      }
      if (!row.release && row.expectedOwnershipEpoch !== undefined && row.expectedOwnershipEpoch !== (state?.ownershipEpoch ?? 0)) {
        this.fail(row, 'superseded');
        this.publish();
        return { status: 'completed', serverNow: now, rev: state?.rev ?? 0, ownershipEpoch: state?.ownershipEpoch ?? 0 };
      }
      if (input.outcome.ok === false) {
        this.fail(row, input.outcome.code, input.outcome.error);
        this.publish();
        return { status: 'completed', serverNow: now, rev: state?.rev ?? 0, ownershipEpoch: state?.ownershipEpoch ?? 0 };
      }
      if (row.command.kind === 'take_over' && row.requestId !== undefined && !row.release) throw connectError('handoff_missing');

      let rev = state?.rev ?? 0;
      if (input.patch && hasPatch) {
        if (!state || state.activeDeviceId !== input.deviceId) throw connectError('device_not_active');
        if (input.rev !== state.rev) return { status: 'conflict', serverNow: now, currentRev: state.rev };
        rev = this.applyPatch(input.deviceId, input.patch, now);
      }
      row.status = 'done';
      this.clearHandoff(row);
      this.publish();
      return { status: 'completed', serverNow: now, rev, ownershipEpoch: this.state?.ownershipEpoch ?? 0 };
    });
  }

  private async invoke<T>(operation: MemoryOperation, apply: () => T): Promise<T> {
    const delay = this.operationDelays.get(operation)?.shift() ?? 0;
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (!this.online) throw connectError('offline');
    const value = apply();
    const remainingDrops = this.droppedReplies.get(operation) ?? 0;
    if (remainingDrops > 0) {
      if (remainingDrops === 1) this.droppedReplies.delete(operation);
      else this.droppedReplies.set(operation, remainingDrops - 1);
      throw connectError('offline');
    }
    return value;
  }

  private requireDevice(deviceId: string): ConnectDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw connectError('device_not_registered');
    return device;
  }

  private requireTargeted(deviceId: string, commandId: string): StoredCommand {
    const row = this.commands.get(commandId);
    if (!row) throw connectError('command_not_found');
    if (row.targetDeviceId !== deviceId) throw connectError('command_not_target');
    this.requireDevice(deviceId);
    return row;
  }

  private assertV2Target(device: ConnectDevice): void {
    if (!device.canPlay) throw connectError('target_cannot_play');
    if (device.protocolVersion < V2) throw connectError('update_required');
  }

  private assertActiveTarget(targetDeviceId: string | undefined, expectedEpoch: number): void {
    const state = this.state;
    if (!state) throw connectError('player_state_missing');
    if (state.activeDeviceId !== targetDeviceId) throw connectError('target_not_active', { activeDeviceId: state.activeDeviceId });
    if (state.ownershipEpoch !== expectedEpoch) throw connectError('stale_ownership', { currentEpoch: state.ownershipEpoch });
  }

  private assertRunnable(row: StoredCommand, deviceId: string, now: number): void {
    if (row.status !== 'pending') {
      if (row.errorCode === 'expired') throw connectError('command_expired');
      if (row.errorCode === 'superseded') throw connectError('stale_ownership', { currentEpoch: this.state?.ownershipEpoch ?? 0 });
      if (row.errorCode === 'cannot_play') throw connectError('target_cannot_play');
      throw connectError('command_not_found');
    }
    if (!row.release && now >= this.deadline(row)) {
      throw connectError('command_expired');
    }
    if (!row.release && row.expectedOwnershipEpoch !== undefined && row.expectedOwnershipEpoch !== (this.state?.ownershipEpoch ?? 0)) {
      throw connectError('stale_ownership', { currentEpoch: this.state?.ownershipEpoch ?? 0 });
    }
    if (!this.requireDevice(deviceId).canPlay) {
      throw connectError('target_cannot_play');
    }
  }

  private assertReservation(row: StoredCommand, token: string): void {
    if (!row.reservationToken || row.reservationToken !== token) throw connectError('reservation_mismatch');
  }

  private findRequest(fromDeviceId: string, requestId: string): StoredCommand | undefined {
    const key = `${fromDeviceId}\u0000${requestId}`;
    const id = this.commandRequests.get(key);
    return id ? this.commands.get(id) : undefined;
  }

  private enqueue(fromDeviceId: string, targetDeviceId: string, requestId: string, expectedOwnershipEpoch: number, command: RemoteCommand, now: number): StoredCommand {
    const id = `memory-command-${++this.commandSequence}`;
    const duration = command.kind === 'play_song' || command.kind === 'queue_add' || command.kind === 'take_over' ? LOAD_DEADLINE_MS : CONTROL_DEADLINE_MS;
    const row: StoredCommand = {
      id, sourceDeviceId: fromDeviceId, targetDeviceId, command, createdAt: now, requestId,
      executeBefore: now + duration, expectedOwnershipEpoch, status: 'pending'
    };
    this.commands.set(id, row);
    this.commandRequests.set(`${fromDeviceId}\u0000${requestId}`, id);
    return row;
  }

  private receipt(row: StoredCommand): SendReceipt {
    return {
      commandId: row.id,
      serverNow: this.now(),
      executeBefore: row.executeBefore ?? row.createdAt + LEGACY_COMMAND_TTL_MS,
      ownershipEpoch: row.expectedOwnershipEpoch ?? this.state?.ownershipEpoch ?? 0
    };
  }

  private deadline(row: StoredCommand): number { return row.executeBefore ?? row.createdAt + LEGACY_COMMAND_TTL_MS; }

  private limitCommands(): void {
    const now = this.now();
    this.commandTimes = this.commandTimes.filter((value) => now - value < 10_000);
    if (this.commandTimes.length >= 20) throw connectError('rate_limited', { retryAfterMs: Math.max(1, 10_000 - (now - this.commandTimes[0]!)) });
    this.commandTimes.push(now);
  }

  private limit(operation: keyof typeof RATE_LIMITS, deviceId: string, burst: number, perMinute: number): void {
    const now = this.now();
    const key = `${operation}\u0000${deviceId}`;
    const recent = (this.rateEvents.get(key) ?? []).filter((value) => now - value < 60_000);
    const burstEvents = recent.filter((value) => now - value < 1_000);
    const limit = RATE_LIMITS[operation];
    const actualBurst = Math.min(burst, limit.burst);
    const actualPerMinute = Math.min(perMinute, limit.perMinute);
    if (burstEvents.length >= actualBurst) throw connectError('rate_limited', { retryAfterMs: Math.max(1, 1_000 - (now - burstEvents[0]!)) });
    if (recent.length >= actualPerMinute) throw connectError('rate_limited', { retryAfterMs: Math.max(1, 60_000 - (now - recent[0]!)) });
    recent.push(now);
    this.rateEvents.set(key, recent);
  }

  private supersedeCommands(oldEpoch: number, keepId?: string): void {
    for (const row of this.commands.values()) {
      if (row.id === keepId || row.status !== 'pending' || row.expectedOwnershipEpoch === undefined || row.expectedOwnershipEpoch > oldEpoch) continue;
      this.fail(row, 'superseded');
    }
  }

  private fail(row: StoredCommand, code: NonNullable<CommandOutcome['errorCode']>, error?: string): void {
    row.status = 'failed';
    row.errorCode = code;
    row.error = (error?.trim() || FAILURE_TEXT[code]).slice(0, 240);
    this.clearHandoff(row);
  }

  private clearHandoff(row: StoredCommand): void {
    if (this.state?.handoff?.commandId === row.id) {
      const { handoff: _handoff, ...state } = this.state;
      this.state = state;
    }
  }

  private applyPatch(deviceId: string, patch: PlayerStatePatch, now: number): number {
    const state = this.state;
    if (!state) return 0;
    const song = patch.song === undefined ? state.song : patch.song ?? undefined;
    const anchorPosition = patch.positionSec !== undefined
      ? patch.positionSec
      : patch.isPlaying !== undefined && patch.isPlaying !== state.isPlaying
        ? this.positionAt(state, now)
        : state.positionSec;
    const { song: _previousSong, ...withoutSong } = state;
    this.state = {
      ...withoutSong,
      ...(song ? { song } : {}),
      ...(patch.queue === undefined ? {} : { queue: [...patch.queue] }),
      ...(patch.isPlaying === undefined ? {} : { isPlaying: patch.isPlaying }),
      ...(patch.positionSec === undefined && (patch.isPlaying === undefined || patch.isPlaying === state.isPlaying) ? {} : { positionSec: this.clampPosition(anchorPosition, song), positionAt: now }),
      ...(patch.volume === undefined ? {} : { volume: patch.volume }),
      ...(patch.shuffle === undefined ? {} : { shuffle: patch.shuffle }),
      ...(patch.repeat === undefined ? {} : { repeat: patch.repeat }),
      rev: state.rev + 1
    };
    return this.state.rev;
  }

  private assertPatch(patch: PlayerStatePatch): void {
    if (!Object.values(patch).some((value) => value !== undefined)) throw connectError('invalid_command');
    if (patch.positionSec !== undefined && (!Number.isFinite(patch.positionSec) || patch.positionSec < 0)) throw connectError('invalid_command');
    if (patch.volume !== undefined && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 1)) throw connectError('invalid_command');
    if (patch.queue && (!Array.isArray(patch.queue) || patch.queue.length > 100)) throw connectError('invalid_command');
    if (patch.song) this.assertSong(patch.song);
    for (const item of patch.queue ?? []) this.assertSong(item);
    if (patch.repeat !== undefined && patch.repeat !== 'off' && patch.repeat !== 'all' && patch.repeat !== 'one') throw connectError('invalid_command');
  }

  private assertCommand(command: RemoteCommand): void {
    if (command.kind === 'seek' && (!Number.isFinite(command.sec) || command.sec < 0)) throw connectError('invalid_command');
    if (command.kind === 'volume' && (!Number.isFinite(command.v) || command.v < 0 || command.v > 1)) throw connectError('invalid_command');
    if (command.kind === 'play_song' || command.kind === 'queue_add') this.assertSong(command.song);
    if (command.kind === 'play_song') for (const item of command.queue ?? []) this.assertSong(item);
  }

  private assertSong(song: SongSnapshot): void {
    if (!song || typeof song.ref !== 'string' || !song.ref.length || typeof song.title !== 'string' || !song.title.trim() ||
        typeof song.artist !== 'string' || typeof song.duration !== 'number' || !Number.isFinite(song.duration) || song.duration < 0) {
      throw connectError('invalid_command');
    }
  }

  private positionAt(state: ConnectPlayerState, now: number): number {
    if (!state.isPlaying) return state.positionSec;
    return this.clampPosition(state.positionSec + Math.max(0, now - state.positionAt) / 1000, state.song);
  }

  private clampPosition(positionSec: number, song: SongSnapshot | undefined): number {
    const value = Math.max(0, positionSec);
    return song && song.duration > 0 ? Math.min(value, song.duration) : value;
  }

  private same(left: unknown, right: unknown): boolean {
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    };
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  }

  private isFailure(value: unknown): value is NonNullable<CommandOutcome['errorCode']> {
    return value === 'needs_gesture' || value === 'not_found' || value === 'expired' || value === 'superseded' ||
      value === 'cannot_play' || value === 'owner_unreachable' || value === 'command_failed';
  }

  private snapshot(deviceId: string): ConnectSnapshot {
    const inbox = [...this.commands.values()]
      .filter((row) => row.targetDeviceId === deviceId && row.status === 'pending')
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .slice(0, 50)
      .map((row): InboxCommand => ({
        id: row.id, sourceDeviceId: row.sourceDeviceId, command: row.command, createdAt: row.createdAt,
        ...(row.requestId ? { requestId: row.requestId } : {}),
        ...(row.executeBefore !== undefined ? { executeBefore: row.executeBefore } : {}),
        ...(row.expectedOwnershipEpoch !== undefined ? { expectedOwnershipEpoch: row.expectedOwnershipEpoch } : {}),
        ...(row.reservationToken ? { reservationToken: row.reservationToken } : {}),
        ...(row.release ? { release: row.release } : {})
      }));
    const outcomes = [...this.commands.values()]
      .filter((row) => row.sourceDeviceId === deviceId)
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, 20)
      .reverse()
      .map((row): CommandOutcome => ({
        id: row.id, targetDeviceId: row.targetDeviceId, kind: row.command.kind, createdAt: row.createdAt,
        status: row.status,
        ...(row.requestId ? { requestId: row.requestId } : {}),
        ...(row.status === 'pending' && row.beganAt !== undefined ? { began: true } : {}),
        ...(row.errorCode ? { errorCode: row.errorCode } : {}),
        ...(row.error ? { error: row.error } : {})
      }));
    return {
      devices: [...this.devices.values()].map((device) => ({ ...device })),
      ...(this.state ? { state: { ...this.state, queue: [...this.state.queue] } } : {}),
      inbox,
      outcomes
    };
  }

  private publish(): void {
    for (const [deviceId, listeners] of this.listeners) {
      const value = this.snapshot(deviceId);
      for (const listener of [...listeners]) {
        try { listener(value); } catch { /* A subscriber cannot roll back a committed test mutation. */ }
      }
    }
  }
}
