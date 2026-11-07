/**
 * Sharing (1.44.0, owner): every song and playlist shares as one https link (packages/shared/shareLinks.ts) that opens
 * LuvLyrics where it is installed and the website elsewhere, and as a LuvLyrics code to scan (packages/shared/luvCode).
 *
 * - A song's link names its catalog song (a stream's id, or a download's `originId`), with its title and artist.
 * - A playlist's link is the account's share code (`POST /api/libraries/:id/share`, which makes it public). A playlist
 *   that is not on the account (signed out, never synced) is shared as a list of its songs instead.
 * - Opening a link: a song plays at once; a public playlist opens on its own page (SharedPlaylistScreen).
 */
import { fromMobileId, parseSongRef, type SongRef } from '@shared/songRef';
import { shareUrlFor, type ShareTarget } from '@shared/shareLinks';
import type { LuvCodePayload } from '@shared/luvCode';
import { ALLEGRA_API_URL } from '../account/config';
import { toPlayableAllegraSong, type AllegraSong } from '../account/allegraApi';
import { fetchJson } from '../net/fetchWithTimeout';
import type { Song, UnifiedSong } from '../../types/song';

let tokenSource: () => string | null = () => null;
/** The signed-in session's token (ConnectProvider); sharing a playlist and saving a shared one need it. */
export function setShareTokenSource(source: () => string | null): void {
  tokenSource = source;
}

/** A song's catalog ref: a stream carries it in its id, a download keeps it as `originId`. */
export function songRefOf(song: Pick<Song, 'id' | 'originId'>): SongRef | null {
  const fromId = fromMobileId(song.id);
  if (fromId) return fromId;
  const parsed = song.originId ? parseSongRef(song.originId) : null;
  return parsed ? `${parsed.source}:${parsed.id}` : null;
}

export const songShareTarget = (song: Pick<Song, 'id' | 'originId' | 'title' | 'artist'>): ShareTarget => ({
  kind: 'song', ref: songRefOf(song), title: song.title, artist: song.artist ?? '',
});

/** What a share's LuvLyrics code carries, or null when it has none (a non-Saavn song, a song found only by name). */
export function codePayloadFor(target: ShareTarget): LuvCodePayload | null {
  if (target.kind === 'playlist') return { kind: 'playlist', code: target.code };
  const parsed = target.ref ? parseSongRef(target.ref) : null;
  return parsed?.source === 'saavn' ? { kind: 'song', source: 'saavn', id: parsed.id } : null;
}

/** A scanned code -> the share it stands for. */
export const targetForPayload = (payload: LuvCodePayload): ShareTarget =>
  payload.kind === 'playlist'
    ? { kind: 'playlist', code: payload.code }
    : { kind: 'song', ref: `saavn:${payload.id}`, title: '', artist: '' };

/** The message a share sends: the name, then the link. */
export const shareMessage = (target: ShareTarget, name: string): string => `${name}\n${shareUrlFor(target)}`;

interface Envelope<T> { success: boolean; data?: T; error?: string }

const codes = new Map<string, string>();
/**
 * The playlist's share code from the account (made public on the website too), or null when it cannot have one:
 * signed out, Liked songs, or a playlist the account does not hold.
 */
export async function playlistShareCode(playlistId: string): Promise<string | null> {
  const cached = codes.get(playlistId);
  if (cached) return cached;
  const token = tokenSource();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${ALLEGRA_API_URL}/api/libraries/${encodeURIComponent(playlistId)}/share`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Envelope<{ code: string }>;
    const code = json.success && json.data?.code ? json.data.code.toLowerCase() : null;
    if (code) codes.set(playlistId, code);
    return code;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A catalog song by its ref (only JioSaavn ids hydrate), ready to play. */
export async function fetchSharedSong(ref: SongRef): Promise<UnifiedSong | null> {
  const parsed = parseSongRef(ref);
  if (parsed?.source !== 'saavn') return null;
  const res = await fetchJson<Envelope<AllegraSong>>(`${ALLEGRA_API_URL}/api/songs/${encodeURIComponent(parsed.id)}`, { timeoutMs: 10_000 });
  return res?.success && res.data ? toPlayableAllegraSong(res.data) : null;
}

export interface SharedPlaylist {
  readonly code: string;
  readonly name: string;
  readonly ownerName: string;
  readonly coverUrl: string | null;
  readonly songs: UnifiedSong[];
}

/** A public playlist by its share code, or null when the link is off or unknown. */
export async function fetchSharedPlaylist(code: string): Promise<SharedPlaylist | null> {
  type Payload = { code: string; name: string; ownerName: string; coverUrl?: string; songs: AllegraSong[] };
  const res = await fetchJson<Envelope<Payload>>(`${ALLEGRA_API_URL}/api/shared/${encodeURIComponent(code)}`, { timeoutMs: 12_000 });
  if (!res?.success || !res.data) return null;
  const songs = res.data.songs.map(toPlayableAllegraSong).filter((s): s is UnifiedSong => s !== null);
  return { code: res.data.code, name: res.data.name, ownerName: res.data.ownerName, coverUrl: res.data.coverUrl ?? null, songs };
}

/** Saves a private copy into the listener's account (it reaches the phone with the next sync). */
export async function saveSharedPlaylist(code: string): Promise<'saved' | 'signed-out' | 'failed'> {
  const token = tokenSource();
  if (!token) return 'signed-out';
  try {
    const res = await fetch(`${ALLEGRA_API_URL}/api/shared/${encodeURIComponent(code)}/save`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    return res.ok ? 'saved' : 'failed';
  } catch {
    return 'failed';
  }
}
