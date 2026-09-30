import type { SongSnapshot } from '../../shared/songRef.ts';

export type DeviceKind = 'web' | 'android' | 'ios';
export type RepeatMode = 'off' | 'all' | 'one';

export interface ConnectDevice {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly appVersion: string;
  readonly canPlay: boolean;
  readonly isOnline: boolean;
  readonly lastSeenAt: number;
}

export interface DeviceRegistration {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly appVersion: string;
  readonly canPlay: boolean;
}

export interface PlayerSnapshot {
  readonly song?: SongSnapshot;
  /** Songs queued after `song`, in playback order. */
  readonly queue: readonly SongSnapshot[];
  readonly isPlaying: boolean;
  readonly positionSec: number;
  readonly volume: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
}

export interface ConnectPlayerState extends PlayerSnapshot {
  readonly activeDeviceId?: string;
  /** Position anchor in server milliseconds. */
  readonly positionAt: number;
  readonly rev: number;
}

export type RemoteCommand =
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'seek'; readonly sec: number }
  | { readonly kind: 'next' }
  | { readonly kind: 'prev' }
  | { readonly kind: 'volume'; readonly v: number }
  | { readonly kind: 'shuffle'; readonly on: boolean }
  | { readonly kind: 'repeat'; readonly mode: RepeatMode }
  | { readonly kind: 'play_song'; readonly song: SongSnapshot; readonly queue?: readonly SongSnapshot[] }
  | { readonly kind: 'queue_add'; readonly song: SongSnapshot }
  | { readonly kind: 'take_over'; readonly state: ConnectPlayerState };

export interface ConnectCommand {
  readonly id: string;
  readonly userDeviceId: string;
  readonly targetDeviceId: string;
  readonly command: RemoteCommand;
  readonly createdAt: number;
  readonly status: 'pending' | 'done' | 'failed';
  readonly error?: string;
}

export interface ConnectSnapshot {
  readonly serverNow: number;
  readonly devices: readonly ConnectDevice[];
  readonly state?: ConnectPlayerState;
  /** Commands addressed to this device or issued by it, for delivery and ack display. */
  readonly commands: readonly ConnectCommand[];
}

export interface MutationResult {
  readonly serverNow: number;
  readonly rev: number;
  readonly accepted?: boolean;
}

export type PlayerStatePatch = PlayerSnapshot;

export interface ConnectTransport {
  register(device: DeviceRegistration): Promise<MutationResult>;
  heartbeat(deviceId: string): Promise<MutationResult>;
  watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void;
  report(deviceId: string, patch: PlayerStatePatch, rev: number): Promise<MutationResult>;
  claim(deviceId: string, snapshot: PlayerSnapshot): Promise<MutationResult>;
  send(fromDeviceId: string, targetDeviceId: string, command: RemoteCommand): Promise<{ readonly commandId: string; readonly serverNow: number }>;
  ack(deviceId: string, commandId: string, result: { readonly ok: boolean; readonly error?: string }): Promise<MutationResult>;
  transfer(fromDeviceId: string, toDeviceId: string): Promise<{ readonly commandId: string; readonly serverNow: number }>;
}

export interface PlayerPort {
  getSnapshot(): PlayerSnapshot;
  onChange(listener: (snapshot: PlayerSnapshot) => void): () => void;
  play(): Promise<'ok' | 'needs_gesture'>;
  pause(): Promise<void>;
  seek(sec: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  load(song: SongSnapshot, queue: readonly SongSnapshot[], options: { readonly positionSec: number; readonly play: boolean }): Promise<'ok' | 'not_found' | 'needs_gesture'>;
  next?(): Promise<void>;
  previous?(): Promise<void>;
  setShuffle?(on: boolean): Promise<void>;
  setRepeat?(mode: RepeatMode): Promise<void>;
  addToQueue?(song: SongSnapshot): Promise<void>;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SessionDevice extends DeviceRegistration {}

export interface PendingCommandView {
  readonly commandId?: string;
  readonly targetDeviceId: string;
  readonly command: RemoteCommand;
  readonly startedAt: number;
}

export interface ConnectView {
  readonly devices: readonly ConnectDevice[];
  readonly activeDevice?: ConnectDevice;
  readonly activeDeviceId?: string;
  readonly isThisDeviceActive: boolean;
  readonly song?: SongSnapshot;
  readonly queue: readonly SongSnapshot[];
  readonly isPlaying: boolean;
  readonly livePosition: number;
  readonly volume: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
  readonly pendingCommand?: PendingCommandView;
  readonly autoplayBlocked: boolean;
  readonly lastError?: string;
}

export type TransferResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' | 'timeout' | 'offline' | 'failed'; readonly error?: string };

export interface ConnectSession {
  view(): ConnectView;
  subscribe(listener: (view: ConnectView) => void): () => void;
  control(command: RemoteCommand): void;
  transferTo(deviceId: string): Promise<TransferResult>;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface ConnectSessionOptions {
  readonly transport: ConnectTransport;
  readonly player: PlayerPort;
  readonly device: SessionDevice;
  readonly clock: Clock;
}
