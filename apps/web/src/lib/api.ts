import type { AccountProfile, ApiResponse, ArtistProfile, ArtistSummary, HomePayload, LyricLine, LyricsPayload, MotionArtwork, SharedPlaylist, TasteSummary, UnifiedSong } from '@shared/types';
import { POLICY_VERSION, type ReportReason } from '@shared/legal';
import type { BlendCreated, BlendDetail, BlendInviteLink, BlendInvitePreview, BlendSummary } from '@shared/blendView';
import type { ImportedTrack } from '@shared/importParse';
import type { LibraryChange, LibraryOp } from '@shared/library';
import { fromAllegraSong, type SongRef, type SongSnapshot } from '@shared/songRef';
import type { SpotifySourcePlaylist, SpotifyStatus, SpotifySyncStep } from '@shared/spotify';
import type { ListenExit } from '@shared/listenSignal';
import type { DjTurnRequest, DjTurnResponse } from '@shared/dj';
import type { RadioTaste } from '@shared/radio';
import { TYPEAHEAD_LIMIT } from '@shared/typeahead';

export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
  /** S3 object key; present when a custom cover was uploaded. */
  readonly coverKey?: string;
  /** Browser-facing cover URL derived by the API from coverKey. */
  readonly coverUrl?: string;
}

/*
 * Leave NEXT_PUBLIC_API_BASE_URL blank everywhere: requests then hit same-origin
 * `/api`. In dev Next rewrites that to the Express server (see next.config.ts); on
 * Vercel the same path is the Express function. That avoids CORS and the Windows
 * localhost vs 127.0.0.1 trap. Set it only to point a build at a remote API.
 */
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  public readonly status: number;
  /** A machine-readable reason some routes add beside the copy (Blend: 'full', 'limit', …). */
  public readonly code: string | undefined;
  /** From a 429's Retry-After header, in seconds. */
  public readonly retryAfterSeconds: number | undefined;

  public constructor(message: string, status: number, extra: { readonly code?: string; readonly retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = extra.code;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

/** Retry-After accepts either a delta or an HTTP date. */
function retryAfterOf(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = raw === null ? Number.NaN : Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : undefined;
}

export function apiBaseUrl(): string {
  return API_BASE_URL;
}

export function resolveApiUrl(path: string): string {
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const normalized = path.replace(/^\/+/, '');
  return API_BASE_URL ? `${API_BASE_URL}/${normalized}` : `/${normalized}`;
}

const TOKEN_KEY = 'allegra-session-token';
let renewing: Promise<void> | null = null;

/*
 * Set by the sign-in provider once Convex Auth has a session. It wins over the
 * stored guest token, so the API sees the account. Kept as a module value rather
 * than a React context because non-component callers (this module) need it too.
 */
let accountToken: string | null = null;

export function setAccountToken(token: string | null): void {
  accountToken = token;
}

/** The token this browser should present right now: the account's, else the guest's. */
function currentToken(): string | null {
  if (accountToken) return accountToken;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/*
 * A stored token can outlive its user (API restarted on the in-memory store, or a
 * fresh Convex deployment). The API answers 401, and without this the Library
 * sat on an error forever. Renew once, deduped across parallel calls, and retry.
 */
function renewSession(): Promise<void> {
  renewing ??= (async () => {
    window.localStorage.removeItem(TOKEN_KEY);
    const session = await createAnonymousSession();
    window.localStorage.setItem(TOKEN_KEY, session.token);
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

const DEFAULT_TIMEOUT_MS = 15000;

/*
 * A distinct, non-DOMException abort reason for our own timeout. fetch() rejects
 * with whatever `signal.reason` was, so the catch block below can tell "the user
 * (or a caller's own controller) cancelled this" — a DOMException named
 * AbortError, forwarded as-is — apart from "this just timed out", which is never
 * a DOMException and therefore falls through to the friendly ApiError message.
 */
const TIMEOUT_REASON = Symbol('allegra-api-timeout');

/** Calls that only make sense for a listener (a guest counts). Everything else is public. */
function needsSession(path: string): boolean {
  return path.startsWith('/api/me/') || path.startsWith('/api/libraries') || path === '/api/auth/me';
}

async function send(path: string, init?: RequestInit, canRenew = true): Promise<Response> {
  // A browser with no token yet used to send a dozen of these, take a dozen 401s, and retry them
  // all. Start the guest session first (one shared request) and they go out signed once.
  if (canRenew && needsSession(path) && !currentToken()) await ensureSession().catch(() => undefined);
  let response: Response;
  // Every call gets its own AbortController so a stalled connection cannot hang
  // the caller forever, even when the caller never passed a signal of its own
  // (most mutating calls in this file don't). A caller-supplied signal is
  // combined in rather than replaced: aborting either one aborts the fetch.
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const forwardCallerAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', forwardCallerAbort);
  }
  const timeoutId = window.setTimeout(() => controller.abort(TIMEOUT_REASON), DEFAULT_TIMEOUT_MS);
  try {
    const token = currentToken();
    response = await fetch(resolveApiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('We could not reach the music service. Check your connection and try again.', 0);
  } finally {
    window.clearTimeout(timeoutId);
    if (callerSignal) callerSignal.removeEventListener('abort', forwardCallerAbort);
  }
  // A signed-in 401 is a real authorization failure; starting a guest session would
  // silently drop the listener out of their own account.
  if (response.status === 401 && canRenew && !accountToken && !path.startsWith('/api/auth/')) {
    await renewSession().catch(() => undefined);
    return send(path, init, false);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!isApiResponse<T>(body)) {
    throw new ApiError('The music service returned an unexpected response.', response.status);
  }
  if (!response.ok || !body.success) {
    const extra = body as unknown as Record<string, unknown>;
    const code = typeof extra.code === 'string' ? extra.code : undefined;
    const retryAfterSeconds = retryAfterOf(response);
    throw new ApiError(body.success ? 'Something went wrong. Try again shortly.' : body.error, response.status, {
      ...(code ? { code } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
    });
  }
  return body.data;
}

async function requestWithoutBody(path: string, init?: RequestInit): Promise<void> {
  const response = await send(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    if (isApiResponse<never>(body) && !body.success) throw new ApiError(body.error, response.status);
    throw new ApiError('Something went wrong. Try again shortly.', response.status);
  }
}

export async function searchSongs(query: string, signal?: AbortSignal, page = 0): Promise<{ results: UnifiedSong[]; source: 'Saavn' | 'Gaana' }> {
  return request(`/api/search?q=${encodeURIComponent(query)}&limit=20&page=${page}`, { signal });
}

/** As-you-type search: lean, relevance-ordered, edge-cached. */
export async function suggestSongs(query: string, signal?: AbortSignal): Promise<UnifiedSong[]> {
  return (await request<{ results: UnifiedSong[] }>(`/api/search/suggest?q=${encodeURIComponent(query)}&limit=${TYPEAHEAD_LIMIT}`, { signal })).results;
}

export interface RadioPool {
  readonly candidates: { readonly song: UnifiedSong; readonly source: 'similar' | 'artist' | 'taste'; readonly rank: number }[];
  readonly taste: RadioTaste | null;
}

/** Candidates for a song radio; `packages/shared/radio.ts` ranks them as the listener reacts. */
export async function fetchRadio(songId: string, signal?: AbortSignal): Promise<RadioPool> {
  return request(`/api/radio/${encodeURIComponent(songId)}`, { signal });
}

/** Provider profile for an artist: real photo, followers, top songs, albums, similar artists. */
export async function fetchArtist(name: string, signal?: AbortSignal): Promise<ArtistProfile> {
  return request(`/api/artists/${encodeURIComponent(name)}`, { signal });
}

/** Photos for a list of artist names (max 12). Names without a photo are omitted. */
export async function fetchArtistFaces(names: readonly string[], signal?: AbortSignal): Promise<ArtistSummary[]> {
  return request(`/api/artists/faces?names=${encodeURIComponent(names.join(','))}`, { signal });
}

/** The home shelves, in the listener's languages, with Top 10 for `region` (`auto`: where they are). */
export async function fetchHome(signal?: AbortSignal, options: { readonly languages?: readonly string[]; readonly region?: string } = {}): Promise<HomePayload> {
  const params = new URLSearchParams();
  if (options.languages?.length) params.set('languages', options.languages.join(','));
  if (options.region && options.region !== 'auto') params.set('region', options.region);
  const query = params.toString();
  return request(`/api/home${query ? `?${query}` : ''}`, { signal });
}

export async function fetchLyrics(song: UnifiedSong, signal?: AbortSignal): Promise<LyricsPayload> {
  return request(
    `/api/lyrics?${new URLSearchParams({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      duration: String(song.duration),
      syncedOnly: 'false'
    }).toString()}`,
    { signal }
  );
}

/** Explicitly requested alternatives, not the normal fast lyric cascade. */
export async function fetchLyricsAlternatives(song: UnifiedSong, signal?: AbortSignal): Promise<LyricsPayload[]> {
  return request(
    `/api/lyrics/alternatives?${new URLSearchParams({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      duration: String(song.duration),
      syncedOnly: 'false'
    }).toString()}`,
    { signal }
  );
}

/** `GET /api/artwork`: cover links for a song by title and artist, best guess first. */
export async function fetchArtworkUrls(title: string, artist: string, signal?: AbortSignal): Promise<readonly string[]> {
  const { urls } = await request<{ urls: string[] }>(
    `/api/artwork?${new URLSearchParams({ title, artist, limit: '1' }).toString()}`,
    { signal }
  );
  return Array.isArray(urls) ? urls : [];
}

/** Optional Apple Music editorial motion artwork. `null` keeps the normal cover untouched. */
export async function fetchCanvasArtwork(song: Pick<UnifiedSong, 'title' | 'artist' | 'album' | 'duration'>, signal?: AbortSignal): Promise<MotionArtwork | null> {
  return request(
    `/api/canvas?${new URLSearchParams({
      title: song.title,
      artist: song.artist,
      ...(song.album ? { album: song.album } : {}),
      ...(song.duration > 0 ? { duration: String(Math.round(song.duration)) } : {})
    }).toString()}`,
    { signal }
  );
}

/** `GET /api/health` (not enveloped: `{ ok, version }`). Null when the server can't be reached. */
export async function fetchHealth(signal?: AbortSignal): Promise<{ readonly ok: boolean; readonly version: string } | null> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 6000);
  const onAbort = (): void => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(resolveApiUrl('/api/health'), { signal: timeout.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const record = body as Record<string, unknown>;
    return { ok: record.ok === true, version: typeof record.version === 'string' ? record.version : 'unknown' };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Placeholder synced lines when the lyrics API returns 404. */
export async function createAnonymousSession(): Promise<{ token: string; userId: string }> {
  return request('/api/auth/anon', { method: 'POST' });
}

export async function fetchLikedSongs(signal?: AbortSignal): Promise<UnifiedSong[]> {
  return request('/api/me/liked', { signal });
}

export async function setLikedSong(songId: string, liked: boolean): Promise<void> {
  if (liked) {
    await request('/api/me/liked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId })
    });
    return;
  }
  await requestWithoutBody(`/api/me/liked/${encodeURIComponent(songId)}`, { method: 'DELETE' });
}

export async function fetchRecentlyPlayed(signal?: AbortSignal): Promise<UnifiedSong[]> {
  return request('/api/me/recently-played', { signal });
}

export async function fetchSuggestions(songId: string, signal?: AbortSignal, limit = 20): Promise<UnifiedSong[]> {
  return request(`/api/songs/${encodeURIComponent(songId)}/suggestions?limit=${Math.min(30, Math.max(1, limit))}`, { signal });
}

/** The ref and snapshot an account write needs for a song (also used by Import's manual fixes). */
export function snapshotForAccount(song: UnifiedSong): { readonly ref: SongRef; readonly snapshot: SongSnapshot } | null {
  const synced = song as UnifiedSong & { readonly libraryRef?: SongRef; readonly librarySnapshot?: SongSnapshot };
  const ref = synced.libraryRef ?? fromAllegraSong(song);
  if (!ref) return null;
  return {
    ref,
    snapshot: synced.librarySnapshot ?? {
      ref,
      title: song.title,
      artist: song.artist,
      ...(song.album ? { album: song.album } : {}),
      artwork: song.artwork,
      duration: song.duration
    }
  };
}

export async function recordRecentlyPlayed(song: UnifiedSong, playDuration: number): Promise<void> {
  const playback = snapshotForAccount(song);
  if (!playback) return;
  await request('/api/me/recently-played', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songRef: playback.ref, song: playback.snapshot, playDuration })
  });
}

export async function fetchSongsByIds(ids: readonly string[], signal?: AbortSignal): Promise<UnifiedSong[]> {
  if (ids.length === 0) return [];
  const results: UnifiedSong[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    results.push(...await request<UnifiedSong[]>(`/api/songs?ids=${batch.map(encodeURIComponent).join(',')}`, { signal }));
  }
  return results;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export async function fetchLibraries(signal?: AbortSignal): Promise<LibraryRecord[]> {
  return request('/api/libraries', { signal });
}

/** All current library rows, including phone-only refs absent from the Saavn profile projection. */
export async function fetchLibraryChanges(since = 0, signal?: AbortSignal): Promise<{ rev: number; changes: LibraryChange[] }> {
  const changes: LibraryChange[] = [];
  let cursor = Math.max(0, Math.floor(since));
  for (;;) {
    const page = await request<{ rev: number; changes: LibraryChange[]; more: boolean }>(
      `/api/me/library/changes?since=${cursor}&limit=500`,
      { signal }
    );
    changes.push(...page.changes);
    if (!page.more) return { rev: page.rev, changes };
    if (page.rev <= cursor) throw new ApiError('Your library could not be loaded. Try again shortly.', 502);
    cursor = page.rev;
  }
}

/** Apply one or more cross-device library operations without reducing refs to bare Saavn ids. */
export interface LibraryApplyReply {
  readonly rev: number;
  readonly rejected: { readonly index: number; readonly reason: string }[];
  readonly superseded: readonly number[];
  readonly applied: number;
}

export async function applyLibraryOps(ops: readonly LibraryOp[], options: { readonly sentAt?: number; readonly signal?: AbortSignal } = {}): Promise<LibraryApplyReply> {
  return request<LibraryApplyReply>('/api/me/library/ops', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ops, sentAt: options.sentAt ?? Date.now() }),
    ...(options.signal ? { signal: options.signal } : {})
  });
}

export async function createLibrary(name: string): Promise<LibraryRecord> {
  return request('/api/libraries', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
}

export async function deleteLibrary(libraryId: string): Promise<void> {
  await requestWithoutBody(`/api/libraries/${encodeURIComponent(libraryId)}`, { method: 'DELETE' });
}

export async function addSongToLibrary(libraryId: string, songId: string): Promise<LibraryRecord> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}/songs`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ songId }) });
}

export async function removeSongFromLibrary(libraryId: string, songId: string): Promise<LibraryRecord> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' });
}

export interface CoverUploadSign {
  readonly uploadUrl: string;
  readonly coverKey: string;
  readonly coverUrl: string;
  readonly headers: { readonly 'Content-Type': string; readonly 'Content-Length': string };
  readonly expiresInSeconds: number;
}

/** Ask the API for a short-lived S3 PUT URL. The browser uploads the bytes itself. */
export async function signCoverUpload(libraryId: string, file: File): Promise<CoverUploadSign> {
  return request('/api/uploads/sign', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ libraryId, contentType: file.type, contentLength: file.size })
  });
}

export async function setLibraryCover(libraryId: string, coverKey: string | null): Promise<LibraryRecord> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ coverKey })
  });
}

/**
 * Full cover upload: sign → PUT to S3 with the signed headers → PATCH the library.
 * Throws ApiError / Error with user-facing copy.
 */
export async function uploadLibraryCover(libraryId: string, file: File, onProgress?: (ratio: number) => void): Promise<LibraryRecord> {
  const signed = await signCoverUpload(libraryId, file);
  onProgress?.(0.15);
  await putToPresignedUrl(signed.uploadUrl, file, signed.headers, (ratio) => onProgress?.(0.15 + ratio * 0.7));
  onProgress?.(0.9);
  const saved = await setLibraryCover(libraryId, signed.coverKey);
  onProgress?.(1);
  return saved;
}

function putToPresignedUrl(
  uploadUrl: string,
  file: File,
  headers: CoverUploadSign['headers'],
  onProgress?: (ratio: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    // Content-Type must match the signed header. Content-Length is a forbidden
    // header name in XHR — the browser sets it from the body, which is why we
    // signed the exact file.size up front.
    xhr.setRequestHeader('Content-Type', headers['Content-Type']);
    void headers['Content-Length'];
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error('The cover could not be uploaded. Try a smaller JPEG, PNG or WebP.'));
    };
    xhr.onerror = () => reject(new Error('The cover could not be uploaded. Check your connection and retry.'));
    xhr.send(file);
  });
}

export async function translateLyrics(
  song: UnifiedSong,
  lines: readonly LyricLine[],
  targetLanguage = 'English',
  signal?: AbortSignal
): Promise<{ lines: LyricLine[]; provider: string }> {
  return request('/api/ai/translate-lyrics', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: song.title, artist: song.artist, lines, targetLanguage }),
    signal
  });
}

export async function fetchAiRecommendations(currentSongId?: string, signal?: AbortSignal): Promise<{ songs: UnifiedSong[]; provider: string; reasoning: string }> {
  const query = currentSongId ? `?songId=${encodeURIComponent(currentSongId)}` : '';
  return request(`/api/ai/recommendations${query}`, { signal });
}

export async function requestDjTurn(input: DjTurnRequest, signal?: AbortSignal): Promise<DjTurnResponse> {
  return request('/api/ai/dj/turn', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
    signal
  });
}

export type DjEarsCloudProvider = 'openai' | 'groq';
export type DjVoiceCloudProvider = 'openai' | 'elevenlabs';

/** A spoken request (base64 16-bit mono WAV) written down by the listener's own transcription provider. */
export async function requestDjTranscription(
  input: { readonly provider: DjEarsCloudProvider; readonly apiKey: string; readonly model?: string; readonly audio: string },
  signal?: AbortSignal
): Promise<{ readonly text: string }> {
  return request('/api/ai/dj/transcribe', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input), signal });
}

/** One DJ reply spoken by the listener's own voice provider, as base64 MP3. */
export async function requestDjSpeech(
  input: { readonly provider: DjVoiceCloudProvider; readonly apiKey: string; readonly model?: string; readonly voice?: string; readonly text: string },
  signal?: AbortSignal
): Promise<{ readonly audio: string; readonly mime: string }> {
  return request('/api/ai/dj/speak', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input), signal });
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.success === 'boolean' && ('data' in record || 'error' in record);
}

/* ---------- Import (behind NEXT_PUBLIC_IMPORT_ENABLED) ---------- */

export interface ImportMatchResult {
  readonly index: number;
  readonly song: SongSnapshot | null;
  readonly confidence: 'exact' | 'close' | 'none';
  readonly retryable?: boolean;
}

/** Finds up to 50 imported tracks in the catalog. Only title, artist, album and length are sent. */
export async function matchImportTracks(tracks: readonly ImportedTrack[], signal?: AbortSignal): Promise<ImportMatchResult[]> {
  const reply = await request<{ results: ImportMatchResult[] }>('/api/import/match', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ tracks }),
    ...(signal ? { signal } : {})
  });
  return reply.results;
}

/** After an import is saved: its top artists seed the taste once (the server keeps 25). */
export async function sendImportSeed(artists: readonly { name: string; count: number }[], signal?: AbortSignal): Promise<void> {
  await requestWithoutBody('/api/me/taste/import-seed', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ artists }), ...(signal ? { signal } : {}) });
}

/* ---------- Blends (behind NEXT_PUBLIC_BLEND_ENABLED) ---------- */

const BLEND_CONSENT = { policyVersion: POLICY_VERSION } as const;

export async function createBlend(name?: string, operationId?: string): Promise<BlendCreated> {
  return request('/api/blends', { method: 'POST', headers: { ...JSON_HEADERS, ...(operationId ? { 'Idempotency-Key': operationId } : {}) }, body: JSON.stringify({ ...(name ? { name } : {}), consent: BLEND_CONSENT }) });
}

export async function fetchSpotifyStatus(signal?: AbortSignal): Promise<SpotifyStatus> {
  return request('/api/spotify/status', signal ? { signal } : undefined);
}

export async function connectSpotify(returnTo: 'web' | 'mobile' = 'web'): Promise<{ url: string }> {
  return request('/api/spotify/connect', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ returnTo }) });
}

export async function fetchSpotifyPlaylists(signal?: AbortSignal): Promise<{ playlists: readonly SpotifySourcePlaylist[] }> {
  return request('/api/spotify/playlists', signal ? { signal } : undefined);
}

export async function syncSpotifyPlaylist(playlistId: string, signal?: AbortSignal): Promise<SpotifySyncStep> {
  return request('/api/spotify/sync', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ playlistId }), ...(signal ? { signal } : {}) });
}

export async function setSpotifyDailySync(dailyEnabled: boolean): Promise<{ dailyEnabled: boolean }> {
  return request('/api/spotify/settings', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dailyEnabled }) });
}

export async function disconnectSpotify(): Promise<{ disconnected: true }> {
  return request('/api/spotify/disconnect', { method: 'POST' });
}

export async function fetchBlends(signal?: AbortSignal): Promise<BlendSummary[]> {
  return request('/api/blends', signal ? { signal } : undefined);
}

export async function fetchBlend(id: string, signal?: AbortSignal): Promise<BlendDetail> {
  return request(`/api/blends/${encodeURIComponent(id)}`, signal ? { signal } : undefined);
}

export async function fetchBlendInvite(id: string, regenerate = false): Promise<BlendInviteLink> {
  return request(`/api/blends/${encodeURIComponent(id)}/invite`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ regenerate }) });
}

export async function previewBlendInvite(code: string, signal?: AbortSignal): Promise<BlendInvitePreview> {
  return request(`/api/blend-invites/${encodeURIComponent(code)}`, signal ? { signal } : undefined);
}

export async function acceptBlendInvite(code: string): Promise<BlendSummary> {
  return request(`/api/blend-invites/${encodeURIComponent(code)}/accept`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ consent: BLEND_CONSENT }) });
}

export async function leaveBlend(id: string): Promise<void> {
  await request<{ left: true }>(`/api/blends/${encodeURIComponent(id)}/leave`, { method: 'POST' });
}

export async function renameBlend(id: string, name: string): Promise<BlendSummary> {
  return request(`/api/blends/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
}

/* ---------- Accounts, taste and sharing ---------- */

export function hasStoredSession(): boolean {
  return Boolean(window.localStorage.getItem(TOKEN_KEY));
}

function storeSession(session: { token: string }): void {
  window.localStorage.setItem(TOKEN_KEY, session.token);
}

let ensuring: Promise<void> | null = null;

/** Makes sure this browser has a session (guest until they sign up). Parallel callers share one request. */
export function ensureSession(): Promise<void> {
  if (accountToken || hasStoredSession()) return Promise.resolve();
  ensuring ??= createAnonymousSession().then(storeSession).finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export async function fetchProfile(signal?: AbortSignal): Promise<AccountProfile> {
  return request('/api/auth/me', { signal });
}

/**
 * Hands this browser's guest token to the account that just signed in, so the likes
 * and playlists built before signing in are not stranded. Safe to call more than
 * once — merging is a union — and a no-op when there was never a guest session.
 */
export async function linkGuestSession(): Promise<AccountProfile | null> {
  let guestToken: string | null = null;
  try {
    guestToken = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
  if (!guestToken) return null;
  try {
    const profile = await request<AccountProfile>('/api/auth/link', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ guestToken })
    });
    // The guest is now part of the account; keeping the token around would let a
    // sign-out silently land back in the old half-populated guest session.
    window.localStorage.removeItem(TOKEN_KEY);
    return profile;
  } catch {
    return null;
  }
}

/** Starts a fresh guest session after signing out, so the app is never token-less. */
export async function startGuestSession(): Promise<AccountProfile> {
  setAccountToken(null);
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the session simply will not persist across reloads.
  }
  storeSession(await createAnonymousSession());
  return fetchProfile();
}

export async function updateDisplayName(displayName: string): Promise<AccountProfile> {
  return request('/api/me/profile', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ displayName }) });
}

export async function fetchTaste(signal?: AbortSignal): Promise<TasteSummary> {
  return request('/api/me/taste', { signal });
}

export async function seedTaste(artists: readonly string[], languages: readonly string[]): Promise<TasteSummary> {
  return request('/api/me/taste/seed', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ artists, languages }) });
}

/** How long a song was really listened to and how it ended; the server counts it for or against the song's artist. */
export async function sendListenSignal(song: UnifiedSong, seconds: number, playedAt: string, ending?: { readonly exit: ListenExit; readonly exitPositionSec: number }): Promise<void> {
  const playback = snapshotForAccount(song);
  if (!playback) return;
  await requestWithoutBody('/api/me/taste/signal', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ songRef: playback.ref, song: playback.snapshot, seconds: Math.round(seconds), cumulativeSeconds: Math.round(seconds), playId: `${playback.snapshot.ref}:${playedAt}`.slice(0, 128), playedAt, ...(ending ? { exit: ending.exit, exitPositionSec: Math.round(ending.exitPositionSec) } : {}) })
  });
}

export async function shareLibrary(libraryId: string): Promise<{ code: string; path: string }> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}/share`, { method: 'POST' });
}

export async function unshareLibrary(libraryId: string): Promise<void> {
  await requestWithoutBody(`/api/libraries/${encodeURIComponent(libraryId)}/share`, { method: 'DELETE' });
}

export async function fetchSharedPlaylist(code: string, signal?: AbortSignal): Promise<SharedPlaylist> {
  return request(`/api/shared/${encodeURIComponent(code)}`, { signal });
}

export async function saveSharedPlaylist(code: string): Promise<LibraryRecord> {
  return request(`/api/shared/${encodeURIComponent(code)}/save`, { method: 'POST' });
}

/** Tells the grievance officer about a shared playlist. Works signed out, like the link itself. */
export async function reportSharedPlaylist(code: string, report: { readonly reason: ReportReason; readonly details?: string; readonly contact?: string }): Promise<void> {
  await request(`/api/shared/${encodeURIComponent(code)}/report`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(report) });
}

/* ---------- Consent and the listener's own data ---------- */

/** Records that the listener agreed to the current policies (the box in the sign-in dialog). */
export async function recordConsent(): Promise<AccountProfile> {
  return request('/api/me/consent', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ policyVersion: POLICY_VERSION }) });
}

/** Everything held about this listener, as one document (docs/api-contract.md AccountExport). */
export async function exportAccountData(): Promise<unknown> {
  return request('/api/me/export');
}

/** Erases this listener's account and everything in it. Not reversible. */
export async function deleteAccount(): Promise<void> {
  await requestWithoutBody('/api/me', { method: 'DELETE' });
}

/** Account-wide settings kept on the server (languages, personalisation), unlike the page's local ones. */
export async function fetchAccountSettings(signal?: AbortSignal): Promise<Record<string, string | number | boolean>> {
  return request('/api/me/settings', { signal });
}

/** Whether the app may learn from this listener's plays. Off erases what was learned, on every device. */
export async function setPersonalization(on: boolean): Promise<Record<string, string | number | boolean>> {
  return request('/api/me/settings', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ personalization: on }) });
}
