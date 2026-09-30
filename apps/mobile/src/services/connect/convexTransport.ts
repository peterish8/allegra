import { makeFunctionReference } from 'convex/server';
import type { ConvexReactClient } from 'convex/react';

import type { SongSnapshot } from '@shared/songRef';
import type {
  ConnectCommand,
  ConnectDevice,
  ConnectPlayerState,
  ConnectSnapshot,
  ConnectTransport,
  DeviceRegistration,
  MutationResult,
  PlayerSnapshot,
  PlayerStatePatch,
  RemoteCommand,
  RepeatMode,
} from '../../../../../packages/connect/src/index';

interface DeviceRow {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: 'web' | 'android' | 'ios';
  readonly appVersion: string;
  readonly canPlay: boolean;
  readonly isOnline: boolean;
  readonly isActive: boolean;
}

interface CommandRow {
  readonly commandId: string;
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly kind: RemoteCommand['kind'];
  readonly args?: Record<string, unknown>;
  readonly createdAt: number;
  readonly status: 'pending' | 'done' | 'failed';
  readonly error?: string;
}

const registerRef = makeFunctionReference<'mutation', { deviceId: string; name: string; kind: 'web' | 'android' | 'ios'; appVersion: string; canPlay: boolean }, MutationResult>('connect:register');
const heartbeatRef = makeFunctionReference<'mutation', { deviceId: string }, MutationResult>('connect:heartbeat');
const devicesRef = makeFunctionReference<'query', Record<string, never>, DeviceRow[]>('connect:devices');
const stateRef = makeFunctionReference<'query', Record<string, never>, ConnectPlayerState | null>('connect:state');
const commandsRef = makeFunctionReference<'query', { deviceId: string }, CommandRow[]>('connect:commandsFor');
const reportRef = makeFunctionReference<'mutation', { deviceId: string; patch: PlayerStatePatch; rev: number }, MutationResult>('connect:report');
const claimRef = makeFunctionReference<'mutation', { deviceId: string; snapshot: PlayerSnapshot }, MutationResult>('connect:claim');
const sendRef = makeFunctionReference<
  'mutation',
  { fromDeviceId: string; targetDeviceId: string; kind: RemoteCommand['kind']; args?: Record<string, unknown> },
  { commandId: string; serverNow: number }
>('connect:send');
const ackRef = makeFunctionReference<'mutation', { deviceId: string; commandId: string; ok: boolean; error?: string }, MutationResult>('connect:ack');
const transferRef = makeFunctionReference<
  'mutation',
  { fromDeviceId: string; toDeviceId: string },
  { commandId: string; serverNow: number }
>('connect:transfer');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function commandFor(row: CommandRow): RemoteCommand | null {
  const args = row.args ?? {};
  switch (row.kind) {
    case 'play':
    case 'pause':
    case 'next':
    case 'prev':
      return { kind: row.kind };
    case 'seek':
      return finite(args.sec) && args.sec >= 0 ? { kind: 'seek', sec: args.sec } : null;
    case 'volume':
      return finite(args.v) && args.v >= 0 && args.v <= 1 ? { kind: 'volume', v: args.v } : null;
    case 'shuffle':
      return typeof args.on === 'boolean' ? { kind: 'shuffle', on: args.on } : null;
    case 'repeat':
      return args.mode === 'off' || args.mode === 'all' || args.mode === 'one'
        ? { kind: 'repeat', mode: args.mode as RepeatMode }
        : null;
    case 'play_song':
      return isRecord(args.song)
        ? { kind: 'play_song', song: args.song as unknown as SongSnapshot, ...(Array.isArray(args.queue) ? { queue: args.queue as SongSnapshot[] } : {}) }
        : null;
    case 'queue_add':
      return isRecord(args.song)
        ? { kind: 'queue_add', song: args.song as unknown as SongSnapshot }
        : null;
    case 'take_over':
      return isRecord(args.state)
        ? { kind: 'take_over', state: args.state as unknown as ConnectPlayerState }
        : null;
  }
}

export class ConvexConnectTransport implements ConnectTransport {
  constructor(private readonly client: ConvexReactClient) {}

  register(device: DeviceRegistration): Promise<MutationResult> {
    return this.client.mutation(registerRef, device);
  }

  heartbeat(deviceId: string): Promise<MutationResult> {
    return this.client.mutation(heartbeatRef, { deviceId });
  }

  watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void {
    let devices: DeviceRow[] = [];
    let state: ConnectPlayerState | null = null;
    let commands: CommandRow[] = [];
    const publish = (): void => {
      const connectDevices: ConnectDevice[] = devices.map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        kind: device.kind,
        appVersion: device.appVersion,
        canPlay: device.canPlay,
        isOnline: device.isOnline,
        lastSeenAt: device.isOnline ? Date.now() : 0,
      }));
      const connectCommands: ConnectCommand[] = commands.flatMap((row) => {
        const command = commandFor(row);
        return command ? [{
          id: row.commandId,
          userDeviceId: row.sourceDeviceId,
          targetDeviceId: row.targetDeviceId,
          command,
          createdAt: row.createdAt,
          status: row.status,
          ...(row.error ? { error: row.error } : {}),
        }] : [];
      });
      listener({ serverNow: Date.now(), devices: connectDevices, ...(state ? { state } : {}), commands: connectCommands });
    };

    const devicesWatch = this.client.watchQuery(devicesRef, {});
    const stateWatch = this.client.watchQuery(stateRef, {});
    const commandsWatch = this.client.watchQuery(commandsRef, { deviceId });
    const stopDevices = devicesWatch.onUpdate(() => {
      try { devices = devicesWatch.localQueryResult() ?? []; publish(); } catch { /* Convex retries failed signed-in queries. */ }
    });
    const stopState = stateWatch.onUpdate(() => {
      try { state = stateWatch.localQueryResult() ?? null; publish(); } catch { /* Convex retries failed signed-in queries. */ }
    });
    const stopCommands = commandsWatch.onUpdate(() => {
      try { commands = commandsWatch.localQueryResult() ?? []; publish(); } catch { /* Convex retries failed signed-in queries. */ }
    });
    return () => {
      stopDevices();
      stopState();
      stopCommands();
    };
  }

  report(deviceId: string, patch: PlayerStatePatch, rev: number): Promise<MutationResult> {
    return this.client.mutation(reportRef, { deviceId, patch, rev });
  }

  claim(deviceId: string, snapshot: PlayerSnapshot): Promise<MutationResult> {
    return this.client.mutation(claimRef, { deviceId, snapshot });
  }

  async send(fromDeviceId: string, targetDeviceId: string, command: RemoteCommand): Promise<{ commandId: string; serverNow: number }> {
    if (command.kind === 'take_over') throw new Error('Use transfer to move playback between devices.');
    const { kind, ...args } = command;
    return this.client.mutation(sendRef, {
      fromDeviceId,
      targetDeviceId,
      kind,
      ...(Object.keys(args).length ? { args } : {}),
    });
  }

  ack(deviceId: string, commandId: string, result: { readonly ok: boolean; readonly error?: string }): Promise<MutationResult> {
    return this.client.mutation(ackRef, { deviceId, commandId, ...result });
  }

  transfer(fromDeviceId: string, toDeviceId: string): Promise<{ commandId: string; serverNow: number }> {
    return this.client.mutation(transferRef, { fromDeviceId, toDeviceId });
  }
}

export { commandFor };
