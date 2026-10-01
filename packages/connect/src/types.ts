import type { SongSnapshot } from '../../shared/songRef.ts';

/** Wire protocol this build speaks. A device that registers without one is legacy (1). */
export const CONNECT_PROTOCOL_VERSION = 2;

export type DeviceKind = 'web' | 'android' | 'ios';
export type RepeatMode = 'off' | 'all' | 'one';

/** Stable reasons a command ended `failed`, recorded by the server as `errorCode`. */
export type ConnectFailureCode =
  | 'needs_gesture' | 'not_found' | 'expired' | 'superseded'
  | 'cannot_play' | 'owner_unreachable' | 'command_failed';

/** Codes carried on thrown transport errors as `error.data.code`. */
export type ConnectErrorCode =
  | 'unauthenticated' | 'device_not_registered' | 'device_owned_by_another_account'
  | 'invalid_command' | 'rate_limited' | 'player_state_missing' | 'device_not_active'
  | 'stale_revision' | 'stale_ownership' | 'command_not_found' | 'command_not_target'
  | 'command_expired' | 'request_conflict' | 'update_required' | 'target_cannot_play'
  | 'target_not_active' | 'reservation_mismatch' | 'handoff_missing' | 'offline';

export interface ConnectDevice {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly appVersion: string;
  readonly canPlay: boolean;
  readonly isOnline: boolean;
  readonly protocolVersion: number;
}

export interface DeviceRegistration {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly appVersion: string;
  readonly canPlay: boolean;
  /** The session sends CONNECT_PROTOCOL_VERSION. */
  readonly protocolVersion?: number;
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
  /** Incremented by the server on every change of the active device. */
  readonly ownershipEpoch: number;
  /** Present while a transfer waits for the active device to confirm its pause. */
  readonly handoff?: { readonly commandId: string; readonly toDeviceId: string };
}

/** A partial state write: an omitted field is unchanged, `song: null` clears the track. */
export interface PlayerStatePatch {
  readonly song?: SongSnapshot | null;
  readonly queue?: readonly SongSnapshot[];
  readonly isPlaying?: boolean;
  readonly positionSec?: number;
  readonly volume?: number;
  readonly shuffle?: boolean;
  readonly repeat?: RepeatMode;
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

/** A pending command addressed to this device. Legacy commands carry no deadline or epoch. */
export interface InboxCommand {
  readonly id: string;
  readonly sourceDeviceId: string;
  readonly command: RemoteCommand;
  readonly createdAt: number;
  readonly requestId?: string;
  /** Server milliseconds after which the command must not start. */
  readonly executeBefore?: number;
  readonly expectedOwnershipEpoch?: number;
  readonly reservationToken?: string;
  /** Written by the old owner once its pause is confirmed; a `take_over` may then start. */
  readonly release?: { readonly positionSec: number; readonly resume: boolean };
}

/** The result of a command this device sent. It never repeats the command's arguments. */
export interface CommandOutcome {
  readonly id: string;
  readonly requestId?: string;
  readonly targetDeviceId: string;
  readonly kind: RemoteCommand['kind'];
  readonly createdAt: number;
  readonly status: 'pending' | 'done' | 'failed';
  readonly errorCode?: ConnectFailureCode;
  readonly error?: string;
}

/** No server time here: only mutations yield clock samples. */
export interface ConnectSnapshot {
  readonly devices: readonly ConnectDevice[];
  readonly state?: ConnectPlayerState;
  readonly inbox: readonly InboxCommand[];
  readonly outcomes: readonly CommandOutcome[];
}

export interface SendReceipt {
  readonly commandId: string;
  readonly serverNow: number;
  readonly executeBefore: number;
  readonly ownershipEpoch: number;
}

export type CommandOutcomeInput =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ConnectFailureCode; readonly error?: string };

export type PrepareResult =
  | {
      readonly status: 'activated';
      readonly serverNow: number;
      readonly rev: number;
      readonly ownershipEpoch: number;
      readonly positionSec: number;
      readonly resume: boolean;
    }
  | { readonly status: 'awaiting_release'; readonly serverNow: number };

export type CompleteResult =
  | { readonly status: 'completed'; readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }
  | { readonly status: 'conflict'; readonly serverNow: number; readonly currentRev: number };

/**
 * The backend seam. Every mutation throws on failure: the thrown value is an `Error` with
 * `data: { code: ConnectErrorCode, message, ...details }`. A failure without a code (or with
 * `offline`) means the outcome is unknown and the caller may retry the same request.
 */
export interface ConnectTransport {
  register(device: DeviceRegistration): Promise<{ readonly serverNow: number }>;
  heartbeat(deviceId: string): Promise<{ readonly serverNow: number }>;
  /** The listener is first called once all three queries have delivered a server result. */
  watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void;
  report(
    deviceId: string,
    patch: PlayerStatePatch,
    expected: { readonly rev: number; readonly ownershipEpoch: number }
  ): Promise<{ readonly serverNow: number; readonly rev: number }>;
  claim(
    deviceId: string,
    snapshot: PlayerSnapshot,
    expectedOwnershipEpoch?: number
  ): Promise<{ readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }>;
  send(input: {
    readonly fromDeviceId: string;
    readonly targetDeviceId: string;
    readonly requestId: string;
    readonly expectedOwnershipEpoch: number;
    readonly command: RemoteCommand;
  }): Promise<SendReceipt>;
  transfer(input: {
    readonly fromDeviceId: string;
    readonly toDeviceId: string;
    readonly requestId: string;
    readonly expectedOwnershipEpoch: number;
  }): Promise<SendReceipt>;
  begin(
    deviceId: string,
    commandId: string
  ): Promise<{ readonly reservationToken: string; readonly serverNow: number; readonly executeBefore: number }>;
  prepare(deviceId: string, commandId: string, reservationToken: string): Promise<PrepareResult>;
  release(input: {
    readonly deviceId: string;
    readonly commandId: string;
    readonly expectedOwnershipEpoch: number;
    readonly positionSec: number;
    readonly resume: boolean;
  }): Promise<{ readonly serverNow: number; readonly rev: number; readonly ownershipEpoch: number }>;
  complete(input: {
    readonly deviceId: string;
    readonly commandId: string;
    readonly reservationToken: string;
    readonly outcome: CommandOutcomeInput;
    readonly patch?: PlayerStatePatch;
    readonly rev?: number;
  }): Promise<CompleteResult>;
}

/**
 * The platform audio player. The session calls these one at a time, never overlapping.
 */
export interface PlayerPort {
  getSnapshot(): PlayerSnapshot;
  onChange(listener: (snapshot: PlayerSnapshot) => void): () => void;
  play(): Promise<'ok' | 'needs_gesture'>;
  /** Resolves once the platform player has confirmed it is paused, or after a bounded wait. */
  pause(): Promise<void>;
  seek(sec: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  /**
   * Resolves when the selected song is ready at the requested position. The rest of the queue
   * may still be resolving, and `getSnapshot().queue` must already return the full intended
   * queue in order.
   */
  load(song: SongSnapshot, queue: readonly SongSnapshot[], options: { readonly positionSec: number; readonly play: boolean }): Promise<'ok' | 'not_found' | 'needs_gesture'>;
  next?(): Promise<void>;
  previous?(): Promise<void>;
  setShuffle?(on: boolean): Promise<void>;
  setRepeat?(mode: RepeatMode): Promise<void>;
  addToQueue?(song: SongSnapshot): Promise<void>;
  /** Cancels adapter-owned async work when this account/session is disposed. */
  dispose?(): void;
}

export interface Clock {
  now(): number;
  /** Monotonic time for local measurements. Never used for shared server timestamps. */
  monotonicNow?(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export type ConnectTraceEventName =
  | 'input.started'
  | 'input.confirmed'
  | 'input.failed'
  | 'input.timed_out'
  | 'receiver.delivered'
  | 'receiver.completed'
  | 'receiver.failed'
  | 'mutation.started'
  | 'mutation.completed'
  | 'mutation.failed'
  | 'mutation.conflict'
  | 'query.delivered'
  | 'catalog.requested'
  | 'catalog.completed'
  | 'renderer.tick'
  | 'adapter.ready'
  | 'timer.scheduled'
  | 'timer.fired'
  | 'timer.cleared';

export type ConnectTraceOperation =
  | 'control'
  | 'transfer'
  | 'receiver'
  | 'register'
  | 'heartbeat'
  | 'send'
  | 'report'
  | 'claim'
  | 'begin'
  | 'prepare'
  | 'release'
  | 'complete'
  | 'watch'
  | 'devices_query'
  | 'state_query'
  | 'inbox_query'
  | 'outcomes_query'
  | 'player'
  | 'catalog'
  | 'renderer_timer'
  | 'command_timeout'
  | 'listen_retry'
  | 'send_retry'
  | 'inbox_retry'
  | 'write_retry'
  | 'claim_retry'
  | 'release_retry'
  | 'handoff_deadline';

export type ConnectTraceOutcome =
  | 'ok'
  | 'failed'
  | 'needs_gesture'
  | 'not_found'
  | 'cannot_play'
  | 'owner_unreachable'
  | 'command_failed'
  | 'offline'
  | 'timeout'
  | 'conflict'
  | 'rejected'
  | 'expired'
  | 'superseded'
  | 'disposed';

/** Whitelisted, payload-free event stored only in the local development buffer. */
export interface ConnectTraceEntry {
  readonly atMs: number;
  readonly event: ConnectTraceEventName;
  readonly operation: ConnectTraceOperation;
  readonly requestId?: string;
  readonly commandId?: string;
  readonly kind?: RemoteCommand['kind'];
  readonly outcome?: ConnectTraceOutcome;
  readonly durationMs?: number;
  readonly payloadBytes?: number;
  readonly count?: number;
  readonly concurrency?: number;
  readonly maxConcurrency?: number;
  readonly queueLength?: number;
  readonly delayMs?: number;
}

export type ConnectTraceEvent = Omit<ConnectTraceEntry, 'atMs'>;

export interface ConnectTraceWriter {
  record(event: ConnectTraceEvent): void;
}

export interface DevelopmentTraceOptions {
  /** Must come from an explicit development-only binding such as `__DEV__`. */
  readonly development: boolean;
  /** A separate explicit user/developer opt-in. */
  readonly enabled: boolean;
  /** Monotonic clock such as `performance.now`; wall-clock fallback is forbidden. */
  readonly monotonicNow?: () => number;
  readonly maxEntries?: number;
}

export interface DevelopmentTraceBuffer extends ConnectTraceWriter {
  snapshot(): readonly ConnectTraceEntry[];
  clear(): void;
  dispose(): void;
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
  /** False when the active device is another device that Presence reports offline. */
  readonly activeDeviceOnline: boolean;
  readonly ownershipEpoch: number;
  readonly song?: SongSnapshot;
  readonly queue: readonly SongSnapshot[];
  readonly isPlaying: boolean;
  /** The position when this view was built. Tick from `session.livePosition()` instead. */
  readonly livePosition: number;
  readonly volume: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
  /** The command currently transmitted and waiting for its outcome. */
  readonly pendingCommand?: PendingCommandView;
  /** Inputs held behind `pendingCommand`, not yet transmitted. */
  readonly queuedCommands: number;
  readonly autoplayBlocked: boolean;
  /** User-facing copy. Branch on `lastErrorCode`, never on this text. */
  readonly lastError?: string;
  readonly lastErrorCode?: ConnectErrorCode | ConnectFailureCode;
}

export type TransferResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'not_found' | 'timeout' | 'offline' | 'failed';
      /** User-facing copy. */
      readonly error?: string;
      readonly code?: ConnectErrorCode | ConnectFailureCode;
    };

export interface ConnectSession {
  view(): ConnectView;
  subscribe(listener: (view: ConnectView) => void): () => void;
  /** The displayed position in seconds right now. Cheap and allocation-free, for render ticks. */
  livePosition(): number;
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
  /** Pass only a buffer returned by createDevelopmentTrace in an opted-in dev build. */
  readonly trace?: ConnectTraceWriter;
}
