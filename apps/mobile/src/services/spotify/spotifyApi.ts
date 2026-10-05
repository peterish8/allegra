import type { SpotifySourcePlaylist, SpotifyStatus, SpotifySyncStep } from '@shared/spotify';
import { ALLEGRA_API_URL } from '../account/config';

interface Envelope<T> { readonly success?: boolean; readonly data?: T; readonly error?: string }

export class SpotifyApiError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterSeconds?: number) {
    super(message); this.name = 'SpotifyApiError';
  }
}

async function request<T>(token: string, path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${ALLEGRA_API_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal
    });
    const rawRetry = response.headers.get('Retry-After');
    const retry = rawRetry === null ? NaN : Number(rawRetry);
    if (!response.ok) throw new SpotifyApiError(`Spotify request failed (${response.status}).`, response.status, Number.isFinite(retry) && retry >= 0 ? retry : undefined);
    let envelope: Envelope<T>;
    try { envelope = await response.json() as Envelope<T>; }
    catch { throw new SpotifyApiError('Spotify returned an unreadable response.', response.status); }
    if (envelope.success !== true || envelope.data === undefined) throw new SpotifyApiError(envelope.error ?? 'Spotify returned an invalid response.', response.status);
    return envelope.data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function readStatus(value: unknown): SpotifyStatus {
  if (!isRecord(value) || typeof value.configured !== 'boolean' || typeof value.connected !== 'boolean' || typeof value.dailyEnabled !== 'boolean' || !Array.isArray(value.playlists)) throw new SpotifyApiError('Spotify status has an invalid shape.');
  return value as unknown as SpotifyStatus;
}
function readPlaylists(value: unknown): { readonly playlists: readonly SpotifySourcePlaylist[] } {
  if (!isRecord(value) || !Array.isArray(value.playlists) || !value.playlists.every((row) => isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.snapshotId === 'string' && Number.isInteger(row.total))) throw new SpotifyApiError('Spotify playlists have an invalid shape.');
  return value as unknown as { readonly playlists: readonly SpotifySourcePlaylist[] };
}
function readSyncStep(value: unknown): SpotifySyncStep {
  if (!isRecord(value) || typeof value.complete !== 'boolean' || !Number.isInteger(value.added) || !Number.isInteger(value.skipped) || !Number.isInteger(value.reviewNeeded) || typeof value.libraryId !== 'string') throw new SpotifyApiError('Spotify sync returned an invalid progress response.');
  return value as unknown as SpotifySyncStep;
}

export async function fetchSpotifyStatus(token: string, signal?: AbortSignal): Promise<SpotifyStatus> {
  return readStatus(await request<unknown>(token, '/api/spotify/status', 'GET', undefined, signal));
}
export async function connectSpotify(token: string): Promise<{ readonly url: string }> {
  const data = await request<unknown>(token, '/api/spotify/connect', 'POST', { returnTo: 'mobile' });
  if (!isRecord(data) || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) throw new SpotifyApiError('Spotify connect returned an invalid URL.');
  return { url: data.url };
}
export async function fetchSpotifyPlaylists(token: string, signal?: AbortSignal): Promise<{ readonly playlists: readonly SpotifySourcePlaylist[] }> {
  return readPlaylists(await request<unknown>(token, '/api/spotify/playlists', 'GET', undefined, signal));
}
export async function syncSpotifyPlaylist(token: string, playlistId: string, signal?: AbortSignal): Promise<SpotifySyncStep> {
  return readSyncStep(await request<unknown>(token, '/api/spotify/sync', 'POST', { playlistId }, signal));
}
export async function setSpotifyDailySync(token: string, dailyEnabled: boolean): Promise<{ readonly dailyEnabled: boolean }> {
  const data = await request<unknown>(token, '/api/spotify/settings', 'PATCH', { dailyEnabled });
  if (!isRecord(data) || data.dailyEnabled !== dailyEnabled) throw new SpotifyApiError('Spotify setting was not confirmed.');
  return { dailyEnabled };
}
export async function disconnectSpotify(token: string): Promise<void> {
  const data = await request<unknown>(token, '/api/spotify/disconnect', 'POST');
  if (!isRecord(data) || data.disconnected !== true) throw new SpotifyApiError('Spotify disconnect was not confirmed.');
}
