/**
 * Calls to Allegra's API (apps/api) with the account's Convex token. Every call
 * uses fetchWithTimeout: a timeout, and null on any failure, never a throw.
 * Shapes follow docs/api-contract.md: `{ success, data, error? }`.
 */
import { POLICY_VERSION, type Consent } from '@shared/legal';
import type { LibraryChange } from '@shared/library';
import { fromAllegraSong, parseSongRef, type SongRef, type SongSnapshot } from '@shared/songRef';
import type { UnifiedSong } from '../../types/song';

import { fetchJson } from '../net/fetchWithTimeout';
import { ALLEGRA_API_URL } from './config';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** `GET /api/auth/me` (docs/api-contract.md, Accounts). */
export interface AccountProfile {
  userId: string;
  isGuest: boolean;
  createdAt: string;
  consent?: Consent;
  displayName?: string;
  email?: string;
}

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Who this signed-in listener is, or null (signed out, offline, or a guest token). */
export const getAccountProfile = async (token: string): Promise<AccountProfile | null> => {
  const res = await fetchJson<Envelope<AccountProfile>>(`${ALLEGRA_API_URL}/api/auth/me`, {
    headers: authHeaders(token),
    timeoutMs: 10_000,
  });
  return res?.success && res.data && !res.data.isGuest ? res.data : null;
};

// ── Library sync (docs/api-contract.md, "Library sync") ─────────────────────

/** 'sent': done. 'refused': the server will never take it (drop it). 'offline': try again later. */
export type SendOutcome<T> = { outcome: 'sent'; data: T } | { outcome: 'refused' } | { outcome: 'offline' };

const send = async <T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<SendOutcome<T>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${ALLEGRA_API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...authHeaders(token),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    // 4xx other than auth, rate limits and 404: this request is wrong and always will be. A 404 is
    // an API that doesn't have this route yet (an older deployment): keep the change and retry.
    if (res.status >= 400 && res.status < 500 && ![401, 404, 408, 429].includes(res.status)) return { outcome: 'refused' };
    if (!res.ok) return { outcome: 'offline' };
    // Listen signals deliberately return 204: no JSON envelope or body exists.
    if (res.status === 204) return { outcome: 'sent', data: undefined as T };
    const json = (await res.json()) as Envelope<T>;
    return json.success && json.data !== undefined ? { outcome: 'sent', data: json.data } : { outcome: 'offline' };
  } catch {
    return { outcome: 'offline' };
  } finally {
    clearTimeout(timer);
  }
};

export const recordAccountConsent = (token: string): Promise<SendOutcome<AccountProfile>> =>
  send<AccountProfile>('POST', '/api/me/consent', token, { policyVersion: POLICY_VERSION });

export interface ChangesReply {
  rev: number;
  changes: LibraryChange[];
  more: boolean;
  resync?: true;
}

export const getLibraryChanges = (token: string, since: number, limit = 200, resyncContinuation = false): Promise<SendOutcome<ChangesReply>> =>
  send<ChangesReply>(
    'GET',
    `/api/me/library/changes?since=${Math.max(0, Math.floor(since))}&limit=${limit}${resyncContinuation ? '&resync=true' : ''}`,
    token,
  );

/** A play, for Recently played and the taste that ranks Quick picks. `playedAt` for plays made offline. */
export interface PlayEventPayload {
  readonly songId?: string;
  readonly songRef: SongRef;
  readonly song?: SongSnapshot;
  readonly playDuration: number;
  readonly playedAt: string;
}

export interface ListenSignalPayload {
  readonly playId?: string;
  readonly cumulativeSeconds?: number;
  readonly songId?: string;
  readonly songRef: SongRef;
  readonly song?: SongSnapshot;
  readonly seconds: number;
  readonly playedAt: string;
}

export const postPlay = (token: string, play: PlayEventPayload): Promise<SendOutcome<unknown>> =>
  send('POST', '/api/me/recently-played', token, play);

/** How long a song was listened to: the stronger taste signal. */
export const postListenSignal = (token: string, signal: ListenSignalPayload): Promise<SendOutcome<unknown>> =>
  send('POST', '/api/me/taste/signal', token, signal);

/** Allegra catalog rows by Saavn id (for synced songs that arrived without their details). */
export interface AllegraSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork: string;
  /** Same-origin API proxy path; never an upstream provider URL. */
  streamUrl: string;
  duration: number;
  source: 'Saavn' | 'Gaana';
}

/** Converts an account catalog row to the phone's playable shape, accepting only API proxy URLs. */
export const toPlayableAllegraSong = (song: AllegraSong): UnifiedSong | null => {
  if (song.source !== 'Saavn' && song.source !== 'Gaana') return null;
  const ref = fromAllegraSong(song);
  const parsedRef = ref ? parseSongRef(ref) : null;
  if (!parsedRef || !song.id) return null;
  const streamPath = /^\/api\/stream\/([^/?#]+)$/.exec(song.streamUrl);
  if (!song.id || !streamPath) return null;
  let decodedId: string;
  try {
    decodedId = decodeURIComponent(streamPath[1]);
  } catch {
    return null;
  }
  const expectedStreamId = parsedRef.source === 'gaana' ? ref : parsedRef.id;
  if (decodedId !== expectedStreamId || decodedId === '.' || decodedId === '..' || /[\\/?#]/.test(decodedId)) return null;
  const streamUrl = `${ALLEGRA_API_URL}${song.streamUrl}`;
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    highResArt: song.artwork,
    downloadUrl: streamUrl,
    streamUrl,
    source: song.source,
    duration: song.duration,
  };
};

/** The catalog rows for provider ids or namespaced SongRefs (unknown rows omitted), or null offline. */
export const getAllegraSongs = async (token: string, refsOrIds: readonly string[]): Promise<AllegraSong[] | null> => {
  if (refsOrIds.length === 0) return [];
  const reply = await send<AllegraSong[]>('GET', `/api/songs?ids=${refsOrIds.map(encodeURIComponent).join(',')}`, token);
  if (reply.outcome === 'offline') return null;
  return reply.outcome === 'sent' && Array.isArray(reply.data) ? reply.data : [];
};

/** The account's Quick picks: the same ranking the website shows. */
export const getRecommendations = async (token: string): Promise<AllegraSong[]> => {
  const reply = await send<{ songs: AllegraSong[] }>('GET', '/api/recommendations', token);
  return reply.outcome === 'sent' && Array.isArray(reply.data.songs) ? reply.data.songs : [];
};
