/**
 * SQLite for library sync (services/sync/LibrarySync.ts). These write the phone's
 * library directly — never through the stores — so applying a change that came from
 * the account does not queue it to be sent back.
 *
 * Every write here answers whether a row really changed, so a pull can say exactly
 * what the screens need to reload (`LibraryChangeSummary`) and a replayed pull says
 * "nothing".
 */
import type { SQLiteDatabase as Db } from 'expo-sqlite';

import { withDbRead, withDbWrite } from './db';

/** A song that is only online (not downloaded): liked, or in a playlist. Duration in seconds; `at` in ms. */
export interface OnlineSongRow {
  readonly ref: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly artwork?: string;
  readonly duration: number;
  readonly at: number;
}

interface OnlineRowDb {
  ref: string;
  title: string;
  artist: string | null;
  album: string | null;
  artwork: string | null;
  duration: number;
  at: number;
}

const fromDb = (row: OnlineRowDb): OnlineSongRow => ({
  ref: row.ref,
  title: row.title,
  ...(row.artist ? { artist: row.artist } : {}),
  ...(row.album ? { album: row.album } : {}),
  ...(row.artwork ? { artwork: row.artwork } : {}),
  duration: row.duration ?? 0,
  at: row.at,
});

/** True when the statement inserted, updated or deleted a row. */
const changed = (result: { changes?: number }): boolean => (result.changes ?? 0) > 0;

/** One transaction on the write queue: all of `work` lands, or none of it. */
const inTransaction = <T>(work: (db: Db) => Promise<T>): Promise<T> =>
  withDbWrite(async db => {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const result = await work(db);
      await db.execAsync('COMMIT');
      return result;
    } catch (error) {
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });

// ── Online likes ────────────────────────────────────────────────────────────

export const getOnlineLikes = (): Promise<OnlineSongRow[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<OnlineRowDb>(
      'SELECT ref, title, artist, album, artwork, duration, liked_at AS at FROM liked_online_songs ORDER BY liked_at DESC',
    )).map(fromDb),
  );

const upsertOnlineLikeIn = async (db: Db, row: OnlineSongRow): Promise<boolean> =>
  changed(await db.runAsync(
    `INSERT INTO liked_online_songs (ref, title, artist, album, artwork, duration, liked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ref) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album,
       artwork = excluded.artwork, duration = excluded.duration
     WHERE liked_online_songs.title IS NOT excluded.title OR liked_online_songs.artist IS NOT excluded.artist
       OR liked_online_songs.album IS NOT excluded.album OR liked_online_songs.artwork IS NOT excluded.artwork
       OR liked_online_songs.duration IS NOT excluded.duration`,
    [row.ref, row.title, row.artist ?? null, row.album ?? null, row.artwork ?? null, row.duration, row.at],
  ));

const removeOnlineLikeIn = async (db: Db, ref: string): Promise<boolean> =>
  changed(await db.runAsync('DELETE FROM liked_online_songs WHERE ref = ?', [ref]));

export const upsertOnlineLike = (row: OnlineSongRow): Promise<void> =>
  withDbWrite(async db => {
    await upsertOnlineLikeIn(db, row);
  });

export const removeOnlineLike = (ref: string): Promise<void> =>
  withDbWrite(async db => {
    await removeOnlineLikeIn(db, ref);
  });

// ── Online playlist songs ───────────────────────────────────────────────────

export const getOnlinePlaylistSongs = (playlistId: string): Promise<OnlineSongRow[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<OnlineRowDb>(
      'SELECT ref, title, artist, album, artwork, duration, added_at AS at FROM playlist_online_songs WHERE playlist_id = ? ORDER BY added_at ASC',
      [playlistId],
    )).map(fromDb),
  );

const upsertOnlinePlaylistSongIn = async (db: Db, playlistId: string, row: OnlineSongRow): Promise<boolean> =>
  changed(await db.runAsync(
    `INSERT INTO playlist_online_songs (playlist_id, ref, title, artist, album, artwork, duration, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id, ref) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album,
       artwork = excluded.artwork, duration = excluded.duration
     WHERE playlist_online_songs.title IS NOT excluded.title OR playlist_online_songs.artist IS NOT excluded.artist
       OR playlist_online_songs.album IS NOT excluded.album OR playlist_online_songs.artwork IS NOT excluded.artwork
       OR playlist_online_songs.duration IS NOT excluded.duration`,
    [playlistId, row.ref, row.title, row.artist ?? null, row.album ?? null, row.artwork ?? null, row.duration, row.at],
  ));

const removeOnlinePlaylistSongIn = async (db: Db, playlistId: string, ref: string): Promise<boolean> =>
  changed(await db.runAsync('DELETE FROM playlist_online_songs WHERE playlist_id = ? AND ref = ?', [playlistId, ref]));

export const upsertOnlinePlaylistSong = (playlistId: string, row: OnlineSongRow): Promise<void> =>
  withDbWrite(async db => {
    await upsertOnlinePlaylistSongIn(db, playlistId, row);
  });

export const removeOnlinePlaylistSong = (playlistId: string, ref: string): Promise<void> =>
  withDbWrite(async db => {
    await removeOnlinePlaylistSongIn(db, playlistId, ref);
  });

// ── The phone library, as sync sees it ──────────────────────────────────────

export interface LocalSongRow {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly duration: number;
  readonly coverImageUri?: string;
  readonly originId?: string;
  readonly coverRemoteUri?: string;
}

export const getLocalSongs = (): Promise<LocalSongRow[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<{ id: string; title: string; artist: string | null; album: string | null; duration: number; cover_image_uri: string | null; origin_id: string | null; cover_remote_uri: string | null }>(
      'SELECT id, title, artist, album, duration, cover_image_uri, origin_id, cover_remote_uri FROM songs',
    )).map(row => ({
      id: row.id,
      title: row.title,
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.album ? { album: row.album } : {}),
      duration: row.duration ?? 0,
      ...(row.cover_image_uri ? { coverImageUri: row.cover_image_uri } : {}),
      ...(row.origin_id ? { originId: row.origin_id } : {}),
      ...(row.cover_remote_uri ? { coverRemoteUri: row.cover_remote_uri } : {}),
    })),
  );

/** Playlist ids and names (the default Liked songs one included), with their song rows in order. */
export const getLocalPlaylists = (): Promise<{ id: string; name: string; description?: string; isDefault: boolean; songIds: string[] }[]> =>
  withDbRead(async db => {
    const lists = await db.getAllAsync<{ id: string; name: string; description: string | null; is_default: number }>(
      'SELECT id, name, description, is_default FROM playlists ORDER BY sort_order ASC, date_created ASC',
    );
    const items = await db.getAllAsync<{ playlist_id: string; song_id: string }>(
      'SELECT playlist_id, song_id FROM playlist_songs ORDER BY sort_order ASC, added_at ASC',
    );
    return lists.map(list => ({
      id: list.id,
      name: list.name,
      ...(list.description ? { description: list.description } : {}),
      isDefault: list.is_default === 1,
      songIds: items.filter(item => item.playlist_id === list.id).map(item => item.song_id),
    }));
  });

/** The playlists a synced song can belong to: everything but Liked songs. */
export const getSyncedPlaylistIds = (): Promise<string[]> =>
  withDbRead(async db => (await db.getAllAsync<{ id: string }>('SELECT id FROM playlists WHERE is_default = 0')).map(row => row.id));

const setOriginIdIn = async (db: Db, songId: string, ref: string): Promise<boolean> =>
  changed(await db.runAsync('UPDATE songs SET origin_id = ? WHERE id = ? AND origin_id IS NULL', [ref, songId]));

export const setOriginId = (songId: string, ref: string): Promise<void> =>
  withDbWrite(async db => {
    await setOriginIdIn(db, songId, ref);
  });

/** The catalog's https cover for a song that has none recorded yet (Connect sends it; see db.ts). */
export const setCoverRemoteUri = (songId: string, url: string): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync(
      "UPDATE songs SET cover_remote_uri = ? WHERE id = ? AND (cover_remote_uri IS NULL OR cover_remote_uri = '')",
      [url, songId],
    );
  });

/** A song on this phone that another device could not yet find, or could not show a cover for. */
export interface CatalogGap {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly originId?: string;
  readonly coverImageUri?: string;
}

/**
 * Songs with no catalog origin, or with only a cover file that never leaves the phone, that the
 * catalog has not been asked about since `checkedBefore` (ms). Recently played songs first: they
 * are the ones most likely to be picked for another device.
 */
export const songsMissingCatalogLinks = (limit: number, checkedBefore: number): Promise<CatalogGap[]> =>
  withDbRead(async db => {
    const rows = await db.getAllAsync<{
      id: string;
      title: string;
      artist: string | null;
      origin_id: string | null;
      cover_image_uri: string | null;
    }>(
      `SELECT id, title, artist, origin_id, cover_image_uri FROM songs
       WHERE is_hidden = 0 AND title <> ''
         AND (origin_id IS NULL
              OR ((cover_remote_uri IS NULL OR cover_remote_uri = '')
                  AND (cover_image_uri IS NULL OR cover_image_uri NOT LIKE 'https://%')))
         AND (catalog_checked_at IS NULL OR catalog_checked_at < ?)
       ORDER BY (last_played IS NULL), last_played DESC, date_created DESC
       LIMIT ?`,
      [checkedBefore, limit],
    );
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.origin_id ? { originId: row.origin_id } : {}),
      ...(row.cover_image_uri ? { coverImageUri: row.cover_image_uri } : {}),
    }));
  });

/** Remember that the catalog was asked about this song, found or not. */
export const markCatalogChecked = (songId: string, at: number): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('UPDATE songs SET catalog_checked_at = ? WHERE id = ?', [at, songId]);
  });

const upsertPlaylistIn = async (db: Db, id: string, name: string, description: string | undefined, createdAt: number): Promise<boolean> =>
  changed(await db.runAsync(
    `INSERT INTO playlists (id, name, description, is_default, sort_order, date_created, date_modified)
     VALUES (?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, date_modified = excluded.date_modified
     WHERE playlists.is_default = 0 AND (playlists.name IS NOT excluded.name OR playlists.description IS NOT excluded.description)`,
    [id, name, description ?? null, new Date(createdAt).toISOString(), new Date().toISOString()],
  ));

const deletePlaylistIn = async (db: Db, id: string): Promise<boolean> =>
  changed(await db.runAsync('DELETE FROM playlists WHERE id = ? AND is_default = 0', [id]));

/** Creates or renames a playlist with the account's id. Never touches the Liked songs one. */
export const upsertPlaylistRaw = (id: string, name: string, description: string | undefined, createdAt: number): Promise<void> =>
  withDbWrite(async db => {
    await upsertPlaylistIn(db, id, name, description, createdAt);
  });

export const deletePlaylistRaw = (id: string): Promise<void> =>
  withDbWrite(async db => {
    await deletePlaylistIn(db, id);
  });

interface MembershipChange {
  /** The song joined or left the playlist. */
  readonly membership: boolean;
  /** The song's own row changed (`is_liked`, for the Liked songs playlist). */
  readonly song: boolean;
}

const setMembershipIn = async (db: Db, playlistId: string, songId: string, present: boolean): Promise<MembershipChange> => {
  const now = new Date().toISOString();
  const membership = changed(present
    ? await db.runAsync(
        `INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, added_at, sort_order)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM playlist_songs WHERE playlist_id = ?))`,
        [playlistId, songId, now, playlistId],
      )
    : await db.runAsync('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?', [playlistId, songId]));
  const isDefault = await db.getFirstAsync<{ is_default: number }>('SELECT is_default FROM playlists WHERE id = ?', [playlistId]);
  const liked = present ? 1 : 0;
  const song = isDefault?.is_default === 1
    && changed(await db.runAsync('UPDATE songs SET is_liked = ? WHERE id = ? AND COALESCE(is_liked, 0) <> ?', [liked, songId, liked]));
  if (membership) await db.runAsync('UPDATE playlists SET date_modified = ? WHERE id = ?', [now, playlistId]);
  return { membership, song };
};

/** Adds a song row to a playlist at the end (or removes it). The Liked songs playlist also keeps songs.is_liked in step. */
export const setPlaylistMembership = (playlistId: string, songId: string, present: boolean): Promise<void> =>
  withDbWrite(async db => {
    await setMembershipIn(db, playlistId, songId, present);
  });

// ── Changes from the account, applied in one transaction ────────────────────

/** One row-level change a pull asks for, with the song's details already in hand. */
export type InboundWrite =
  /** Like or unlike a downloaded song: its membership of the Liked songs playlist. */
  | { readonly kind: 'like_local'; readonly playlistId: string; readonly songId: string; readonly ref: string; readonly liked: boolean }
  | { readonly kind: 'online_like'; readonly row: OnlineSongRow }
  | { readonly kind: 'online_unlike'; readonly ref: string }
  | { readonly kind: 'playlist_upsert'; readonly playlistId: string; readonly name: string; readonly description?: string; readonly createdAt: number }
  | { readonly kind: 'playlist_delete'; readonly playlistId: string }
  | { readonly kind: 'playlist_local'; readonly playlistId: string; readonly songId: string; readonly ref: string; readonly present: boolean }
  | { readonly kind: 'playlist_online'; readonly playlistId: string; readonly row: OnlineSongRow }
  | { readonly kind: 'playlist_online_remove'; readonly playlistId: string; readonly ref: string };

/**
 * What a commit really changed, by table. Empty lists throughout mean every row was
 * already as the account has it (a replayed or unchanged pull): nothing to reload.
 */
export interface LibraryChangeSummary {
  /** `liked_online_songs`: online-only likes added, removed or re-described. */
  readonly likedOnlineRefs: readonly string[];
  /** Liked songs membership of downloaded songs (their refs). */
  readonly likedLocalRefs: readonly string[];
  /** `playlists`: created, renamed, re-described or deleted. */
  readonly playlistMetaIds: readonly string[];
  /** `playlist_songs` of a playlist other than Liked songs: downloaded songs added or removed. */
  readonly playlistLocalItemIds: readonly string[];
  /** `playlist_online_songs`: online-only songs added, removed or re-described. */
  readonly playlistOnlineItemIds: readonly string[];
  /** `songs`: rows whose `is_liked` or `origin_id` changed. */
  readonly songIds: readonly string[];
}

export interface InboundCommit {
  readonly userId: string;
  /**
   * The revision cursor these changes were read after. The commit is refused when the phone's
   * cursor is no longer this (someone else moved it). Null skips the check, for writes that do
   * not come from "everything after N".
   */
  readonly cursor: number | null;
  readonly writes: readonly InboundWrite[];
  /** The cursor to store with the rows. Null keeps the place, for a page that is still owed something. */
  readonly advanceTo: number | null;
}

export type InboundResult =
  | {
      readonly status: 'committed';
      readonly summary: LibraryChangeSummary;
      /** Writes SQLite refused. Any of them keeps the cursor where it was. */
      readonly failed: number;
      readonly advanced: boolean;
    }
  /** The phone is bound to another account now, or its cursor moved: nothing was written. */
  | { readonly status: 'stale' };

const ACCOUNT_KEY = 'account';
const STUCK_KEY = 'outbox_stuck_since';
export const cursorKey = (userId: string): string => `rev:${userId}`;
const reconcileKey = (userId: string): string => `reconcile:${userId}`;

const metaIn = async (db: Db, key: string): Promise<string | null> =>
  (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;

const setMetaIn = async (db: Db, key: string, value: string): Promise<void> => {
  await db.runAsync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
};

const cursorIn = async (db: Db, userId: string): Promise<number> => Number((await metaIn(db, cursorKey(userId))) ?? '0') || 0;

interface Tally {
  readonly likedOnlineRefs: Set<string>;
  readonly likedLocalRefs: Set<string>;
  readonly playlistMetaIds: Set<string>;
  readonly playlistLocalItemIds: Set<string>;
  readonly playlistOnlineItemIds: Set<string>;
  readonly songIds: Set<string>;
}

async function applyWrite(db: Db, write: InboundWrite, tally: Tally): Promise<void> {
  switch (write.kind) {
    case 'like_local': {
      const done = await setMembershipIn(db, write.playlistId, write.songId, write.liked);
      if (done.membership) tally.likedLocalRefs.add(write.ref);
      if (done.song) tally.songIds.add(write.songId);
      if (await setOriginIdIn(db, write.songId, write.ref)) tally.songIds.add(write.songId);
      return;
    }
    case 'online_like':
      if (await upsertOnlineLikeIn(db, write.row)) tally.likedOnlineRefs.add(write.row.ref);
      return;
    case 'online_unlike':
      if (await removeOnlineLikeIn(db, write.ref)) tally.likedOnlineRefs.add(write.ref);
      return;
    case 'playlist_upsert':
      if (await upsertPlaylistIn(db, write.playlistId, write.name, write.description, write.createdAt)) tally.playlistMetaIds.add(write.playlistId);
      return;
    case 'playlist_delete':
      if (await deletePlaylistIn(db, write.playlistId)) tally.playlistMetaIds.add(write.playlistId);
      return;
    case 'playlist_local': {
      const done = await setMembershipIn(db, write.playlistId, write.songId, write.present);
      if (done.membership) tally.playlistLocalItemIds.add(write.playlistId);
      if (done.song) tally.songIds.add(write.songId);
      if (write.present && (await setOriginIdIn(db, write.songId, write.ref))) tally.songIds.add(write.songId);
      return;
    }
    case 'playlist_online':
      if (await upsertOnlinePlaylistSongIn(db, write.playlistId, write.row)) tally.playlistOnlineItemIds.add(write.playlistId);
      return;
    case 'playlist_online_remove':
      if (await removeOnlinePlaylistSongIn(db, write.playlistId, write.ref)) tally.playlistOnlineItemIds.add(write.playlistId);
      return;
  }
}

/**
 * Applies changes from the account and moves the revision cursor in one transaction: the
 * rows, the tombstones and the cursor land together or not at all. Refused for a listener
 * this phone is no longer bound to, so one account's rows never land in another's library.
 *
 * A write SQLite refuses (a row it depends on went away) is skipped and counted; the rest
 * still land, and the cursor stays where it was so the next pull brings the page back.
 */
export const commitInbound = (commit: InboundCommit): Promise<InboundResult> =>
  inTransaction(async db => {
    if ((await metaIn(db, ACCOUNT_KEY)) !== commit.userId) return { status: 'stale' };
    if (commit.cursor !== null && (await cursorIn(db, commit.userId)) !== commit.cursor) return { status: 'stale' };
    const tally: Tally = {
      likedOnlineRefs: new Set(),
      likedLocalRefs: new Set(),
      playlistMetaIds: new Set(),
      playlistLocalItemIds: new Set(),
      playlistOnlineItemIds: new Set(),
      songIds: new Set(),
    };
    let failed = 0;
    for (const write of commit.writes) {
      try {
        await applyWrite(db, write, tally);
      } catch {
        failed++;
      }
    }
    const advanced = commit.advanceTo !== null && failed === 0;
    if (advanced) await setMetaIn(db, cursorKey(commit.userId), String(commit.advanceTo));
    return {
      status: 'committed',
      summary: {
        likedOnlineRefs: [...tally.likedOnlineRefs],
        likedLocalRefs: [...tally.likedLocalRefs],
        playlistMetaIds: [...tally.playlistMetaIds],
        playlistLocalItemIds: [...tally.playlistLocalItemIds],
        playlistOnlineItemIds: [...tally.playlistOnlineItemIds],
        songIds: [...tally.songIds],
      },
      failed,
      advanced,
    };
  });

// ── Outbox and cursor ───────────────────────────────────────────────────────

export type OutboxKind = 'op' | 'play';

export interface OutboxEntry {
  readonly id: number;
  readonly kind: OutboxKind;
  readonly body: string;
  readonly createdAt: number;
}

export const enqueueOutbox = (kind: OutboxKind, body: unknown): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('INSERT INTO sync_outbox (kind, body, created_at) VALUES (?, ?, ?)', [kind, JSON.stringify(body), Date.now()]);
  });

export const peekOutbox = (kind: OutboxKind, limit: number): Promise<OutboxEntry[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<{ id: number; kind: OutboxKind; body: string; created_at: number }>(
      'SELECT id, kind, body, created_at FROM sync_outbox WHERE kind = ? ORDER BY id ASC LIMIT ?',
      [kind, limit],
    )).map(row => ({ id: row.id, kind: row.kind, body: row.body, createdAt: row.created_at })),
  );

/** Snapshot every queued entry of one kind without changing or settling it. */
export const readOutbox = (kind: OutboxKind): Promise<OutboxEntry[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<{ id: number; kind: OutboxKind; body: string; created_at: number }>(
      'SELECT id, kind, body, created_at FROM sync_outbox WHERE kind = ? ORDER BY id ASC',
      [kind],
    )).map(row => ({ id: row.id, kind: row.kind, body: row.body, createdAt: row.created_at })),
  );

export const removeOutbox = (ids: readonly number[]): Promise<void> =>
  withDbWrite(async db => {
    for (const id of ids) await db.runAsync('DELETE FROM sync_outbox WHERE id = ?', [id]);
  });

/** Persist progress for a retried event without resending a side effect that already succeeded. */
export const updateOutboxBody = (id: number, body: unknown): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('UPDATE sync_outbox SET body = ? WHERE id = ?', [JSON.stringify(body), id]);
  });

export const clearOutbox = (kind?: OutboxKind): Promise<void> =>
  withDbWrite(async db => {
    if (kind) await db.runAsync('DELETE FROM sync_outbox WHERE kind = ?', [kind]);
    else await db.runAsync('DELETE FROM sync_outbox');
    // Nothing is waiting to be sent any more, so nothing is stuck.
    if (kind !== 'play') await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [STUCK_KEY]);
  });

export interface OutboxSettlement {
  /** The entries the account answered for (accepted, or refused for good). */
  readonly ids: readonly number[];
  readonly userId: string;
  /**
   * Move the cursor over this phone's own writes: only when it still reads `from`, and only
   * for the account this phone is bound to.
   */
  readonly advance?: { readonly from: number; readonly to: number };
  /** Items whose operation lost to newer state on the account; remembered until a pull has put them right. */
  readonly reconcile?: readonly string[];
}

/**
 * What follows the account's answer to a batch, in one transaction: the entries leave the
 * outbox (they are never sent twice), the outbox is no longer stuck, the cursor moves over
 * the phone's own writes when that is safe, and items that lost are remembered.
 */
export const settleOutbox = (settlement: OutboxSettlement): Promise<{ advanced: boolean }> =>
  inTransaction(async db => {
    for (const id of settlement.ids) await db.runAsync('DELETE FROM sync_outbox WHERE id = ?', [id]);
    await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [STUCK_KEY]);
    if ((await metaIn(db, ACCOUNT_KEY)) !== settlement.userId) return { advanced: false };
    if (settlement.reconcile && settlement.reconcile.length > 0) {
      const known = parseKeys(await metaIn(db, reconcileKey(settlement.userId)));
      await setMetaIn(db, reconcileKey(settlement.userId), JSON.stringify([...new Set([...known, ...settlement.reconcile])]));
    }
    const advance = settlement.advance;
    if (!advance || (await cursorIn(db, settlement.userId)) !== advance.from) return { advanced: false };
    await setMetaIn(db, cursorKey(settlement.userId), String(advance.to));
    return { advanced: true };
  });

function parseKeys(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/** Items whose local state lost on the account and has not been put right yet. */
export const getReconcileTargets = (userId: string): Promise<string[]> =>
  withDbRead(async db => parseKeys(await metaIn(db, reconcileKey(userId))));

export const setReconcileTargets = (userId: string, keys: readonly string[]): Promise<void> =>
  withDbWrite(async db => {
    if (keys.length === 0) await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [reconcileKey(userId)]);
    else await setMetaIn(db, reconcileKey(userId), JSON.stringify(keys));
  });

/** Binds this phone's library to an account, starting from the beginning of its change feed. */
export const bindAccount = (userId: string): Promise<void> =>
  inTransaction(async db => {
    await setMetaIn(db, ACCOUNT_KEY, userId);
    await setMetaIn(db, cursorKey(userId), '0');
    await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [reconcileKey(userId)]);
  });

export const getCursor = (userId: string): Promise<number> => withDbRead(db => cursorIn(db, userId));

/**
 * Notes that the outbox could not be delivered, keeping the time of the first failure since
 * the last success. Kept in SQLite so "stuck for a day" survives a restart.
 */
export const markOutboxStuck = (at: number): Promise<number> =>
  withDbWrite(async db => {
    await db.runAsync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [STUCK_KEY, String(at)]);
    return Number(await metaIn(db, STUCK_KEY)) || at;
  });

/** When the outbox first failed to deliver, or null while it is flowing. */
export const getOutboxStuckSince = (): Promise<number | null> =>
  withDbRead(async db => {
    const value = Number(await metaIn(db, STUCK_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  });

export const clearOutboxStuck = (): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [STUCK_KEY]);
  });

export const getMeta = (key: string): Promise<string | null> => withDbRead(db => metaIn(db, key));

export const setMeta = (key: string, value: string): Promise<void> => withDbWrite(db => setMetaIn(db, key, value));
