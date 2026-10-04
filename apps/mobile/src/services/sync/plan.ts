/**
 * What library sync means for the phone, as plain functions (the engine in
 * LibrarySync.ts does the I/O around them).
 *
 * The phone keeps its library the way it always has: downloaded songs are rows in
 * `songs`, likes are membership of the Liked songs playlist, playlists hold rows.
 * A song that exists only online (liked or added on the website, not downloaded
 * here) lives in `liked_online_songs` / `playlist_online_songs` instead: liking is
 * not downloading.
 *
 * Which local row a synced song is: the row that recorded the same catalog song
 * when it was downloaded (`origin_id`), otherwise the row with the same title and
 * lead artist (`matchKey`, for songs downloaded before origins were recorded).
 * Songs with neither — local files, imports — never leave the phone.
 */
import { shareableArtwork } from '@shared/artwork';
import type { LibraryChange, LibraryOp } from '@shared/library';
import { fromMobileId, matchKey, parseSongRef, type SongRef, type SongSnapshot } from '@shared/songRef';

import type { InboundWrite, LibraryChangeSummary, OnlineSongRow } from '../../database/syncQueries';

/** The phone's Liked songs playlist (seeded in database/db.ts); likes are its membership. */
export const LIKED_PLAYLIST_ID = 'default_liked';

export interface LocalSong {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly duration?: number;
  readonly coverImageUri?: string;
  readonly originId?: string;
  /** The catalog's https cover, kept beside a local cover file that never leaves the phone. */
  readonly coverRemoteUri?: string;
}

export interface LocalIndex {
  /** The local row for a synced song, or undefined when it is not on the phone. */
  songFor(ref: SongRef, song?: { readonly title: string; readonly artist: string }): string | undefined;
}

export function buildLocalIndex(songs: readonly LocalSong[]): LocalIndex {
  const byOrigin = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const song of songs) {
    if (song.originId) {
      byOrigin.set(song.originId, song.id);
      continue;
    }
    const key = matchKey(song.title, song.artist);
    if (!byKey.has(key)) byKey.set(key, song.id);
  }
  return {
    songFor: (ref, song) => byOrigin.get(ref) ?? (song ? byKey.get(matchKey(song.title, song.artist)) : undefined),
  };
}

/** The catalog song a phone song is, or null for one that never leaves the phone. */
export function refForLocalSong(song: { readonly id: string; readonly originId?: string }): SongRef | null {
  if (song.originId) {
    const parsed = parseSongRef(song.originId);
    if (parsed) return `${parsed.source}:${parsed.id}`;
  }
  return fromMobileId(song.id);
}

/** What another device needs to show a phone song. Local cover files do not travel; the catalog's does. */
export function snapshotOfLocal(song: LocalSong, ref: SongRef): SongSnapshot {
  const artwork = shareableArtwork(song.coverImageUri, song.coverRemoteUri);
  return {
    ref,
    title: song.title,
    artist: song.artist ?? '',
    ...(song.album ? { album: song.album } : {}),
    artwork,
    duration: Math.max(0, song.duration ?? 0),
  };
}

// ── Incoming: changes from the account, turned into what to do on the phone ──

export type LocalAction =
  /** Like or unlike a song that is on the phone (Liked songs membership). */
  | { readonly kind: 'like_local'; readonly songId: string; readonly ref: SongRef; readonly liked: boolean }
  | { readonly kind: 'online_like'; readonly ref: SongRef; readonly song?: SongSnapshot; readonly likedAt: number }
  | { readonly kind: 'online_unlike'; readonly ref: SongRef }
  | { readonly kind: 'playlist_upsert'; readonly playlistId: string; readonly name: string; readonly description?: string; readonly createdAt: number }
  | { readonly kind: 'playlist_delete'; readonly playlistId: string }
  | { readonly kind: 'playlist_local'; readonly playlistId: string; readonly songId: string; readonly ref: SongRef; readonly present: boolean; readonly addedAt: number }
  | { readonly kind: 'playlist_online'; readonly playlistId: string; readonly ref: SongRef; readonly song?: SongSnapshot; readonly present: boolean; readonly addedAt: number };

export interface InboundPlan {
  readonly actions: LocalAction[];
  /**
   * Playlist songs whose playlist is not on the phone and was not among these changes. The
   * account lists a playlist under its newest revision, so a renamed playlist arrives after
   * the songs that were added before the rename; the caller keeps these for the next page.
   */
  readonly orphans: LibraryChange[];
  /** The playlists on the phone once the actions have been applied. */
  readonly playlistIds: ReadonlySet<string>;
}

/**
 * Changes (in revision order) → phone actions. `playlistIds` are the playlists on the phone
 * now. Playlists are created and deleted first, whatever their place in the order, so a song
 * is never added to a playlist that does not exist yet; everything else keeps its order.
 */
export function planInboundPage(changes: readonly LibraryChange[], index: LocalIndex, playlistIds: ReadonlySet<string>): InboundPlan {
  const actions: LocalAction[] = [];
  const orphans: LibraryChange[] = [];
  const known = new Set(playlistIds);
  const deleted = new Set<string>();
  for (const change of changes) {
    if (change.kind !== 'playlist' || change.playlistId === LIKED_PLAYLIST_ID) continue;
    if (change.deleted) {
      deleted.add(change.playlistId);
      if (known.delete(change.playlistId)) actions.push({ kind: 'playlist_delete', playlistId: change.playlistId });
    } else {
      deleted.delete(change.playlistId);
      known.add(change.playlistId);
      actions.push({
        kind: 'playlist_upsert',
        playlistId: change.playlistId,
        name: change.name,
        ...(change.description ? { description: change.description } : {}),
        createdAt: change.createdAt,
      });
    }
  }
  for (const change of changes) {
    switch (change.kind) {
      case 'like': {
        const songId = index.songFor(change.ref, change.song);
        if (change.liked) {
          if (songId) {
            actions.push({ kind: 'like_local', songId, ref: change.ref, liked: true });
            // On the phone, the like lives on the row; drop any online copy of it.
            actions.push({ kind: 'online_unlike', ref: change.ref });
          } else {
            actions.push({ kind: 'online_like', ref: change.ref, ...(change.song ? { song: change.song } : {}), likedAt: change.likedAt });
          }
        } else {
          if (songId) actions.push({ kind: 'like_local', songId, ref: change.ref, liked: false });
          actions.push({ kind: 'online_unlike', ref: change.ref });
        }
        break;
      }
      case 'playlist':
        break;
      case 'playlist_item': {
        if (change.playlistId === LIKED_PLAYLIST_ID) break;
        if (!known.has(change.playlistId)) {
          if (!deleted.has(change.playlistId)) orphans.push(change);
          break;
        }
        const present = !change.deleted;
        const songId = index.songFor(change.ref, change.song);
        if (songId) {
          actions.push({ kind: 'playlist_local', playlistId: change.playlistId, songId, ref: change.ref, present, addedAt: change.addedAt });
          if (present) actions.push({ kind: 'playlist_online', playlistId: change.playlistId, ref: change.ref, present: false, addedAt: change.addedAt });
        } else {
          actions.push({
            kind: 'playlist_online',
            playlistId: change.playlistId,
            ref: change.ref,
            ...(change.song ? { song: change.song } : {}),
            present,
            addedAt: change.addedAt,
          });
        }
        break;
      }
    }
  }
  return { actions, orphans, playlistIds: known };
}

/** The actions alone, for one set of changes that stands by itself. */
export function planInbound(changes: readonly LibraryChange[], index: LocalIndex, playlistIds: ReadonlySet<string>): LocalAction[] {
  return planInboundPage(changes, index, playlistIds).actions;
}

const onlineRowOf = (song: SongSnapshot, at: number): OnlineSongRow => ({
  ref: song.ref,
  title: song.title,
  ...(song.artist ? { artist: song.artist } : {}),
  ...(song.album ? { album: song.album } : {}),
  ...(song.artwork ? { artwork: song.artwork } : {}),
  duration: song.duration,
  at,
});

/**
 * Actions → the rows SQLite writes. `details` holds songs a change named without describing;
 * an online song nobody could describe cannot be shown, so it is left out.
 */
export function writesFor(actions: readonly LocalAction[], details: ReadonlyMap<string, SongSnapshot>): InboundWrite[] {
  const writes: InboundWrite[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case 'like_local':
        writes.push({ kind: 'like_local', playlistId: LIKED_PLAYLIST_ID, songId: action.songId, ref: action.ref, liked: action.liked });
        break;
      case 'online_like': {
        const song = action.song ?? details.get(action.ref);
        if (song) writes.push({ kind: 'online_like', row: onlineRowOf(song, action.likedAt) });
        break;
      }
      case 'online_unlike':
        writes.push({ kind: 'online_unlike', ref: action.ref });
        break;
      case 'playlist_upsert':
        writes.push({
          kind: 'playlist_upsert',
          playlistId: action.playlistId,
          name: action.name,
          ...(action.description ? { description: action.description } : {}),
          createdAt: action.createdAt,
        });
        break;
      case 'playlist_delete':
        writes.push({ kind: 'playlist_delete', playlistId: action.playlistId });
        break;
      case 'playlist_local':
        writes.push({ kind: 'playlist_local', playlistId: action.playlistId, songId: action.songId, ref: action.ref, present: action.present });
        break;
      case 'playlist_online': {
        if (!action.present) {
          writes.push({ kind: 'playlist_online_remove', playlistId: action.playlistId, ref: action.ref });
          break;
        }
        const song = action.song ?? details.get(action.ref);
        if (song) writes.push({ kind: 'playlist_online', playlistId: action.playlistId, row: onlineRowOf(song, action.addedAt) });
        break;
      }
    }
  }
  return writes;
}

// ── What a commit means for the screens ─────────────────────────────────────

/** The in-memory copies that no longer match SQLite. */
export interface ViewRefresh {
  /** The online-only likes (hearts on streamed songs, the online rows of Liked songs). */
  readonly onlineLikes: boolean;
  /** The playlist list: names, song counts, and which downloaded songs are liked. */
  readonly playlists: boolean;
  /** The downloaded songs themselves. */
  readonly songs: boolean;
  /** Playlists whose open screen shows stale songs or a stale name; 'all' after a wholesale change. */
  readonly openPlaylists: readonly string[] | 'all';
}

export const NO_REFRESH: ViewRefresh = { onlineLikes: false, playlists: false, songs: false, openPlaylists: [] };
export const FULL_REFRESH: ViewRefresh = { onlineLikes: true, playlists: true, songs: true, openPlaylists: 'all' };

export const isNoRefresh = (refresh: ViewRefresh): boolean =>
  !refresh.onlineLikes && !refresh.playlists && !refresh.songs && refresh.openPlaylists !== 'all' && refresh.openPlaylists.length === 0;

/** Only what the committed rows touch: a like reloads no playlist but Liked songs, an unchanged pull reloads nothing. */
export function refreshFor(summary: LibraryChangeSummary): ViewRefresh {
  const likes = summary.likedOnlineRefs.length > 0 || summary.likedLocalRefs.length > 0;
  return {
    onlineLikes: summary.likedOnlineRefs.length > 0,
    playlists: summary.likedLocalRefs.length > 0 || summary.playlistMetaIds.length > 0 || summary.playlistLocalItemIds.length > 0,
    songs: summary.songIds.length > 0,
    openPlaylists: [...new Set([
      ...summary.playlistMetaIds,
      ...summary.playlistLocalItemIds,
      ...summary.playlistOnlineItemIds,
      ...(likes ? [LIKED_PLAYLIST_ID] : []),
    ])],
  };
}

export function mergeRefresh(a: ViewRefresh, b: ViewRefresh): ViewRefresh {
  return {
    onlineLikes: a.onlineLikes || b.onlineLikes,
    playlists: a.playlists || b.playlists,
    songs: a.songs || b.songs,
    openPlaylists: a.openPlaylists === 'all' || b.openPlaylists === 'all' ? 'all' : [...new Set([...a.openPlaylists, ...b.openPlaylists])],
  };
}

// ── Operations that lost on the account ─────────────────────────────────────
//
// The account answers a batch with the operations that lost to something newer. For each, the
// phone's copy of that one item is wrong until it has the account's row. The item is named by
// a key and remembered until a pull has delivered that row.

/** The item an operation is about. A deleted playlist takes its songs with it, so it is named apart. */
export function targetOfOp(op: LibraryOp): string {
  switch (op.op) {
    case 'like':
    case 'unlike':
      return `like:${op.ref}`;
    case 'playlist_upsert':
      return `playlist:${op.playlistId}`;
    case 'playlist_delete':
      return `list:${op.playlistId}`;
    case 'playlist_add':
    case 'playlist_remove':
      return `item:${op.playlistId}:${op.ref}`;
  }
}

/** The items a row from "everything after N" puts right by being applied. */
export function targetsMetBy(change: LibraryChange): string[] {
  switch (change.kind) {
    case 'like':
      return [`like:${change.ref}`];
    case 'playlist':
      // A playlist deleted here that still exists on the account lost its songs here too: its row alone does not bring them back.
      return change.deleted ? [`playlist:${change.playlistId}`, `list:${change.playlistId}`] : [`playlist:${change.playlistId}`];
    case 'playlist_item':
      return [`item:${change.playlistId}:${change.ref}`];
  }
}

/**
 * The items a row of the account's whole library answers for, or none when nobody asked about
 * it. A playlist asked about with its songs (`list:`) is answered by its row and by each song.
 */
export function targetsAnsweredBy(change: LibraryChange, targets: ReadonlySet<string>): string[] {
  switch (change.kind) {
    case 'like':
      return targets.has(`like:${change.ref}`) ? [`like:${change.ref}`] : [];
    case 'playlist':
      return [`playlist:${change.playlistId}`, `list:${change.playlistId}`].filter(key => targets.has(key));
    case 'playlist_item': {
      const own = `item:${change.playlistId}:${change.ref}`;
      return targets.has(own) || targets.has(`list:${change.playlistId}`) ? [own] : [];
    }
  }
}

/** The row for an item the account's library no longer lists: it is gone there. */
export function goneChange(target: string): LibraryChange | null {
  const sep = target.indexOf(':');
  const kind = target.slice(0, sep);
  const rest = target.slice(sep + 1);
  if (kind === 'like') {
    return parseSongRef(rest) ? { kind: 'like', rev: 0, ref: rest as SongRef, liked: false, likedAt: 0 } : null;
  }
  if (kind === 'playlist' || kind === 'list') {
    return rest ? { kind: 'playlist', rev: 0, playlistId: rest, name: '', isPublic: false, deleted: true, createdAt: 0 } : null;
  }
  if (kind === 'item') {
    const split = rest.indexOf(':');
    const ref = rest.slice(split + 1);
    return split > 0 && parseSongRef(ref)
      ? { kind: 'playlist_item', rev: 0, playlistId: rest.slice(0, split), ref: ref as SongRef, deleted: true, addedAt: 0 }
      : null;
  }
  return null;
}

// ── Outgoing: what a tap on the phone becomes ────────────────────────────────

export function likeOp(ref: SongRef, liked: boolean, at: number, song?: SongSnapshot): LibraryOp {
  return liked ? { op: 'like', ref, ...(song ? { song } : {}), at } : { op: 'unlike', ref, at };
}

export function playlistUpsertOp(playlistId: string, fields: { name?: string; description?: string | null }, at: number): LibraryOp {
  return {
    op: 'playlist_upsert',
    playlistId,
    ...(fields.name ? { name: fields.name.trim().slice(0, 100) } : {}),
    ...(fields.description !== undefined ? { description: fields.description ? fields.description.trim().slice(0, 500) : null } : {}),
    at,
  };
}

export function playlistItemOp(playlistId: string, ref: SongRef, present: boolean, at: number, song?: SongSnapshot): LibraryOp {
  return present ? { op: 'playlist_add', playlistId, ref, ...(song ? { song } : {}), at } : { op: 'playlist_remove', playlistId, ref, at };
}

// ── First sign-in on a phone that already has a library ─────────────────────

export type FirstSyncChoice = 'merge' | 'account' | 'phone';

/** Everything syncable on the phone, as the account would see it. */
export interface PhoneLibrary {
  readonly likes: readonly { readonly ref: SongRef; readonly song?: SongSnapshot }[];
  readonly playlists: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly items: readonly { readonly ref: SongRef; readonly song?: SongSnapshot }[];
  }[];
}

/** Everything the account has (from the change feed since 0). */
export interface AccountLibrary {
  readonly likedRefs: ReadonlySet<SongRef>;
  readonly playlists: ReadonlyMap<string, ReadonlySet<SongRef>>;
}

export interface PhonePlaylistRows {
  readonly id: string;
  readonly isDefault: boolean;
  readonly songIds: readonly string[];
  readonly onlineRefs?: readonly string[];
}

export interface PhonePlaylistReplacement {
  readonly deletePlaylistIds: readonly string[];
  readonly removeMemberships: readonly { readonly playlistId: string; readonly songId: string }[];
  readonly removeOnlineItems: readonly { readonly playlistId: string; readonly ref: string }[];
}

/** Local rows that must be removed before the phone adopts the account's playlists. */
export function planPhonePlaylistReplacement(
  phonePlaylists: readonly PhonePlaylistRows[],
  refsBySongId: ReadonlyMap<string, SongRef | null>,
  accountPlaylists: ReadonlyMap<string, ReadonlySet<SongRef>>,
): PhonePlaylistReplacement {
  const deletePlaylistIds: string[] = [];
  const removeMemberships: { playlistId: string; songId: string }[] = [];
  const removeOnlineItems: { playlistId: string; ref: string }[] = [];
  for (const playlist of phonePlaylists) {
    if (playlist.isDefault) continue;
    const accountRefs = accountPlaylists.get(playlist.id);
    if (!accountRefs) {
      deletePlaylistIds.push(playlist.id);
      continue;
    }
    for (const songId of playlist.songIds) {
      const ref = refsBySongId.get(songId);
      if (!ref || !accountRefs.has(ref)) removeMemberships.push({ playlistId: playlist.id, songId });
    }
    for (const ref of playlist.onlineRefs ?? []) {
      const parsed = parseSongRef(ref);
      const canonical = parsed ? `${parsed.source}:${parsed.id}` as SongRef : null;
      if (!canonical || !accountRefs.has(canonical)) removeOnlineItems.push({ playlistId: playlist.id, ref });
    }
  }
  return { deletePlaylistIds, removeMemberships, removeOnlineItems };
}

/**
 * What to send for the listener's first sign-in choice:
 * - merge: everything on the phone is added (nothing is removed anywhere);
 * - account: nothing is sent; the phone adopts the account (the engine then drops phone items
 *   the account does not have — downloads are never deleted);
 * - phone: the account becomes the phone's library (its extra likes and playlists are removed).
 */
export function opsForFirstSync(choice: FirstSyncChoice, phone: PhoneLibrary, account: AccountLibrary, at: number): LibraryOp[] {
  if (choice === 'account') return [];
  const ops: LibraryOp[] = [];
  let tick = at;
  const next = () => tick++;
  for (const like of phone.likes) ops.push(likeOp(like.ref, true, next(), like.song));
  for (const list of phone.playlists) {
    ops.push(playlistUpsertOp(list.id, { name: list.name, description: list.description ?? null }, next()));
    for (const item of list.items) ops.push(playlistItemOp(list.id, item.ref, true, next(), item.song));
  }
  if (choice === 'phone') {
    const phoneLikes = new Set(phone.likes.map(like => like.ref));
    for (const ref of account.likedRefs) if (!phoneLikes.has(ref)) ops.push(likeOp(ref, false, next()));
    const phoneLists = new Map(phone.playlists.map(list => [list.id, new Set(list.items.map(item => item.ref))]));
    for (const [id, refs] of account.playlists) {
      const mine = phoneLists.get(id);
      if (!mine) {
        ops.push({ op: 'playlist_delete', playlistId: id, at: next() });
        continue;
      }
      for (const ref of refs) if (!mine.has(ref)) ops.push(playlistItemOp(id, ref, false, next()));
    }
  }
  return ops;
}
