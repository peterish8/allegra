/**
 * The library seam: likes and playlists change only through here, as operations
 * (packages/shared/library.ts, copied to src/shared by `npm run sync:shared`).
 *
 * Every writer — the web's routes, the phone's sync, the MCP tools, sharing, the
 * guest-to-account merge — goes through `apply`, so each change lands atomically and
 * the newest change per item wins wherever it came from. The profile's
 * likedSongIds/libraries remain the read model: the store rebuilds them after each batch.
 *
 * Adapters: ConvexLibraryStore (db/convexLibrary.ts) and MemoryLibraryStore (tests and
 * local development without Convex).
 */
import {
  applyLibraryOps,
  isTombstone,
  itemKey,
  pageOfChanges,
  seedFromProfile,
  toProfileLibrary,
  type LibraryChange,
  type LibraryOp,
  type LibraryOrigin,
  type LikeRow,
  type PlaylistItemRow,
  type PlaylistRow,
  type RejectReason
} from '../shared/library.js';
import type { SongRef, SongSnapshot } from '../shared/songRef.js';
import type { LibraryRecord, MemoryUserStore } from './store.js';

export interface LibraryApplyResult {
  readonly rev: number;
  readonly rejected: readonly { readonly index: number; readonly reason: RejectReason }[];
  /** Indexes of valid operations that lost to a newer change already stored. */
  readonly superseded: readonly number[];
  /** How many operations changed something; each took one revision. */
  readonly applied: number;
  readonly appliedIndexes: readonly number[];
  /** Playlist covers nothing uses any more; the caller deletes the images. */
  readonly removedCoverKeys: readonly string[];
}

export interface LibraryPage {
  /** Ask for changes after this next time. */
  readonly rev: number;
  readonly changes: readonly LibraryChange[];
  readonly more: boolean;
  /** The cursor predates a pruned removal; the changes start at the first live row. */
  readonly resync?: true;
}

/** One current like or playlist song, as Blend reads them (newest first). */
export interface LibraryEntry {
  readonly ref: SongRef;
  readonly song?: SongSnapshot;
  /** 'import' for an imported like, or a song in an imported playlist. */
  readonly origin?: LibraryOrigin;
  /** When it was liked or added (ms). */
  readonly at: number;
}

export interface LibraryStore {
  /** Throws when the listener has no profile. */
  apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult>;
  /**
   * Everything after revision `since`. From 0 the caller has nothing, so it gets what is in the
   * library now and no remembered deletes; `rev` and `more` page through it as usual.
   */
  changes(userId: string, since: number, limit: number, resyncContinuation?: boolean): Promise<LibraryPage>;
  /** The newest current likes, at most min(limit, 1000). Empty for a listener with no library. */
  recentLikes(userId: string, limit: number): Promise<readonly LibraryEntry[]>;
  /** The newest songs across playlists, at most min(limit, 300). */
  recentItems(userId: string, limit: number): Promise<readonly LibraryEntry[]>;
  /**
   * Drops this listener's rows after their account was erased. Only a store that keeps rows
   * apart from the profile store needs it: in Convex, erasing the account removes them.
   */
  forget?(userId: string): void;
}

interface Rows {
  likes: Map<SongRef, LikeRow>;
  playlists: Map<string, PlaylistRow>;
  items: Map<string, PlaylistItemRow>;
  rev: number;
  prunedRev: number;
}

export class MemoryLibraryStore implements LibraryStore {
  private readonly rows = new Map<string, Rows>();

  public constructor(
    private readonly users: MemoryUserStore,
    private readonly now: () => number = Date.now
  ) {}

  public async apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult> {
    const rows = await this.rowsFor(userId);
    const write = applyLibraryOps(
      {
        like: (ref) => rows.likes.get(ref),
        playlist: (id) => rows.playlists.get(id),
        item: (id, ref) => rows.items.get(itemKey(id, ref))
      },
      ops,
      { now: this.now(), rev: rows.rev }
    );
    write.likes.forEach((row) => rows.likes.set(row.ref, row));
    write.playlists.forEach((row) => rows.playlists.set(row.playlistId, row));
    write.items.forEach((row) => rows.items.set(itemKey(row.playlistId, row.ref), row));
    rows.rev = write.rev;
    const copy = toProfileLibrary([...rows.likes.values()], [...rows.playlists.values()], [...rows.items.values()]);
    this.users.writeLibraryCopy(userId, { likedSongIds: copy.likedSongIds, libraries: copy.libraries as LibraryRecord[] });
    return { rev: write.rev, rejected: write.rejected, superseded: write.superseded, applied: write.applied, appliedIndexes: write.appliedIndexes, removedCoverKeys: write.removedCoverKeys };
  }

  public async changes(userId: string, since: number, limit: number, resyncContinuation = false): Promise<LibraryPage> {
    const rows = await this.rowsFor(userId);
    const staleCursor = since > 0 && since < rows.prunedRev;
    const resync = staleCursor || resyncContinuation;
    const effectiveSince = staleCursor && !resyncContinuation ? 0 : since;
    const after = <T extends { rev: number }>(list: Iterable<T>) => [...list].filter((row) => row.rev > effectiveSince).sort((a, b) => a.rev - b.rev).slice(0, limit);
    const page = pageOfChanges([after(rows.likes.values()), after(rows.playlists.values()), after(rows.items.values())], limit, rows.rev);
    // The cursor moves past the deletes it leaves out, so the next page starts after them.
    const changes = effectiveSince === 0 || resyncContinuation ? page.changes.filter((change) => !isTombstone(change)) : page.changes;
    return { rev: page.next, changes, more: page.more, ...(resync ? { resync: true as const } : {}) };
  }

  public async recentLikes(userId: string, limit: number): Promise<readonly LibraryEntry[]> {
    const rows = await this.rowsIfAny(userId);
    if (!rows) return [];
    return [...rows.likes.values()]
      .filter((row) => row.liked)
      .sort((a, b) => b.likedAt - a.likedAt || b.rev - a.rev)
      .slice(0, Math.max(0, Math.min(1000, limit)))
      .map((row) => ({ ref: row.ref, ...(row.song ? { song: row.song } : {}), ...(row.origin ? { origin: row.origin } : {}), at: row.likedAt }));
  }

  public async recentItems(userId: string, limit: number): Promise<readonly LibraryEntry[]> {
    const rows = await this.rowsIfAny(userId);
    if (!rows) return [];
    return [...rows.items.values()]
      .filter((row) => !row.deleted)
      .sort((a, b) => b.addedAt - a.addedAt || b.rev - a.rev)
      .slice(0, Math.max(0, Math.min(300, limit)))
      .map((row) => ({
        ref: row.ref,
        ...(row.song ? { song: row.song } : {}),
        ...(rows.playlists.get(row.playlistId)?.origin === 'import' ? { origin: 'import' as const } : {}),
        at: row.addedAt
      }));
  }

  /** Memory-store counterpart of the daily Convex tombstone sweep. */
  public pruneTombstones(cutoff: number): number {
    let pruned = 0;
    for (const rows of this.rows.values()) {
      const remove = <K, T extends { readonly updatedAt: number; readonly rev: number }>(
        source: Map<K, T>,
        tombstone: (row: T) => boolean
      ) => {
        for (const [key, row] of source) {
          if (!tombstone(row) || row.updatedAt >= cutoff) continue;
          source.delete(key);
          rows.prunedRev = Math.max(rows.prunedRev, row.rev);
          pruned += 1;
        }
      };
      remove(rows.likes, (row) => !row.liked);
      remove(rows.playlists, (row) => row.deleted);
      remove(rows.items, (row) => row.deleted);
    }
    return pruned;
  }

  public forget(userId: string): void {
    this.rows.delete(userId);
  }

  /** Rows for a listener with a profile; null for one without (nothing to read). */
  private async rowsIfAny(userId: string): Promise<Rows | null> {
    if (!this.rows.has(userId) && !(await this.users.get(userId))) return null;
    return this.rowsFor(userId);
  }

  /** A listener's rows, seeded from their profile the first time (as Convex does). */
  private async rowsFor(userId: string): Promise<Rows> {
    const existing = this.rows.get(userId);
    if (existing) return existing;
    const user = await this.users.get(userId);
    if (!user) throw new Error('No profile');
    const seed = seedFromProfile(user);
    const rows: Rows = {
      likes: new Map(seed.likes.map((row) => [row.ref, row])),
      playlists: new Map(seed.playlists.map((row) => [row.playlistId, row])),
      items: new Map(seed.items.map((row) => [itemKey(row.playlistId, row.ref), row])),
      rev: seed.rev,
      prunedRev: 0
    };
    this.rows.set(userId, rows);
    this.users.ownLibrary(userId);
    return rows;
  }
}
