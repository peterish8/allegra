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
}
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
          out.push({ id, name: name.slice(0, 120), snapshotId: str(row.snapshot_id) ?? '', total: number(object(row.tracks).total) ?? 0 });
        }
      }
      url = typeof page.next === 'string' ? page.next : null;
    }
    return out;
  }

  public async me(accessToken: string): Promise<SpotifyProfile> {
    const row = object(await this.get(accessToken, `${API}/me`));
    if (!str(row.id)) throw new SpotifyApiError(502, 'Spotify returned an invalid profile.');
    return { id: str(row.id)! };
  }

  public async items(accessToken: string, playlistId: string, offset: number, limit = 50): Promise<{ tracks: SpotifyTrack[]; total: number; snapshotId: string }> {
    const url = `${API}/playlists/${encodeURIComponent(playlistId)}/items?limit=${Math.min(50, limit)}&offset=${Math.max(0, offset)}&market=from_token`;
    const data = await this.get(accessToken, url) as Record<string, unknown>;
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
        throw new SpotifyApiError(response.status, response.status === 401 ? 'Spotify authorization expired.' : `Spotify request failed (${response.status}).`, Number.isFinite(retry) ? Math.max(1, Math.min(3600, retry)) : undefined);
      }
      return payload;
    } catch (error) {
      if (error instanceof SpotifyApiError) throw error;
      throw new SpotifyApiError(503, 'Spotify is temporarily unavailable.');
    } finally { clearTimeout(timer); }
  }
}

export interface TokenResponse { readonly accessToken: string; readonly expiresIn: number; readonly refreshToken?: string }
function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function str(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
