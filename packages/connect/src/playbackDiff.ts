import type { SongSnapshot } from '../../shared/songRef.ts';
import type { ConnectPlayerState, PlayerSnapshot, PlayerStatePatch, RepeatMode } from './types.ts';

/** A position this far from where the server expects it is a seek, or drift worth correcting. */
export const POSITION_THRESHOLD_SEC = 1.5;

/** The playback state the server is known to hold for this account. */
export interface ConfirmedState {
  readonly songRef: string | undefined;
  /** Seconds; 0 when unknown. */
  readonly durationSec: number;
  readonly queue: readonly SongSnapshot[];
  readonly isPlaying: boolean;
  readonly positionSec: number;
  /** Server milliseconds at which `positionSec` was true. */
  readonly positionAt: number;
  readonly volume: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
}

export interface PatchPlan {
  /** The fields that differ from the server's copy, or undefined when nothing should be sent. */
  readonly patch: PlayerStatePatch | undefined;
  /** The local position is further than the threshold from the server's expectation. */
  readonly positionOff: boolean;
  /** The patch exists only to correct the position. */
  readonly positionOnly: boolean;
}

const NOTHING: PatchPlan = { patch: undefined, positionOff: false, positionOnly: false };

export function confirmedFromState(state: ConnectPlayerState): ConfirmedState {
  return {
    songRef: state.song?.ref,
    durationSec: state.song?.duration ?? 0,
    queue: state.queue,
    isPlaying: state.isPlaying,
    positionSec: state.positionSec,
    positionAt: state.positionAt,
    volume: state.volume,
    shuffle: state.shuffle,
    repeat: state.repeat
  };
}

/** The server's copy after it accepted a full snapshot (a claim) at `serverNow`. */
export function confirmedFromSnapshot(snapshot: PlayerSnapshot, serverNow: number): ConfirmedState {
  return {
    songRef: snapshot.song?.ref,
    durationSec: snapshot.song?.duration ?? 0,
    queue: snapshot.queue,
    isPlaying: snapshot.isPlaying,
    positionSec: snapshot.positionSec,
    positionAt: serverNow,
    volume: snapshot.volume,
    shuffle: snapshot.shuffle,
    repeat: snapshot.repeat
  };
}

/** Where the server believes playback is at `serverNow`. */
export function expectedPosition(confirmed: ConfirmedState, serverNow: number): number {
  const elapsed = confirmed.isPlaying ? Math.max(0, serverNow - confirmed.positionAt) / 1000 : 0;
  return clampPosition(confirmed.positionSec + elapsed, confirmed.durationSec);
}

export function clampPosition(positionSec: number, durationSec: number): number {
  const floor = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
  return durationSec > 0 ? Math.min(floor, durationSec) : floor;
}

/**
 * The server's copy after it accepted `patch` at `serverNow`, following its anchor rule: the
 * anchor moves only with a position, or is advanced in place when play state changes alone.
 */
export function applyConfirmedPatch(confirmed: ConfirmedState, patch: PlayerStatePatch, serverNow: number): ConfirmedState {
  let positionSec = confirmed.positionSec;
  let positionAt = confirmed.positionAt;
  if (patch.positionSec !== undefined) {
    positionSec = patch.positionSec;
    positionAt = serverNow;
  } else if (patch.isPlaying !== undefined && patch.isPlaying !== confirmed.isPlaying) {
    positionSec = expectedPosition(confirmed, serverNow);
    positionAt = serverNow;
  }
  const song = patch.song;
  return {
    songRef: song === undefined ? confirmed.songRef : song?.ref,
    durationSec: song === undefined ? confirmed.durationSec : song?.duration ?? 0,
    queue: patch.queue ?? confirmed.queue,
    isPlaying: patch.isPlaying ?? confirmed.isPlaying,
    positionSec,
    positionAt,
    volume: patch.volume ?? confirmed.volume,
    shuffle: patch.shuffle ?? confirmed.shuffle,
    repeat: patch.repeat ?? confirmed.repeat
  };
}

/**
 * Decides what the active device must tell the server. Only fields that differ are sent. Song
 * and queue are compared by ref, never serialized. Position and play state travel together.
 * A player with no song says nothing about song, queue or position, so an empty player (a
 * page that just reloaded) cannot erase what the server holds.
 *
 * `positionSec` is the local position right now. A position that is off is sent when it is a
 * seek, or when `allowDrift` says the drift budget permits another correction.
 */
export function planPatch(
  local: PlayerSnapshot,
  positionSec: number,
  confirmed: ConfirmedState,
  serverNow: number,
  options: { readonly seek: boolean; readonly allowDrift: boolean }
): PatchPlan {
  const song = local.song;
  const hasSong = song !== undefined;
  const songChanged = hasSong && song.ref !== confirmed.songRef;
  const queueChanged = hasSong && !sameRefs(local.queue, confirmed.queue);
  // An empty player may say it stopped, never that it is playing something it cannot name.
  const playChanged = local.isPlaying !== confirmed.isPlaying && (hasSong || !local.isPlaying);
  const duration = song?.duration ?? 0;
  const position = clampPosition(positionSec, duration);
  const positionOff = hasSong && !songChanged &&
    Math.abs(position - expectedPosition(confirmed, serverNow)) > POSITION_THRESHOLD_SEC;
  const correctsPosition = positionOff && (options.seek || options.allowDrift);
  const sendsPosition = hasSong && (songChanged || playChanged || correctsPosition);
  const volume = Number.isFinite(local.volume) ? Math.max(0, Math.min(1, local.volume)) : confirmed.volume;
  const volumeChanged = volume !== confirmed.volume;
  const shuffleChanged = local.shuffle !== confirmed.shuffle;
  const repeatChanged = local.repeat !== confirmed.repeat;

  if (!songChanged && !queueChanged && !playChanged && !sendsPosition && !volumeChanged && !shuffleChanged && !repeatChanged) {
    return positionOff ? { patch: undefined, positionOff: true, positionOnly: false } : NOTHING;
  }
  const patch: PlayerStatePatch = {
    ...(songChanged ? { song } : {}),
    ...(queueChanged ? { queue: local.queue } : {}),
    ...(sendsPosition || playChanged ? { isPlaying: local.isPlaying } : {}),
    ...(sendsPosition ? { positionSec: position } : {}),
    ...(volumeChanged ? { volume } : {}),
    ...(shuffleChanged ? { shuffle: local.shuffle } : {}),
    ...(repeatChanged ? { repeat: local.repeat } : {})
  };
  return {
    patch,
    positionOff,
    positionOnly: correctsPosition && !songChanged && !queueChanged && !playChanged && !volumeChanged && !shuffleChanged && !repeatChanged
  };
}

/** True when both lists name the same songs in the same order. Allocates nothing. */
export function sameRefs(left: readonly SongSnapshot[], right: readonly SongSnapshot[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index]?.ref !== right[index]?.ref) return false;
  }
  return true;
}
