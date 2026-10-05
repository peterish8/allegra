import type { ImportedTrack } from '@shared/importParse';
import type { LibraryOp } from '@shared/library';
import type { MatchReply } from '@shared/importRun';
import type { SongSnapshot } from '@shared/songRef';
import { ALLEGRA_API_URL } from '../account/config';
import { readOpsReply, type OpsReply } from '../sync/opsApi';

interface Envelope<T> { readonly success?: boolean; readonly data?: T; readonly error?: string }
function transientError(message: string, status?: number, retryAfterSeconds?: number): Error & { status?: number; retryAfterSeconds?: number } {
  return Object.assign(new Error(message), { status, retryAfterSeconds });
}

async function request<T>(token: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${ALLEGRA_API_URL}${path}`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: controller.signal
    });
    const retryAfter = Number(response.headers.get('Retry-After'));
    if (!response.ok) throw transientError(`Import request failed (${response.status}).`, response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    const envelope = await response.json() as Envelope<T>;
    if (envelope.success !== true || envelope.data === undefined) throw transientError(envelope.error ?? 'The import service returned an invalid response.', response.status);
    return envelope.data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function matchImportedTracks(token: string, tracks: readonly ImportedTrack[], signal: AbortSignal): Promise<readonly MatchReply[]> {
  const reply = await request<{ readonly results: readonly { readonly index: number; readonly song: SongSnapshot | null; readonly confidence: 'exact' | 'close' | 'none'; readonly retryable?: boolean }[] }>(token, '/api/import/match', { tracks }, signal);
  return reply.results;
}

export async function applyImportLibraryOps(token: string, ops: readonly LibraryOp[], sentAt: number, signal: AbortSignal): Promise<OpsReply> {
  const reply = await request<unknown>(token, '/api/me/library/ops', { ops, sentAt }, signal);
  const parsed = readOpsReply(reply);
  if (!parsed) throw transientError('The library did not confirm this import batch.');
  return parsed;
}

export async function sendImportSeed(token: string, artists: readonly { readonly name: string; readonly count: number }[], signal: AbortSignal): Promise<void> {
  await request<unknown>(token, '/api/me/taste/import-seed', { artists }, signal);
}
