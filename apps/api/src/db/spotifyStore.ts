import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { ConvexGateway } from './convexGateway.js';

export interface StoredSpotifyConnection { userId: string; spotifyUserId: string; refreshToken: string; accessToken?: string; accessExpiresAt?: number; dailyEnabled: boolean; connectedAt: number; updatedAt: number; generation?: number }
export interface StoredSpotifyPlaylist { userId: string; playlistId: string; name: string; snapshotId: string; total: number; libraryId: string; offset: number; scanSnapshotId: string; scanTotal: number; added: number; skipped: number; reviewNeeded: number; lastSyncedAt?: number; leaseUntil?: number; leaseToken?: string; enabled: boolean; updatedAt: number; dailyCheckedAt?: number }
export interface SpotifyOAuthState { userId: string; verifier: string; returnTo: 'web' | 'mobile' }
export interface SpotifyCheckpoint { receipts: { trackId: string; libraryId: string }[]; offset: number; snapshotId: string; total: number; added: number; skipped: number; reviewNeeded: number; complete: boolean }

/** Spotify credentials are encrypted with a key distinct from the app's auth-signing key. */
export class SpotifyStore {
  private readonly key: Buffer;
  private readonly memoryConnections = new Map<string, StoredSpotifyConnection>();
  private readonly memoryStates = new Map<string, { state: SpotifyOAuthState; expiresAt: number }>();
  private readonly memoryPlaylists = new Map<string, StoredSpotifyPlaylist>();
  private readonly memoryReceipts = new Map<string, Set<string>>();

  public constructor(private readonly gateway: ConvexGateway | undefined, serverSecret: string) {
    this.key = Buffer.from(hkdfSync('sha256', serverSecret, 'allegra-spotify-v1', 'credential-encryption', 32));
  }

  public async saveState(hash: string, state: SpotifyOAuthState, expiresAt: number): Promise<void> {
    if (this.gateway) {
      await this.gateway.mutation('spotify:saveState', { stateHash: hash, userId: state.userId, encryptedVerifier: this.seal(state.verifier), returnTo: state.returnTo, expiresAt });
      return;
    }
    this.memoryStates.set(hash, { state, expiresAt });
  }

  public async consumeState(hash: string, now: number): Promise<SpotifyOAuthState | null> {
    if (this.gateway) {
      const raw = await this.gateway.mutation('spotify:consumeState', { stateHash: hash, now });
      const row = record(raw);
      if (!row || typeof row.userId !== 'string' || typeof row.encryptedVerifier !== 'string' || (row.returnTo !== 'web' && row.returnTo !== 'mobile')) return null;
      try { return { userId: row.userId, verifier: this.open(row.encryptedVerifier), returnTo: row.returnTo }; } catch { return null; }
    }
    const saved = this.memoryStates.get(hash); this.memoryStates.delete(hash);
    return saved && saved.expiresAt > now ? saved.state : null;
  }

  public async connection(userId: string): Promise<StoredSpotifyConnection | null> {
    if (!this.gateway) return this.memoryConnections.get(userId) ?? null;
    const row = record(await this.gateway.query('spotify:connection', { userId }));
    if (!row || typeof row.userId !== 'string' || typeof row.spotifyUserId !== 'string' || typeof row.encryptedRefreshToken !== 'string') return null;
    try {
      // A disconnect tombstone has no token to open; it still reports its generation.
      return { userId: row.userId, spotifyUserId: row.spotifyUserId, refreshToken: row.encryptedRefreshToken === '' ? '' : this.open(row.encryptedRefreshToken), ...(typeof row.encryptedAccessToken === 'string' ? { accessToken: this.open(row.encryptedAccessToken) } : {}), ...(typeof row.accessExpiresAt === 'number' ? { accessExpiresAt: row.accessExpiresAt } : {}), dailyEnabled: row.dailyEnabled === true, connectedAt: number(row.connectedAt) ?? Date.now(), updatedAt: number(row.updatedAt) ?? Date.now(), generation: number(row.generation) ?? 0 };
    } catch { return null; }
  }

  public async saveConnection(value: StoredSpotifyConnection): Promise<void> {
    if (this.gateway) {
      await this.gateway.mutation('spotify:saveConnection', { userId: value.userId, spotifyUserId: value.spotifyUserId, encryptedRefreshToken: this.seal(value.refreshToken), ...(value.accessToken ? { encryptedAccessToken: this.seal(value.accessToken) } : {}), ...(value.accessExpiresAt !== undefined ? { accessExpiresAt: value.accessExpiresAt } : {}), dailyEnabled: value.dailyEnabled, connectedAt: value.connectedAt, updatedAt: value.updatedAt });
    } else this.memoryConnections.set(value.userId, { ...value, generation: (this.memoryConnections.get(value.userId)?.generation ?? 0) + 1 });
  }

  public async saveRefreshedConnection(value: StoredSpotifyConnection, expectedGeneration: number): Promise<boolean> {
    if (!value.accessToken || value.accessExpiresAt === undefined) return false;
    if (this.gateway) return await this.gateway.mutation('spotify:refreshConnection', { userId: value.userId, expectedGeneration, encryptedRefreshToken: this.seal(value.refreshToken), encryptedAccessToken: this.seal(value.accessToken), accessExpiresAt: value.accessExpiresAt, updatedAt: value.updatedAt }) === true;
    const current = this.memoryConnections.get(value.userId);
    if (!current || (current.generation ?? 0) !== expectedGeneration || !current.refreshToken) return false;
    this.memoryConnections.set(value.userId, { ...current, refreshToken: value.refreshToken, accessToken: value.accessToken, accessExpiresAt: value.accessExpiresAt, updatedAt: value.updatedAt });
    return true;
  }

  public async setDaily(userId: string, enabled: boolean): Promise<boolean> {
    if (this.gateway) return await this.gateway.mutation('spotify:setDaily', { userId, enabled, updatedAt: Date.now() }) === true;
    const row = this.memoryLive(userId, undefined); if (!row) return false;
    this.memoryConnections.set(userId, { ...row, dailyEnabled: enabled, updatedAt: Date.now() }); return true;
  }

  /** Memory twin of Convex `liveConnection`: a disconnected or reconnected account fences older steps. */
  private memoryLive(userId: string, generation: number | undefined): StoredSpotifyConnection | null {
    const row = this.memoryConnections.get(userId);
    if (!row?.refreshToken) return null;
    return generation === undefined || (row.generation ?? 0) === generation ? row : null;
  }

  public async disconnect(userId: string): Promise<void> {
    if (this.gateway) await this.gateway.mutation('spotify:disconnect', { userId });
    const connection = this.memoryConnections.get(userId);
    if (connection) {
      const { accessToken: _accessToken, accessExpiresAt: _accessExpiresAt, ...rest } = connection;
      this.memoryConnections.set(userId, { ...rest, spotifyUserId: '', refreshToken: '', dailyEnabled: false, generation: (connection.generation ?? 0) + 1 });
    }
    for (const [key, row] of this.memoryPlaylists) if (row.userId === userId) this.memoryPlaylists.delete(key);
    for (const [key] of this.memoryReceipts) if (key.startsWith(`${userId}:`)) this.memoryReceipts.delete(key);
  }

  public async playlists(userId: string): Promise<StoredSpotifyPlaylist[]> {
    if (!this.gateway) return [...this.memoryPlaylists.values()].filter(row => row.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
    const raw = await this.gateway.query('spotify:listPlaylists', { userId });
    return Array.isArray(raw) ? raw.map(parsePlaylist).filter((row): row is StoredSpotifyPlaylist => row !== null) : [];
  }

  /** Enabled playlists this run (named by its start time) has not reached yet, least recently checked first. */
  public async dailyPlaylists(userId: string, runStartedAt: number, limit: number): Promise<StoredSpotifyPlaylist[]> {
    if (this.gateway) {
      const raw = await this.gateway.query('spotify:dailyPlaylists', { userId, runStartedAt, limit });
      return Array.isArray(raw) ? raw.map(parsePlaylist).filter((row): row is StoredSpotifyPlaylist => row !== null) : [];
    }
    return [...this.memoryPlaylists.values()]
      .filter(row => row.userId === userId && row.enabled && (row.dailyCheckedAt ?? -1) < runStartedAt)
      .sort((a, b) => (a.dailyCheckedAt ?? -1) - (b.dailyCheckedAt ?? -1)).slice(0, limit);
  }

  public async markDailyChecked(userId: string, playlistId: string, runStartedAt: number, generation: number | undefined): Promise<boolean> {
    if (this.gateway) return await this.gateway.mutation('spotify:markDailyChecked', { userId, playlistId, runStartedAt, ...(generation !== undefined ? { generation } : {}) }) === true;
    if (!this.memoryLive(userId, generation)) return false;
    const key = playlistKey(userId, playlistId); const row = this.memoryPlaylists.get(key); if (!row) return false;
    if ((row.dailyCheckedAt ?? -1) < runStartedAt) this.memoryPlaylists.set(key, { ...row, dailyCheckedAt: runStartedAt });
    return true;
  }

  public async savePlaylist(row: Omit<StoredSpotifyPlaylist, 'offset'|'scanSnapshotId'|'scanTotal'|'added'|'skipped'|'reviewNeeded'>, generation?: number): Promise<boolean> {
    if (this.gateway) return await this.gateway.mutation('spotify:savePlaylist', { ...row, ...(generation !== undefined ? { generation } : {}) }) === true;
    if (!this.memoryLive(row.userId, generation)) return false;
    const key = playlistKey(row.userId, row.playlistId); const previous = this.memoryPlaylists.get(key);
    this.memoryPlaylists.set(key, { ...row, offset: previous?.offset ?? 0, scanSnapshotId: previous?.scanSnapshotId ?? row.snapshotId, scanTotal: previous?.scanTotal ?? row.total, added: previous?.added ?? 0, skipped: previous?.skipped ?? 0, reviewNeeded: previous?.reviewNeeded ?? 0, ...(previous?.lastSyncedAt !== undefined ? { lastSyncedAt: previous.lastSyncedAt } : {}), ...(previous?.dailyCheckedAt !== undefined ? { dailyCheckedAt: previous.dailyCheckedAt } : {}), ...(previous?.leaseUntil !== undefined && previous.leaseToken ? { leaseUntil: previous.leaseUntil, leaseToken: previous.leaseToken } : {}) });
    return true;
  }

  public async claim(userId: string, playlistId: string, token: string, now: number, leaseMs = 60_000, generation?: number): Promise<StoredSpotifyPlaylist | null> {
    if (this.gateway) return parsePlaylist(await this.gateway.mutation('spotify:claimPlaylist', { userId, playlistId, token, now, leaseMs, ...(generation !== undefined ? { generation } : {}) }));
    if (!this.memoryLive(userId, generation)) return null;
    const key = playlistKey(userId, playlistId); const row = this.memoryPlaylists.get(key);
    if (!row || (row.leaseUntil ?? 0) > now) return null;
    const claimed = { ...row, leaseToken: token, leaseUntil: now + leaseMs }; this.memoryPlaylists.set(key, claimed); return claimed;
  }

  public async release(userId: string, playlistId: string, token: string): Promise<void> {
    if (this.gateway) { await this.gateway.mutation('spotify:releasePlaylist', { userId, playlistId, token }); return; }
    const key = playlistKey(userId, playlistId); const row = this.memoryPlaylists.get(key);
    if (row?.leaseToken === token) this.memoryPlaylists.set(key, withoutLease(row));
  }

  public async receipts(userId: string, playlistId: string, trackIds: readonly string[]): Promise<Set<string>> {
    if (this.gateway) {
      const raw = await this.gateway.query('spotify:receipts', { userId, playlistId, trackIds: trackIds.slice(0, 50) });
      return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
    }
    const known = this.memoryReceipts.get(playlistKey(userId, playlistId)) ?? new Set(); return new Set(trackIds.filter(id => known.has(id)));
  }

  public async checkpoint(userId: string, playlistId: string, token: string, value: SpotifyCheckpoint, generation?: number): Promise<boolean> {
    const now = Date.now();
    if (this.gateway) return await this.gateway.mutation('spotify:checkpoint', { userId, playlistId, token, ...value, now, ...(generation !== undefined ? { generation } : {}) }) === true;
    if (!this.memoryLive(userId, generation)) return false;
    const key = playlistKey(userId, playlistId); const row = this.memoryPlaylists.get(key);
    if (!row || row.leaseToken !== token || (row.leaseUntil ?? 0) <= now) return false;
    const ids = this.memoryReceipts.get(key) ?? new Set<string>(); for (const receipt of value.receipts) ids.add(receipt.trackId); this.memoryReceipts.set(key, ids);
    this.memoryPlaylists.set(key, { ...withoutLease(row), offset: value.complete ? 0 : value.offset, scanSnapshotId: value.snapshotId, scanTotal: value.total, added: value.complete ? 0 : value.added, skipped: value.complete ? 0 : value.skipped, reviewNeeded: value.complete ? 0 : value.reviewNeeded, ...(value.complete ? { lastSyncedAt: now } : {}), updatedAt: now });
    return true;
  }


  private seal(plain: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  private open(value: string): string {
    const [version, ivText, tagText, dataText] = value.split('.');
    if (version !== 'v1' || !ivText || !tagText || !dataText) throw new Error('Invalid ciphertext.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
  }
}

function withoutLease(row: StoredSpotifyPlaylist): StoredSpotifyPlaylist {
  const copy = { ...row }; delete copy.leaseToken; delete copy.leaseUntil; return copy;
}
function playlistKey(userId: string, playlistId: string): string { return `${userId}:${playlistId}`; }
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function parsePlaylist(value: unknown): StoredSpotifyPlaylist | null {
  const r = record(value); if (!r || typeof r.userId !== 'string' || typeof r.playlistId !== 'string' || typeof r.name !== 'string' || typeof r.libraryId !== 'string') return null;
  return { userId: r.userId, playlistId: r.playlistId, name: r.name, libraryId: r.libraryId, snapshotId: typeof r.snapshotId === 'string' ? r.snapshotId : '', total: number(r.total) ?? 0, offset: number(r.offset) ?? 0, scanSnapshotId: typeof r.scanSnapshotId === 'string' ? r.scanSnapshotId : '', scanTotal: number(r.scanTotal) ?? 0, added: number(r.added) ?? 0, skipped: number(r.skipped) ?? 0, reviewNeeded: number(r.reviewNeeded) ?? 0, ...(number(r.lastSyncedAt) !== undefined ? { lastSyncedAt: number(r.lastSyncedAt)! } : {}), ...(number(r.leaseUntil) !== undefined ? { leaseUntil: number(r.leaseUntil)! } : {}), ...(typeof r.leaseToken === 'string' ? { leaseToken: r.leaseToken } : {}), enabled: r.enabled === true, updatedAt: number(r.updatedAt) ?? 0, ...(number(r.dailyCheckedAt) !== undefined ? { dailyCheckedAt: number(r.dailyCheckedAt)! } : {}) };
}
