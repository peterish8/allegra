/**
 * Blend and Import calls to Allegra's API (docs/api-contract.md, "Blend — additive" and "Import").
 * Every call has a timeout and resolves to a result, never a throw. A refusal carries the API's
 * `code` ('full', 'limit', 'expired', 'notfound', 'consent', 'invalid') and its user-facing copy.
 */
import type { BlendCreated, BlendDetail, BlendInviteLink, BlendInvitePreview, BlendSummary } from '@shared/blendView';
import type { BlendTrack } from '@shared/blendTypes';
import type { ImportedTrack } from '@shared/importParse';
import type { MatchReply } from '@shared/importRun';
import { POLICY_VERSION } from '@shared/legal';

import type { UnifiedSong } from '../../types/song';
import { ALLEGRA_API_URL } from '../account/config';

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly code?: string; readonly error: string; readonly retryAfterSeconds?: number };

const TIMEOUT_MS = 15_000;
const OFFLINE = "We couldn't reach Allegra. Check your connection and try again.";

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, token: string | null, body?: unknown, options: { signal?: AbortSignal; operationId?: string } = {}): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ALLEGRA_API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(options.operationId ? { 'Idempotency-Key': options.operationId } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const retryHeader = res.headers.get('retry-after');
    const retry = retryHeader === null ? NaN : /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) : Math.max(0, (Date.parse(retryHeader) - Date.now()) / 1000);
    if (res.status === 204) return { ok: true, data: undefined as T };
    const json = (await res.json().catch(() => null)) as { success?: unknown; data?: unknown; error?: unknown; code?: unknown } | null;
    if (res.ok && json?.success === true) return { ok: true, data: json.data as T };
    return {
      ok: false,
      status: res.status,
      ...(typeof json?.code === 'string' ? { code: json.code } : {}),
      error: typeof json?.error === 'string' ? json.error : OFFLINE,
      ...(Number.isFinite(retry) && retry >= 0 ? { retryAfterSeconds: retry } : {}),
    };
  } catch {
    return { ok: false, status: 0, error: OFFLINE };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

const CONSENT = { policyVersion: POLICY_VERSION } as const;

export const createBlend = (token: string, name?: string, operationId?: string) => call<BlendCreated>('POST', '/api/blends', token, { ...(name ? { name } : {}), consent: CONSENT }, operationId ? { operationId } : {});
export const listBlends = (token: string, signal?: AbortSignal) => call<BlendSummary[]>('GET', '/api/blends', token, undefined, signal ? { signal } : {});
export const getBlend = (token: string, id: string, signal?: AbortSignal) => call<BlendDetail>('GET', `/api/blends/${encodeURIComponent(id)}`, token, undefined, signal ? { signal } : {});
export const getInvite = (token: string, id: string, regenerate = false) => call<BlendInviteLink>('POST', `/api/blends/${encodeURIComponent(id)}/invite`, token, { regenerate });
export const previewInvite = (code: string) => call<BlendInvitePreview>('GET', `/api/blend-invites/${encodeURIComponent(code)}`, null);
export const acceptInvite = (token: string, code: string) => call<BlendSummary>('POST', `/api/blend-invites/${encodeURIComponent(code)}/accept`, token, { consent: CONSENT });
export const leaveBlend = (token: string, id: string) => call<{ left: true }>('POST', `/api/blends/${encodeURIComponent(id)}/leave`, token);
export const renameBlend = (token: string, id: string, name: string) => call<BlendSummary>('PATCH', `/api/blends/${encodeURIComponent(id)}`, token, { name });

/** Import matching; a failure is thrown in the shape the shared runner reads (status, Retry-After). */
export async function matchImportTracks(token: string, tracks: readonly ImportedTrack[]): Promise<MatchReply[]> {
  const result = await call<{ results: MatchReply[] }>('POST', '/api/import/match', token, { tracks });
  if (result.ok === true) return result.data.results;
  throw Object.assign(new Error(result.error), { status: result.status, retryAfterSeconds: result.retryAfterSeconds });
}

export const sendImportSeed = (token: string, artists: readonly { name: string; count: number }[]) =>
  call<unknown>('POST', '/api/me/taste/import-seed', token, { artists });

/** A Blend track as a phone song: every Blend track is a Saavn ref (D15), streamed through the API. */
export function blendTrackSong(track: BlendTrack): UnifiedSong {
  const id = track.song.ref.startsWith('saavn:') ? track.song.ref.slice('saavn:'.length) : track.song.ref;
  const streamUrl = `${ALLEGRA_API_URL}/api/stream/${encodeURIComponent(id)}`;
  return {
    id,
    title: track.song.title,
    artist: track.song.artist,
    highResArt: track.song.artwork,
    downloadUrl: streamUrl,
    streamUrl,
    source: 'Saavn',
    duration: track.song.duration,
  };
}

/** The shareable join link: the API's, or the production site's when the API gave a bare path. */
export function inviteUrl(invite: BlendInviteLink): string {
  return /^https?:\/\//.test(invite.url) ? invite.url : `${ALLEGRA_API_URL}/blend/join/${invite.code}`;
}
