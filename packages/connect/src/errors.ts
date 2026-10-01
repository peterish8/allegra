import type { ConnectErrorCode, ConnectFailureCode } from './types.ts';

const ERROR_MESSAGES: Record<ConnectErrorCode, string> = {
  unauthenticated: 'Sign in to use Connect.',
  device_not_registered: 'Register this device before using Connect.',
  device_owned_by_another_account: 'This device ID belongs to another account.',
  invalid_command: 'The command arguments do not match the command type.',
  rate_limited: 'Too many Connect commands. Try again shortly.',
  player_state_missing: 'There is no player state to transfer.',
  device_not_active: 'Only the active device can report playback state.',
  stale_revision: 'This playback state is out of date. Read the latest state and retry.',
  stale_ownership: 'Playback moved to another device.',
  command_not_found: 'The command no longer exists.',
  command_not_target: 'Only the target device can run this command.',
  command_expired: 'The command arrived too late to run.',
  request_conflict: 'This request ID was already used for a different command.',
  update_required: 'That device needs a newer version of the app.',
  target_cannot_play: 'That device cannot play right now.',
  target_not_active: 'That device is no longer the active player.',
  reservation_mismatch: 'Another run of this command holds its reservation.',
  handoff_missing: 'There is no transfer waiting for this device.',
  offline: 'Connect is offline.'
};

const FAILURE_CODES: readonly ConnectFailureCode[] = [
  'needs_gesture', 'not_found', 'expired', 'superseded', 'cannot_play', 'owner_unreachable', 'command_failed'
];

export interface ConnectErrorData {
  readonly code: ConnectErrorCode;
  readonly message: string;
  readonly [detail: string]: unknown;
}

/** Builds the error every transport throws: an `Error` carrying the `ConvexError` data shape. */
export function connectError(
  code: ConnectErrorCode,
  details?: Readonly<Record<string, unknown>>
): Error & { readonly data: ConnectErrorData } {
  const data: ConnectErrorData = { message: ERROR_MESSAGES[code], ...details, code };
  return Object.assign(new Error(data.message), { data });
}

/** The `data` object of a thrown transport error, when it has one. */
export function errorData(error: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!error || typeof error !== 'object' || !('data' in error)) return undefined;
  const data = (error as { readonly data: unknown }).data;
  return data && typeof data === 'object' ? data as Readonly<Record<string, unknown>> : undefined;
}

/** The coded reason a transport call failed, or undefined when the failure carries none. */
export function errorCode(error: unknown): ConnectErrorCode | undefined {
  const code = errorData(error)?.code;
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
    ? code as ConnectErrorCode
    : undefined;
}

/**
 * True when the server never said no: the request may or may not have been applied, so the
 * caller retries the same request rather than treating it as rejected.
 */
export function isUncertainFailure(error: unknown): boolean {
  const code = errorData(error)?.code;
  return typeof code !== 'string' || code === 'offline';
}

export function isFailureCode(value: unknown): value is ConnectFailureCode {
  return typeof value === 'string' && (FAILURE_CODES as readonly string[]).includes(value);
}
