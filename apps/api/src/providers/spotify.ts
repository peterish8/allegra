/** Minimal Spotify Web API client for read-only playlist metadata transfer. */
export interface SpotifyTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly durationSec: number;
  readonly addedAt: string;
}

export interface SpotifyPlaylist {
  readonly id: string;
  readonly name: string;
  readonly snapshotId: string;
  readonly total: number;
  readonly imageUrl: string | null;
}
/** Liked Songs has no snapshot id; its size and newest save stand in for one. */
export interface SpotifyLikedSummary { readonly total: number; readonly snapshotId: string }
export interface SpotifyProfile { readonly id: string }

export class SpotifyApiError extends Error {
  public constructor(public readonly status: number, message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

const API = 'https://api.spotify.com/v1';
const TOKEN = 'https://accounts.spotify.com/api/token';
const TIMEOUT_MS = 8_000;
const COUNT_FIX_MAX = 60;

export class SpotifyProvider {
  public constructor(private readonly clientId: string, private readonly fetchImpl: typeof fetch = fetch) {}

  public async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenResponse> {
    return this.tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code', client_id: this.clientId, code, redirect_uri: redirectUri, code_verifier: verifier
    }));
  }

  public async refresh(refreshToken: string): Promise<TokenResponse> {
    return this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: this.clientId, refresh_token: refreshToken }));
  }

  public async playlists(accessToken: string): Promise<SpotifyPlaylist[]> {
    const out: SpotifyPlaylist[] = [];
    let url: string | null = `${API}/me/playlists?limit=50`;
    while (url && out.length < 200) {
      const data = await this.get(accessToken, url);
      const page = data as { items?: unknown[]; next?: unknown };
      for (const raw of page.items ?? []) {
        const row = object(raw);
        const id = str(row.id); const name = str(row.name);
        // Spotify applies the development-mode owner/collaborator restriction server-side.
        if (id && name) {
          out.push({ id, name: name.slice(0, 120), snapshotId: str(row.snapshot_id) ?? '', total: playlistTotal(row), imageUrl: coverUrl(row.images) });
        }
      }
      url = typeof page.next === 'string' ? page.next : null;
    }
    // /me/playlists now often leaves the count out or at 0 (PixelPlayer hit the same); ask the
    // items endpoint for the real total, six at a time. A failed count stays 0 rather than failing the list.
    const missing = out.filter(row => row.total === 0).slice(0, COUNT_FIX_MAX);
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map(async (row) => {
        try {
          const data = object(await this.get(accessToken, `${API}/playlists/${encodeURIComponent(row.id)}/items?limit=1&fields=total`));
          const total = number(data.total);
          if (total !== undefined) out[out.indexOf(row)] = { ...row, total };
        } catch { /* keep 0 */ }
      }));
    }
    return out;
  }

  /** One playlist's name, snapshot and size: what a sync step needs, without listing every playlist. */
  public async playlist(accessToken: string, playlistId: string): Promise<SpotifyPlaylist | null> {
    try {
      const base = `${API}/playlists/${encodeURIComponent(playlistId)}`;
      // The field filter keeps the reply small; if Spotify ever rejects it, the full object still has everything.
      const row = object(await this.get(accessToken, `${base}?fields=id,name,snapshot_id,images,items(total),tracks(total)`)
        .catch((error: unknown) => { if (error instanceof SpotifyApiError && error.status === 400) return this.get(accessToken, base); throw error; }));
      const id = str(row.id); const name = str(row.name);
      return id && name ? { id, name: name.slice(0, 120), snapshotId: str(row.snapshot_id) ?? '', total: playlistTotal(row), imageUrl: coverUrl(row.images) } : null;
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 404) return null;
      throw error;
    }
  }

  public async me(accessToken: string): Promise<SpotifyProfile> {
    const row = object(await this.get(accessToken, `${API}/me`));
    if (!str(row.id)) throw new SpotifyApiError(502, 'Spotify returned an invalid profile.');
    return { id: str(row.id)! };
  }

  public async items(accessToken: string, playlistId: string, offset: number, limit = 50): Promise<{ tracks: SpotifyTrack[]; total: number; snapshotId: string }> {
    const url = `${API}/playlists/${encodeURIComponent(playlistId)}/items?limit=${Math.min(50, limit)}&offset=${Math.max(0, offset)}&market=from_token`;
    return trackPage(object(await this.get(accessToken, url)));
  }

  /** Liked Songs, newest first. Null when the connection predates the `user-library-read` scope (403). */
  public async likedSummary(accessToken: string): Promise<SpotifyLikedSummary | null> {
    try {
      const data = object(await this.get(accessToken, `${API}/me/tracks?limit=1`));
      const total = number(data.total) ?? 0;
      const newest = str(object(Array.isArray(data.items) ? data.items[0] : undefined).added_at) ?? '';
      return { total, snapshotId: `liked-${total}-${newest}` };
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 403) return null;
      throw error;
    }
  }

  public async likedItems(accessToken: string, offset: number, limit = 50): Promise<{ tracks: SpotifyTrack[]; total: number; snapshotId: string }> {
    return trackPage(object(await this.get(accessToken, `${API}/me/tracks?limit=${Math.min(50, limit)}&offset=${Math.max(0, offset)}&market=from_token`)));
  }

  private async get(token: string, url: string): Promise<unknown> {
    return this.request(url, { headers: { authorization: `Bearer ${token}` } });
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    const raw = await this.request(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const row = object(raw);
    if (typeof row.access_token !== 'string' || typeof row.expires_in !== 'number') throw new SpotifyApiError(502, 'Spotify returned an invalid token response.');
    return { accessToken: row.access_token, expiresIn: row.expires_in, ...(str(row.refresh_token) ? { refreshToken: str(row.refresh_token)! } : {}) };
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retry = Number(response.headers.get('retry-after'));
        throw new SpotifyApiError(response.status, response.status === 401 ? 'Spotify authorization expired.'
          : response.status === 403 ? 'Spotify only shares playlists you own or collaborate on while this app is in development mode.'
          : `Spotify request failed (${response.status}).`, Number.isFinite(retry) ? Math.max(1, Math.min(3600, retry)) : undefined);
      }
      return payload;
    } catch (error) {
      if (error instanceof SpotifyApiError) throw error;
      throw new SpotifyApiError(503, 'Spotify is temporarily unavailable.');
    } finally { clearTimeout(timer); }
  }
}

/** One page of playlist items or saved tracks: both wrap the track as `item` (new) or `track` (old) beside `added_at`. */
function trackPage(data: Record<string, unknown>): { tracks: SpotifyTrack[]; total: number; snapshotId: string } {
  const tracks: SpotifyTrack[] = [];
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const row = object(raw);
    const track = object(row.item ?? row.track);
    const id = str(track.id); const title = str(track.name);
    const artists = Array.isArray(track.artists) ? track.artists.map((artist) => str(object(artist).name)).filter((name): name is string => Boolean(name)) : [];
    if (!id || !title || artists.length === 0 || track.is_local === true || track.type && track.type !== 'track') continue;
    const ms = number(track.duration_ms) ?? 0;
    tracks.push({ id, title: title.slice(0, 200), artist: artists.join(', ').slice(0, 240), ...(str(object(track.album).name) ? { album: str(object(track.album).name)!.slice(0, 200) } : {}), durationSec: Math.min(7200, Math.max(0, Math.round(ms / 1000))), addedAt: str(row.added_at) ?? '' });
  }
  return { tracks, total: number(data.total) ?? tracks.length, snapshotId: str(data.snapshot_id) ?? '' };
}

/** The smallest cover still sharp at thumbnail size (Spotify lists widest first; mosaics have no width). Only Spotify's https image CDN. */
function coverUrl(value: unknown): string | null {
  const images = (Array.isArray(value) ? value : []).map(object)
    .map(image => ({ url: str(image.url), width: number(image.width) }))
    .filter((image): image is { url: string; width: number | undefined } => Boolean(image.url && /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i.test(image.url)));
  const sized = images.filter(image => image.width !== undefined && image.width >= 160).sort((a, b) => a.width! - b.width!);
  return (sized[0] ?? images[0])?.url ?? null;
}

/** Spotify renamed a playlist's `tracks` to `items` (both `{ href, total }`); read either. */
function playlistTotal(row: Record<string, unknown>): number {
  return number(object(row.items).total) ?? number(object(row.tracks).total) ?? 0;
}

export interface TokenResponse { readonly accessToken: string; readonly expiresIn: number; readonly refreshToken?: string }
function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function str(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
