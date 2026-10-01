import type { SongSnapshot } from '../../shared/songRef.ts';
import { estimateSerializedByteLength } from './developmentTrace.ts';
import { connectError } from './errors.ts';
import { isFailureCode } from './errors.ts';
import type {
  CommandOutcome, ConnectDevice, ConnectPlayerState, ConnectSnapshot, ConnectTraceWriter,
  ConnectTransport, DeviceRegistration, InboxCommand, PlayerSnapshot, PlayerStatePatch,
  PrepareResult, RemoteCommand, RepeatMode, TransferState
} from './types.ts';

/** Small Convex surface injected by web and mobile, keeping Convex out of the shared package. */
export interface ConvexWireClient {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  watchQuery(name: string, args: Record<string, unknown>): {
    onUpdate(callback: () => void): () => void;
    current(): unknown;
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string';
const repeat = (value: unknown): value is RepeatMode => value === 'off' || value === 'all' || value === 'one';

function requiredNumber(value: unknown): number {
  if (!finite(value)) throw connectError('offline');
  return value;
}

function song(value: unknown): SongSnapshot | undefined {
  const album = record(value) ? value.album : undefined;
  if (!record(value) || !text(value.ref) || !text(value.title) || !value.title.trim() || !text(value.artist) ||
      !text(value.artwork) || !finite(value.duration) || value.duration < 0 ||
      (album !== undefined && !text(album))) return undefined;
  return {
    ref: value.ref as SongSnapshot['ref'],
    title: value.title,
    artist: value.artist,
    ...(album === undefined ? {} : { album: album as string }),
    artwork: value.artwork,
    duration: value.duration
  };
}

function playerSnapshot(value: unknown): PlayerSnapshot | undefined {
  if (!record(value) || !Array.isArray(value.queue) || typeof value.isPlaying !== 'boolean' ||
      !finite(value.positionSec) || value.positionSec < 0 || !finite(value.volume) || value.volume < 0 || value.volume > 1 ||
      typeof value.shuffle !== 'boolean' || !repeat(value.repeat)) return undefined;
  const current = value.song === undefined || value.song === null ? undefined : song(value.song);
  if (value.song !== undefined && value.song !== null && !current) return undefined;
  const queue = value.queue.map(song);
  if (queue.some((item) => item === undefined)) return undefined;
  return {
    ...(current ? { song: current } : {}),
    queue: queue as SongSnapshot[],
    isPlaying: value.isPlaying,
    positionSec: value.positionSec,
    volume: value.volume,
    shuffle: value.shuffle,
    repeat: value.repeat
  };
}

function playerState(value: unknown): ConnectPlayerState | undefined {
  if (!record(value) || !finite(value.positionAt) || !Number.isInteger(value.rev) || !finite(value.rev) ||
      !Number.isInteger(value.ownershipEpoch) || !finite(value.ownershipEpoch)) return undefined;
  const base = playerSnapshot(value);
  if (!base) return undefined;
  const activeDeviceId = value.activeDeviceId;
  if (activeDeviceId !== undefined && !text(activeDeviceId)) return undefined;
  let handoff: ConnectPlayerState['handoff'];
  if (value.handoff !== undefined) {
    if (!record(value.handoff) || !text(value.handoff.commandId) || !text(value.handoff.toDeviceId)) return undefined;
    handoff = { commandId: value.handoff.commandId, toDeviceId: value.handoff.toDeviceId };
  }
  return {
    ...base,
    ...(activeDeviceId === undefined ? {} : { activeDeviceId: activeDeviceId as string }),
    positionAt: value.positionAt,
    rev: value.rev,
    ownershipEpoch: value.ownershipEpoch,
    ...(handoff ? { handoff } : {})
  };
}

/**
 * A `take_over` payload (the contract's PlayerStateSnapshot). Unlike the live state it need not
 * carry an epoch: requiring one dropped every transfer the server sent without it, and the
 * command then expired unseen on the target.
 */
function transferState(value: unknown): TransferState | undefined {
  if (!record(value) || !finite(value.positionAt) || !Number.isInteger(value.rev) || !finite(value.rev)) return undefined;
  const base = playerSnapshot(value);
  if (!base) return undefined;
  const epoch = value.ownershipEpoch;
  if (epoch !== undefined && (!Number.isInteger(epoch) || !finite(epoch))) return undefined;
  return {
    ...base,
    positionAt: value.positionAt,
    rev: value.rev,
    ...(epoch === undefined ? {} : { ownershipEpoch: epoch as number })
  };
}

function command(kind: unknown, args: unknown): RemoteCommand | undefined {
  const value = record(args) ? args : {};
  switch (kind) {
    case 'play': case 'pause': case 'next': case 'prev': return { kind };
    case 'seek': return finite(value.sec) && value.sec >= 0 ? { kind, sec: value.sec } : undefined;
    case 'volume': return finite(value.v) && value.v >= 0 && value.v <= 1 ? { kind, v: value.v } : undefined;
    case 'shuffle': return typeof value.on === 'boolean' ? { kind, on: value.on } : undefined;
    case 'repeat': return repeat(value.mode) ? { kind, mode: value.mode } : undefined;
    case 'play_song': {
      const selected = song(value.song);
      const queueValue = value.queue;
      if (!selected || (queueValue !== undefined && (!Array.isArray(queueValue) || queueValue.length > 50))) return undefined;
      const queue = queueValue === undefined ? undefined : (queueValue as unknown[]).map(song);
      if (queue?.some((item) => item === undefined)) return undefined;
      return { kind, song: selected, ...(queue ? { queue: queue as SongSnapshot[] } : {}) };
    }
    case 'queue_add': {
      const selected = song(value.song);
      return selected ? { kind, song: selected } : undefined;
    }
    case 'take_over': {
      const state = transferState(value.state);
      return state ? { kind, state } : undefined;
    }
    default: return undefined;
  }
}

function devices(value: unknown): readonly ConnectDevice[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoded: ConnectDevice[] = [];
  for (const item of value) {
    if (!record(item) || !text(item.deviceId) || !text(item.name) ||
        (item.kind !== 'web' && item.kind !== 'android' && item.kind !== 'ios') ||
        !text(item.appVersion) || typeof item.canPlay !== 'boolean' || typeof item.isOnline !== 'boolean') continue;
    decoded.push({
      deviceId: item.deviceId, name: item.name, kind: item.kind, appVersion: item.appVersion,
      canPlay: item.canPlay, isOnline: item.isOnline,
      protocolVersion: Number.isInteger(item.protocolVersion) && finite(item.protocolVersion) ? item.protocolVersion : 1
    });
  }
  return decoded;
}

function inboxRows(value: unknown): readonly InboxCommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoded: InboxCommand[] = [];
  for (const row of value) {
    if (!record(row) || !text(row.commandId) || !text(row.sourceDeviceId) || !finite(row.createdAt)) continue;
    const decodedCommand = command(row.kind, row.args);
    if (!decodedCommand) continue;
    const item: InboxCommand = {
      id: row.commandId, sourceDeviceId: row.sourceDeviceId, command: decodedCommand, createdAt: row.createdAt,
      ...(text(row.requestId) ? { requestId: row.requestId } : {}),
      ...(finite(row.executeBefore) ? { executeBefore: row.executeBefore } : {}),
      ...(Number.isInteger(row.expectedOwnershipEpoch) && finite(row.expectedOwnershipEpoch) ? { expectedOwnershipEpoch: row.expectedOwnershipEpoch } : {})
    };
    if (row.release !== undefined) {
      if (!record(row.release) || !finite(row.release.positionSec) || typeof row.release.resume !== 'boolean') continue;
      decoded.push({ ...item, release: { positionSec: row.release.positionSec, resume: row.release.resume } });
    } else decoded.push(item);
  }
  return decoded.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function outcomes(value: unknown): readonly CommandOutcome[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decoded: CommandOutcome[] = [];
  for (const row of value) {
    if (!record(row) || !text(row.commandId) || !text(row.targetDeviceId) || !finite(row.createdAt) ||
        (row.status !== 'pending' && row.status !== 'done' && row.status !== 'failed')) continue;
    const kind = row.kind;
    if (kind !== 'play' && kind !== 'pause' && kind !== 'seek' && kind !== 'next' && kind !== 'prev' && kind !== 'volume' &&
        kind !== 'shuffle' && kind !== 'repeat' && kind !== 'play_song' && kind !== 'queue_add' && kind !== 'take_over') continue;
    const errorCode = isFailureCode(row.errorCode) ? row.errorCode : undefined;
    const error = text(row.error) ? row.error.slice(0, 240) : undefined;
    decoded.push({
      id: row.commandId, targetDeviceId: row.targetDeviceId, kind, createdAt: row.createdAt,
      status: row.status,
      ...(text(row.requestId) ? { requestId: row.requestId } : {}),
      ...(row.status === 'pending' && row.began === true ? { began: true } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(error ? { error } : {})
    });
  }
  return decoded;
}

function decodeCurrent<T>(value: unknown, decode: (value: unknown) => T | undefined): T | undefined {
  try { return decode(value); } catch { return undefined; }
}

/** One validated Convex adapter shared by the browser and phone. */
export function createConvexTransport(client: ConvexWireClient, options: { readonly trace?: ConnectTraceWriter } = {}): ConnectTransport {
  const mutate = (name: string, args: Record<string, unknown>) => client.mutation(`connect:${name}`, args);
  const sample = (operation: 'devices_query' | 'state_query' | 'inbox_query' | 'outcomes_query', value: unknown): void => {
    if (!options.trace) return;
    try {
      const payloadBytes = estimateSerializedByteLength(value);
      options.trace.record({ event: 'query.delivered', operation, count: 1, ...(payloadBytes === undefined ? {} : { payloadBytes }) });
    } catch { /* tracing is advisory */ }
  };
  return {
    async register(device: DeviceRegistration) {
      const result = await mutate('register', device as unknown as Record<string, unknown>);
      if (!record(result)) throw connectError('offline');
      return { serverNow: requiredNumber(result.serverNow) };
    },
    async heartbeat(deviceId) {
      const result = await mutate('heartbeat', { deviceId });
      if (!record(result)) throw connectError('offline');
      return { serverNow: requiredNumber(result.serverNow) };
    },
    watch(deviceId, listener) {
      let deviceRows: readonly ConnectDevice[] | undefined;
      let state: ConnectPlayerState | null | undefined;
      let inbox: readonly InboxCommand[] | undefined;
      let outcomeRows: readonly CommandOutcome[] | undefined;
      const publish = (): void => {
        if (!deviceRows || state === undefined || !inbox || !outcomeRows) return;
        listener({ devices: deviceRows, ...(state ? { state } : {}), inbox, outcomes: outcomeRows });
      };
      const watches = [
        { name: 'devices', args: {}, decode: (value: unknown) => decodeCurrent(value, devices), set: (value: unknown) => { deviceRows = decodeCurrent(value, devices); sample('devices_query', value); } },
        { name: 'state', args: {}, decode: (value: unknown) => value === null ? null : decodeCurrent(value, playerState), set: (value: unknown) => { state = value === null ? null : decodeCurrent(value, playerState); sample('state_query', value); } },
        { name: 'inboxFor', args: { deviceId }, decode: (value: unknown) => decodeCurrent(value, inboxRows), set: (value: unknown) => { inbox = decodeCurrent(value, inboxRows); sample('inbox_query', value); } },
        { name: 'outcomesFor', args: { deviceId }, decode: (value: unknown) => decodeCurrent(value, outcomes), set: (value: unknown) => { outcomeRows = decodeCurrent(value, outcomes); sample('outcomes_query', value); } }
      ];
      const subscriptions = watches.map((query) => {
        const watch = client.watchQuery(`connect:${query.name}`, query.args);
        const stop = watch.onUpdate(() => {
          try { query.set(watch.current()); } catch { /* keep waiting for a valid server result */ }
          publish();
        });
        try { query.set(watch.current()); } catch { /* no cached server result yet */ }
        return stop;
      });
      publish();
      return () => subscriptions.forEach((stop) => stop());
    },
    async report(deviceId, patch: PlayerStatePatch, expected) {
      const value = await mutate('report', { deviceId, patch, rev: expected.rev, expectedOwnershipEpoch: expected.ownershipEpoch });
      if (!record(value)) throw connectError('offline');
      return { serverNow: requiredNumber(value.serverNow), rev: requiredNumber(value.rev) };
    },
    async claim(deviceId, snapshot: PlayerSnapshot, expectedOwnershipEpoch) {
      const value = await mutate('claim', { deviceId, snapshot, ...(expectedOwnershipEpoch === undefined ? {} : { expectedOwnershipEpoch }) });
      if (!record(value)) throw connectError('offline');
      return {
        serverNow: requiredNumber(value.serverNow), rev: requiredNumber(value.rev),
        ownershipEpoch: requiredNumber(value.ownershipEpoch)
      };
    },
    async send(input) {
      if (input.command.kind === 'take_over') throw connectError('invalid_command');
      const { kind, ...args } = input.command;
      const { command: _command, ...request } = input;
      const value = await mutate('sendV2', { ...request, kind, ...(Object.keys(args).length ? { args } : {}) });
      if (!record(value) || !text(value.commandId)) throw connectError('offline');
      return {
        commandId: value.commandId, serverNow: requiredNumber(value.serverNow),
        executeBefore: requiredNumber(value.executeBefore), ownershipEpoch: requiredNumber(value.ownershipEpoch)
      };
    },
    async transfer(input) {
      const value = await mutate('transferV2', input);
      if (!record(value) || !text(value.commandId)) throw connectError('offline');
      return {
        commandId: value.commandId, serverNow: requiredNumber(value.serverNow),
        executeBefore: requiredNumber(value.executeBefore), ownershipEpoch: requiredNumber(value.ownershipEpoch)
      };
    },
    async begin(deviceId, commandId) {
      const value = await mutate('beginV2', { deviceId, commandId });
      if (!record(value) || !text(value.reservationToken)) throw connectError('offline');
      return { reservationToken: value.reservationToken, serverNow: requiredNumber(value.serverNow), executeBefore: requiredNumber(value.executeBefore) };
    },
    async prepare(deviceId, commandId, reservationToken): Promise<PrepareResult> {
      const value = await mutate('prepareV2', { deviceId, commandId, reservationToken });
      if (!record(value) || (value.status !== 'activated' && value.status !== 'awaiting_release')) throw connectError('offline');
      if (value.status === 'awaiting_release') return { status: 'awaiting_release', serverNow: requiredNumber(value.serverNow) };
      if (typeof value.resume !== 'boolean') throw connectError('offline');
      return {
        status: 'activated', serverNow: requiredNumber(value.serverNow), rev: requiredNumber(value.rev),
        ownershipEpoch: requiredNumber(value.ownershipEpoch), positionSec: requiredNumber(value.positionSec), resume: value.resume
      };
    },
    async release(input) {
      const value = await mutate('releaseV2', input);
      if (!record(value)) throw connectError('offline');
      return {
        serverNow: requiredNumber(value.serverNow), rev: requiredNumber(value.rev),
        ownershipEpoch: requiredNumber(value.ownershipEpoch)
      };
    },
    async complete(input) {
      const value = await mutate('completeV2', input as unknown as Record<string, unknown>);
      if (!record(value) || (value.status !== 'completed' && value.status !== 'conflict')) throw connectError('offline');
      return value.status === 'conflict'
        ? { status: 'conflict', serverNow: requiredNumber(value.serverNow), currentRev: requiredNumber(value.currentRev) }
        : {
            status: 'completed', serverNow: requiredNumber(value.serverNow), rev: requiredNumber(value.rev),
            ownershipEpoch: requiredNumber(value.ownershipEpoch)
          };
    }
  };
}

/** Exported for adapters' regression tests; all malformed rows are dropped instead of cast. */
export const decodeInbox = inboxRows;
export const decodeOutcomes = outcomes;
