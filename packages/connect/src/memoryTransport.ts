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
  RemoteCommand
} from './types.ts';

const EMPTY_PLAYER: PlayerSnapshot = {
  queue: [],
  isPlaying: false,
  positionSec: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off'
};

/** In-process implementation of the Connect transport seam, shared by test sessions. */
export class MemoryTransport implements ConnectTransport {
  private readonly devices = new Map<string, ConnectDevice>();
  private readonly listeners = new Map<string, Set<(snapshot: ConnectSnapshot) => void>>();
  private readonly commands = new Map<string, ConnectCommand>();
  private state: ConnectPlayerState | undefined;
  private commandSequence = 0;
  online = true;

  constructor(private readonly now: () => number = Date.now) {}

  seedState(state: Partial<ConnectPlayerState> & PlayerSnapshot): void {
    this.state = { ...state, queue: [...state.queue], positionAt: state.positionAt ?? this.now(), rev: state.rev ?? 1 };
    this.publish();
  }

  async register(device: DeviceRegistration): Promise<MutationResult> {
    this.assertOnline();
    const serverNow = this.now();
    this.devices.set(device.deviceId, { ...device, isOnline: true, lastSeenAt: serverNow });
    if (!this.state) this.state = { ...EMPTY_PLAYER, positionAt: serverNow, rev: 0 };
    this.publish();
    return { serverNow, rev: this.state.rev };
  }

  async heartbeat(deviceId: string): Promise<MutationResult> {
    this.assertOnline();
    const serverNow = this.now();
    const device = this.devices.get(deviceId);
    if (device) this.devices.set(deviceId, { ...device, isOnline: true, lastSeenAt: serverNow });
    this.publish();
    return { serverNow, rev: this.state?.rev ?? 0 };
  }

  watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void {
    let group = this.listeners.get(deviceId);
    if (!group) {
      group = new Set();
      this.listeners.set(deviceId, group);
    }
    group.add(listener);
    listener(this.snapshot(deviceId));
    return () => {
      group?.delete(listener);
      if (group?.size === 0) this.listeners.delete(deviceId);
    };
  }

  async report(deviceId: string, patch: PlayerStatePatch, rev: number): Promise<MutationResult> {
    this.assertOnline();
    const serverNow = this.now();
    if (!this.state || this.state.activeDeviceId !== deviceId || this.state.rev !== rev) {
      return { serverNow, rev: this.state?.rev ?? 0, accepted: false };
    }
    this.state = { ...patch, activeDeviceId: deviceId, positionAt: serverNow, rev: rev + 1 };
    this.publish();
    return { serverNow, rev: this.state.rev, accepted: true };
  }

  async claim(deviceId: string, snapshot: PlayerSnapshot): Promise<MutationResult> {
    this.assertOnline();
    const serverNow = this.now();
    const rev = (this.state?.rev ?? 0) + 1;
    this.state = { ...snapshot, activeDeviceId: deviceId, positionAt: serverNow, rev };
    this.publish();
    return { serverNow, rev, accepted: true };
  }

  async send(fromDeviceId: string, targetDeviceId: string, command: RemoteCommand): Promise<{ commandId: string; serverNow: number }> {
    this.assertOnline();
    const serverNow = this.now();
    const commandId = `memory-command-${++this.commandSequence}`;
    this.commands.set(commandId, {
      id: commandId,
      userDeviceId: fromDeviceId,
      targetDeviceId,
      command,
      createdAt: serverNow,
      status: 'pending'
    });
    this.publish();
    return { commandId, serverNow };
  }

  async ack(deviceId: string, commandId: string, result: { readonly ok: boolean; readonly error?: string }): Promise<MutationResult> {
    this.assertOnline();
    const serverNow = this.now();
    const command = this.commands.get(commandId);
    if (!command || command.targetDeviceId !== deviceId || command.status !== 'pending') {
      return { serverNow, rev: this.state?.rev ?? 0, accepted: false };
    }
    const updated: ConnectCommand = result.ok
      ? { ...command, status: 'done' }
      : { ...command, status: 'failed', ...(result.error ? { error: result.error } : {}) };
    this.commands.set(commandId, updated);
    this.publish();
    return { serverNow, rev: this.state?.rev ?? 0, accepted: true };
  }

  async transfer(fromDeviceId: string, toDeviceId: string): Promise<{ commandId: string; serverNow: number }> {
    this.assertOnline();
    const serverNow = this.now();
    if (!this.state) throw new Error('no_player_state');
    const commandId = `memory-command-${++this.commandSequence}`;
    const takeover: ConnectPlayerState = { ...this.state, queue: [...this.state.queue] };
    this.commands.set(commandId, {
      id: commandId,
      userDeviceId: fromDeviceId,
      targetDeviceId: toDeviceId,
      command: { kind: 'take_over', state: takeover },
      createdAt: serverNow,
      status: 'pending'
    });
    this.publish();
    return { commandId, serverNow };
  }

  private assertOnline(): void {
    if (!this.online) throw new Error('offline');
  }

  private snapshot(deviceId: string): ConnectSnapshot {
    return {
      serverNow: this.now(),
      devices: [...this.devices.values()],
      ...(this.state ? { state: this.state } : {}),
      commands: [...this.commands.values()].filter((command) => command.targetDeviceId === deviceId || command.userDeviceId === deviceId)
    };
  }

  private publish(): void {
    for (const [deviceId, listeners] of this.listeners) {
      const value = this.snapshot(deviceId);
      for (const listener of [...listeners]) listener(value);
    }
  }
}
