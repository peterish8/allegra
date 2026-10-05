import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { ConvexGateway } from './convexGateway.js';

export interface StoredSpotifyConnection { userId: string; spotifyUserId: string; refreshToken: string; accessToken?: string; accessExpiresAt?: number; dailyEnabled: boolean; connectedAt: number; updatedAt: number }
export interface StoredSpotifyPlaylist { userId: string; playlistId: string; name: string; snapshotId: string; total: number; libraryId: string; offset: number; scanSnapshotId: string; scanTotal: number; added: number; skipped: number; reviewNeeded: number; lastSyncedAt?: number; leaseUntil?: number; leaseToken?: string; enabled: boolean; updatedAt: number }
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
      return { userId: row.userId, spotifyUserId: row.spotifyUserId, refreshToken: this.open(row.encryptedRefreshToken), ...(typeof row.encryptedAccessToken === 'string' ? { accessToken: this.open(row.encryptedAccessToken) } : {}), ...(typeof row.accessExpiresAt === 'number' ? { accessExpiresAt: row.accessExpiresAt } : {}), dailyEnabled: row.dailyEnabled === true, connectedAt: number(row.connectedAt) ?? Date.now(), updatedAt: number(row.updatedAt) ?? Date.now() };
    } catch { return null; }
  }

  public async saveConnection(value: StoredSpotifyConnection): Promise<void> {
    if (this.gateway) {
      await this.gateway.mutation('spotify:saveConnection', { userId: value.userId, spotifyUserId: value.spotifyUserId, encryptedRefreshToken: this.seal(value.refreshToken), ...(value.accessToken ? { encryptedAccessToken: this.seal(value.accessToken) } : {}), ...(value.accessExpiresAt !== undefined ? { accessExpiresAt: value.accessExpiresAt } : {}), dailyEnabled: value.dailyEnabled, connectedAt: value.connectedAt, updatedAt: value.updatedAt });
    } else this.memoryConnections.set(value.userId, value);
  }

  public async setDaily(userId: string, enabled: boolean): Promise<boolean> {
    if (this.gateway) return await this.gateway.mutation('spotify:setDaily', { userId, enabled, updatedAt: Date.now() }) === true;
    const row = this.memoryConnections.get(userId); if (!row) return false;
    this.memoryConnections.set(userId, { ...row, dailyEnabled: enabled, updatedAt: Date.now() }); return true;
  }

  public async disconnect(userId: string): Promise<void> {
    if (this.gateway) await this.gateway.mutation('spotify:disconnect', { userId });
    this.memoryConnections.delete(userId);
    for (const [key, row] of this.memoryPlaylists) if (row.userId === userId) this.memoryPlaylists.delete(key);
    for (const [key] of this.memoryReceipts) if (key.startsWith(`${userId}:`)) this.memoryReceipts.delete(key);
  }

  public async playlists(userId: string): Promise<StoredSpotifyPlaylist[]> {
    if (!this.gateway) return [...this.memoryPlaylists.values()].filter(row => row.userId === userId);
    const raw = await this.gateway.query('spotify:listPlaylists', { userId });
    return Array.isArray(raw) ? raw.map(parsePlaylist).filter((row): row is StoredSpotifyPlaylist => row !== null) : [];
  }

  public async savePlaylist(row: Omit<StoredSpotifyPlaylist, 'offset'|'scanSnapshotId'|'scanTotal'|'added'|'skipped'|'reviewNeeded'>): Promise<void> {
    if (this.gateway) { await this.gateway.mutation('spotify:savePlaylist', row); return; }
    const key = playlistKey(row.userId, row.playlistId); const previous = this.memoryPlaylists.get(key);
    this.memoryPlaylists.set(key, { ...row, offset: previous?.offset ?? 0, scanSnapshotId: previous?.scanSnapshotId ?? row.snapshotId, scanTotal: previous?.scanTotal ?? row.total, added: previous?.added ?? 0, skipped: previous?.skipped ?? 0, reviewNeeded: previous?.reviewNeeded ?? 0, ...(previous?.lastSyncedAt !== undefined ? { lastSyncedAt: previous.lastSyncedAt } : {}) });
  }

  public async claim(userId: string, playlistId: string, token: string, now: number, leaseMs = 60_000): Promise<StoredSpotifyPlaylist | null> {
    if (this.gateway) return parsePlaylist(await this.gateway.mutation('spotify:claimPlaylist', { userId, playlistId, token, now, leaseMs }));
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

  public async checkpoint(userId: string, playlistId: string, token: string, value: SpotifyCheckpoint): Promise<boolean> {
    const now = Date.now();
    if (this.gateway) return await this.gateway.mutation('spotify:checkpoint', { userId, playlistId, token, ...value, now }) === true;
    const key = playlistKey(userId, playlistId); const row = this.memoryPlaylists.get(key);
    if (!row || row.leaseToken !== token || (row.leaseUntil ?? 0) <= now) return false;
    const ids = this.memoryReceipts.get(key) ?? new Set<string>(); for (const receipt of value.receipts) ids.add(receipt.trackId); this.memoryReceipts.set(key, ids);
    this.memoryPlaylists.set(key, { ...withoutLease(row), offset: value.complete ? 0 : value.offset, scanSnapshotId: value.snapshotId, scanTotal: value.total, added: value.complete ? 0 : value.added, skipped: value.complete ? 0 : value.skipped, reviewNeeded: value.complete ? 0 : value.reviewNeeded, ...(value.complete ? { lastSyncedAt: now } : {}), updatedAt: now });
    return true;
  }

  public async dailyAccounts(): Promise<string[]> {
    if (!this.gateway) return [...this.memoryConnections.values()].filter(row => row.dailyEnabled).map(row => row.userId).slice(0, 100);
    const raw = await this.gateway.query('spotify:dailyAccounts'); return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
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
  return { userId: r.userId, playlistId: r.playlistId, name: r.name, libraryId: r.libraryId, snapshotId: typeof r.snapshotId === 'string' ? r.snapshotId : '', total: number(r.total) ?? 0, offset: number(r.offset) ?? 0, scanSnapshotId: typeof r.scanSnapshotId === 'string' ? r.scanSnapshotId : '', scanTotal: number(r.scanTotal) ?? 0, added: number(r.added) ?? 0, skipped: number(r.skipped) ?? 0, reviewNeeded: number(r.reviewNeeded) ?? 0, ...(number(r.lastSyncedAt) !== undefined ? { lastSyncedAt: number(r.lastSyncedAt)! } : {}), ...(number(r.leaseUntil) !== undefined ? { leaseUntil: number(r.leaseUntil)! } : {}), ...(typeof r.leaseToken === 'string' ? { leaseToken: r.leaseToken } : {}), enabled: r.enabled === true, updatedAt: number(r.updatedAt) ?? 0 };
}
