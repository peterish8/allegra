import { createHash, randomBytes } from 'node:crypto';
import { SPOTIFY_LIKED_ID, type SpotifySourcePlaylist, type SpotifyStatus, type SpotifySyncStep } from '../shared/spotify.js';
import type { LibraryOp } from '../shared/library.js';
import type { AuthService } from '../auth/auth.js';
import type { ImportMatcher } from './importMatch.js';
import type { SpotifyPlaylist, SpotifyProvider, SpotifyTrack } from '../providers/spotify.js';
import { SpotifyApiError } from '../providers/spotify.js';
import type { SpotifyStore, StoredSpotifyPlaylist } from '../db/spotifyStore.js';

const SCOPE = 'playlist-read-private playlist-read-collaborative user-library-read';
const LIKED_NAME = 'Liked Songs';
const STATE_TTL_MS = 10 * 60_000;
const BATCH = 50;
const LEASE_MS = 90_000;
// ponytail: per-call wall-clock budget; Convex re-calls while `more` is true, so big playlists finish over several calls.
const DAILY_BUDGET_MS = 45_000;

export class SpotifyTransferService {
  private readonly refreshes = new Map<string, Promise<AccessGrant>>();

  public constructor(
    private readonly provider: SpotifyProvider | undefined,
    private readonly clientId: string | undefined,
    private readonly redirectUri: string,
    private readonly store: SpotifyStore,
    private readonly auth: AuthService,
    private readonly matcher: ImportMatcher
  ) {}

  public get configured(): boolean { return Boolean(this.provider && this.clientId); }
  /** Same origin as the registered callback, so a local callback returns to the local app. */
  public get webReturnUrl(): string { return new URL('/import', this.redirectUri).toString(); }

  public async connect(userId: string, returnTo: 'web' | 'mobile'): Promise<string> {
    if (!this.provider || !this.clientId) throw new SpotifyApiError(503, 'Spotify connection is not configured.');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    const stateHash = createHash('sha256').update(state).digest('hex');
    await this.store.saveState(stateHash, { userId, verifier, returnTo }, Date.now() + STATE_TTL_MS);
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: this.redirectUri, scope: SCOPE, state, code_challenge_method: 'S256', code_challenge: challenge }).toString();
    return url.toString();
  }

  public async callback(code: string, rawState: string): Promise<'web'|'mobile'> {
    if (!this.provider) throw new SpotifyApiError(503, 'Spotify connection is not configured.');
    const stateHash = createHash('sha256').update(rawState).digest('hex');
    const state = await this.store.consumeState(stateHash, Date.now());
    if (!state) throw new SpotifyApiError(400, 'This Spotify connection link expired. Start again.');
    const token = await this.provider.exchangeCode(code, state.verifier, this.redirectUri);
    const me = await this.provider.me(token.accessToken);
    const now = Date.now();
    const old = await this.store.connection(state.userId);
    await this.store.saveConnection({ userId: state.userId, spotifyUserId: me.id, refreshToken: token.refreshToken ?? old?.refreshToken ?? '', accessToken: token.accessToken, accessExpiresAt: now + Math.max(30, token.expiresIn) * 1000, dailyEnabled: old?.dailyEnabled ?? false, connectedAt: old?.connectedAt ?? now, updatedAt: now });
    return state.returnTo;
  }

  public async cancel(rawState: string): Promise<'web'|'mobile'> {
    const hash = createHash('sha256').update(rawState).digest('hex');
    const state = await this.store.consumeState(hash, Date.now());
    if (!state) throw new SpotifyApiError(400, 'This Spotify connection link expired. Start again.');
    return state.returnTo;
  }

  public async status(userId: string): Promise<SpotifyStatus> {
    const [connection, rows] = await Promise.all([this.store.connection(userId), this.store.playlists(userId)]);
    return { configured: this.configured, connected: Boolean(connection?.refreshToken), dailyEnabled: connection?.dailyEnabled ?? false, playlists: rows.filter(row => row.enabled).map(publicPlaylist) };
  }

  /** Liked Songs first, then playlists. A connection made before the library scope lists Liked Songs as needing a reconnect. */
  public async sourcePlaylists(userId: string): Promise<SpotifySourcePlaylist[]> {
    const provider = this.requireProvider();
    const { token } = await this.accessToken(userId);
    const [liked, playlists] = await Promise.all([provider.likedSummary(token), provider.playlists(token)]);
    const likedRow: SpotifySourcePlaylist = { id: SPOTIFY_LIKED_ID, name: LIKED_NAME, snapshotId: liked?.snapshotId ?? '', total: liked?.total ?? 0, imageUrl: null, kind: 'liked', ...(liked ? {} : { needsReconnect: true }) };
    return [likedRow, ...playlists];
  }

  /** What a sync step needs about its source; Liked Songs answers from the saved-tracks endpoint. */
  private async source(provider: SpotifyProvider, token: string, playlistId: string): Promise<SpotifyPlaylist | null> {
    if (playlistId !== SPOTIFY_LIKED_ID) return provider.playlist(token, playlistId);
    const liked = await provider.likedSummary(token);
    if (!liked) throw new SpotifyApiError(403, 'Reconnect Spotify to bring over your Liked Songs.');
    return { id: SPOTIFY_LIKED_ID, name: LIKED_NAME, snapshotId: liked.snapshotId, total: liked.total, imageUrl: null };
  }

  /**
   * `skipUnchanged` (daily job, with the row it already read): a finished scan whose Spotify snapshot hasn't moved
   * does no work. Manual sync always rescans, retrying review rows. Every store write carries the connection
   * generation the step started under, so a step in flight across disconnect or reconnect writes nothing after it.
   */
  public async sync(userId: string, playlistId: string, skipUnchanged = false, saved?: StoredSpotifyPlaylist): Promise<SpotifySyncStep> {
    const provider = this.requireProvider();
    const liked = playlistId === SPOTIFY_LIKED_ID;
    if (!liked && !/^[A-Za-z0-9]{10,40}$/.test(playlistId)) throw new SpotifyApiError(400, 'Choose a valid Spotify playlist.');
    const { token, generation } = await this.accessToken(userId);
    const source = await this.source(provider, token, playlistId);
    if (!source) throw new SpotifyApiError(404, 'Spotify could not find that playlist.');
    // Liked Songs become Allegra likes; a playlist becomes its own library. Library ids allow only [A-Za-z0-9_-] (parseLibraryOps).
    const now = Date.now(); const libraryId = liked ? SPOTIFY_LIKED_ID : `spotify-${playlistId}`;
    if (skipUnchanged && saved?.lastSyncedAt && saved.offset === 0 && saved.scanSnapshotId === source.snapshotId) {
      return { complete: true, added: 0, skipped: 0, reviewNeeded: 0, libraryId };
    }
    if (!(await this.store.savePlaylist({ userId, playlistId, name: source.name, snapshotId: source.snapshotId, total: source.total, libraryId, enabled: true, updatedAt: now }, generation))) throw connectionChanged();
    const leaseToken = randomBytes(18).toString('base64url');
    let claimed = await this.store.claim(userId, playlistId, leaseToken, now, LEASE_MS, generation);
    if (!claimed) throw new SpotifyApiError(409, 'This playlist is already syncing. Try again shortly.');
    try {
      let offset = claimed.offset;
      // The items page carries no snapshot_id; the playlist listing does. Edited mid-scan -> restart (receipts make the rescan cheap).
      if (offset > 0 && claimed.scanSnapshotId !== source.snapshotId) {
        offset = 0;
        claimed = { ...claimed, added: 0, skipped: 0, reviewNeeded: 0 };
      }
      const page = liked ? await provider.likedItems(token, offset, BATCH) : await provider.items(token, playlistId, offset, BATCH);
      const ids = page.tracks.map(track => track.id);
      const seen = await this.store.receipts(userId, playlistId, ids);
      const unseen = page.tracks.filter(track => !seen.has(track.id));
      const results = await this.matcher.match(unseen.map(toImportedTrack));
      const receiptRows: { trackId: string; libraryId: string }[] = [];
      const ops: LibraryOp[] = [];
      const profile = await this.auth.getUser(userId);
      if (!profile) throw new SpotifyApiError(401, 'Sign in again to continue this transfer.');
      const libraryExists = liked || profile.libraries.some(row => row.id === libraryId);
      if (!libraryExists) ops.push({ op: 'playlist_upsert', playlistId: libraryId, name: source.name.slice(0, 60), isPublic: false, at: now });
      const sourceCount = page.total <= offset ? 0 : Math.min(BATCH, page.total - offset);
      let added = claimed.added; const skipped = claimed.skipped + seen.size + Math.max(0, sourceCount - page.tracks.length); let reviewNeeded = claimed.reviewNeeded;
      for (let i = 0; i < unseen.length; i++) {
        const track = unseen[i]!; const result = results[i];
        if (result?.confidence === 'exact' && result.song) {
          const at = stableAddedAt(track.addedAt);
          ops.push(liked
            ? { op: 'like', ref: result.song.ref, song: result.song, origin: 'import', at }
            : { op: 'playlist_add', playlistId: libraryId, ref: result.song.ref, song: result.song, origin: 'import', at });
          receiptRows.push({ trackId: track.id, libraryId }); added++;
        } else {
          reviewNeeded++;
          // No receipt: uncertain or temporarily unavailable rows are retried during the next full scan.
        }
      }
      if (ops.length > 0) {
        // The library is not in Spotify's store, so the generation can't fence it in one transaction. Re-checking
        // here, after the slow Spotify and matching calls, leaves only this last round trip open to a disconnect.
        const live = await this.store.connection(userId);
        if (!live?.refreshToken || (live.generation ?? 0) !== generation) throw connectionChanged();
        const result = await this.auth.library.apply(userId, ops);
        if (result.rejected.length > 0) throw new SpotifyApiError(503, 'Allegra could not save this transfer step. Retry it safely.');
      }
      // Unsupported/local Spotify rows are absent from `tracks`; advance by API source rows.
      const finalOffset = offset + sourceCount;
      const complete = finalOffset >= page.total;
      const cumulativeAdded = added; const cumulativeSkipped = skipped; const cumulativeReview = reviewNeeded;
      const ack = await this.store.checkpoint(userId, playlistId, leaseToken, { receipts: receiptRows, offset: finalOffset, snapshotId: source.snapshotId, total: page.total, added: cumulativeAdded, skipped: cumulativeSkipped, reviewNeeded: cumulativeReview, complete }, generation);
      if (!ack) throw new SpotifyApiError(409, 'This transfer step expired. Retry it safely.');
      return { complete, added: cumulativeAdded, skipped: cumulativeSkipped, reviewNeeded: cumulativeReview, libraryId };
    } finally { await this.store.release(userId, playlistId, leaseToken); }
  }

  /**
   * One budgeted call of a daily run. The run is named by its start time; a playlist is marked with it once it
   * finishes or is skipped, so repeated calls walk every enabled playlist exactly once, least recently checked first.
   * `more` -> the scheduler calls again. Retryable failures (429, 5xx) and a lost connection (401) escape unmarked so
   * the scheduler's retry resumes the same playlist from its checkpoint; a playlist that cannot sync today is skipped.
   */
  public async dailyStep(userId: string, runStartedAt: number = startOfUtcDay(Date.now()), now: () => number = Date.now): Promise<{ more: boolean }> {
    const started = now();
    const connection = await this.store.connection(userId);
    if (!connection?.refreshToken) throw new SpotifyApiError(401, 'Reconnect your Spotify account to continue.');
    const generation = connection.generation ?? 0;
    const attempted = new Set<string>();
    // A playlist failing with a server error is deferred, not left in front: the others still run first.
    let deferred: unknown = null;
    for (;;) {
      const batch = (await this.store.dailyPlaylists(userId, runStartedAt, DAILY_PAGE)).filter(row => !attempted.has(row.playlistId));
      if (batch.length === 0) {
        // Only deferred playlists are left; the scheduler's retry (honouring Retry-After) tries them again.
        if (deferred) throw deferred;
        return { more: false };
      }
      for (const row of batch) {
        attempted.add(row.playlistId);
        let mark = runStartedAt;
        try {
          while (!(await this.sync(userId, row.playlistId, true, row)).complete) {
            if (now() - started > DAILY_BUDGET_MS) return { more: true };
          }
        } catch (error) {
          if (defersInRun(error)) {
            deferred ??= error;
            // Still before the run's start, so still due, but after every playlist this run has not tried yet.
            mark = runStartedAt - 1;
          } else if (!skipsForToday(error)) throw error;
        }
        if (!(await this.store.markDailyChecked(userId, row.playlistId, mark, generation))) throw connectionChanged();
        if (now() - started > DAILY_BUDGET_MS) return { more: true };
      }
    }
  }

  public async setDaily(userId: string, enabled: boolean): Promise<boolean> { return this.store.setDaily(userId, enabled); }
  public async disconnect(userId: string): Promise<void> { await this.store.disconnect(userId); }

  private requireProvider(): SpotifyProvider {
    if (!this.provider) throw new SpotifyApiError(503, 'Spotify connection is not configured.');
    return this.provider;
  }

  private async accessToken(userId: string): Promise<AccessGrant> {
    const pending = this.refreshes.get(userId); if (pending) return pending;
    const work = this.refreshAccessToken(userId); this.refreshes.set(userId, work);
    try { return await work; } finally { this.refreshes.delete(userId); }
  }

  private async refreshAccessToken(userId: string): Promise<AccessGrant> {
    const row = await this.store.connection(userId);
    if (!row?.refreshToken) throw new SpotifyApiError(401, 'Reconnect your Spotify account to continue.');
    const generation = row.generation ?? 0;
    const now = Date.now();
    if (row.accessToken && (row.accessExpiresAt ?? 0) > now + 60_000) return { token: row.accessToken, generation };
    const refreshed = await this.requireProvider().refresh(row.refreshToken);
    const saved = { ...row, refreshToken: refreshed.refreshToken ?? row.refreshToken, accessToken: refreshed.accessToken, accessExpiresAt: now + Math.max(30, refreshed.expiresIn) * 1000, updatedAt: now };
    // A refresh that started before a disconnect or reconnect must not overwrite the newer credential.
    if (!(await this.store.saveRefreshedConnection(saved, generation))) throw connectionChanged();
    return { token: refreshed.accessToken, generation };
  }
}

interface AccessGrant { token: string; generation: number }
const DAILY_PAGE = 5;

function connectionChanged(): SpotifyApiError { return new SpotifyApiError(401, 'Spotify connection changed. Reconnect to continue.'); }
/**
 * A server error on one playlist (Spotify 5xx, Allegra failing to save the step, an unexpected throw) is retried
 * later in the run. 429 is app-wide and 401 means the connection is gone: those stop the account at once.
 */
function defersInRun(error: unknown): boolean {
  return error instanceof SpotifyApiError ? error.status >= 500 : true;
}
/** Failures specific to one playlist (gone, forbidden, already being synced by hand) skip it for today. */
function skipsForToday(error: unknown): boolean {
  return error instanceof SpotifyApiError && (error.status === 400 || error.status === 403 || error.status === 404 || error.status === 409);
}
function startOfUtcDay(at: number): number { return at - (at % 86_400_000); }

function publicPlaylist(row: StoredSpotifyPlaylist) {
  return { id: row.playlistId, name: row.name, libraryId: row.libraryId, lastSyncedAt: row.lastSyncedAt ?? null, added: row.added, skipped: row.skipped, reviewNeeded: row.reviewNeeded, syncing: (row.leaseUntil ?? 0) > Date.now() };
}
function toImportedTrack(track: SpotifyTrack) { return { title: track.title, artist: track.artist, ...(track.album ? { album: track.album } : {}), durationSec: track.durationSec }; }
function stableAddedAt(value: string): number { const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 1; }
