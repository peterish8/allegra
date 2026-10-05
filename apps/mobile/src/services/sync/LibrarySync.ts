/**
 * Library sync between this phone and the Allegra account (web + other devices).
 *
 * Out: every like and playlist change made here becomes an operation in the SQLite
 * outbox, sent in batches (docs/api-contract.md "Library sync"). Offline, it waits.
 * In:  the change feed since the last revision, applied straight to SQLite
 *      (database/syncQueries.ts) — not through the stores, so nothing echoes back.
 * When: on sign-in, when the app comes to the front, shortly after a change here,
 *      and whenever the account's revision moves (Convex `library:myRev`).
 *
 * The decisions are plain functions in plan.ts; this file is the I/O around them.
 * Nothing here throws to a caller: sync failing must never break the library.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { makeFunctionReference } from 'convex/server';
import type { ConvexReactClient } from 'convex/react';

import { shareableArtwork } from '@shared/artwork';
import { isTombstone, type LibraryChange, type LibraryOp } from '@shared/library';
import { matchKey, parseSongRef, songRef, toAllegraId, type SongRef, type SongSnapshot } from '@shared/songRef';

import * as db from '../../database/syncQueries';
import { searchMusic } from '../MultiSourceSearchService';
import * as api from '../account/allegraApi';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { useSyncStore } from '../../store/syncStore';
import { postLibraryOps } from './opsApi';
import { setStuckSince } from './syncHealth';
import {
  LIKED_PLAYLIST_ID,
  buildLocalIndex,
  opsForFirstSync,
  planInbound,
  planPhonePlaylistReplacement,
  refForLocalSong,
  snapshotOfLocal,
  type AccountLibrary,
  type FirstSyncChoice,
  type LocalAction,
  type PhoneLibrary,
} from './plan';
import { nextPlayOutboxAction, parsePendingPlay } from './playOutbox';

const libraryRevision = makeFunctionReference<'query', Record<string, never>, number | null>('library:myRev');
const OPS_PER_BATCH = 100;
const FLUSH_DELAY_MS = 1500;
const RESYNC_MAX_PAGES = 100;

interface Session {
  readonly userId: string;
  readonly getToken: () => string | null;
}

let session: Session | null = null;
/** True once this phone's library is bound to the signed-in account (first-sync choice made). */
let active = false;
let running: Promise<void> | null = null;
let rerun = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;
let appState: NativeEventSubscription | null = null;
let observedLibraryRevision: number | undefined;
const playReportedListeners = new Set<() => void>();

const revKey = (userId: string) => `rev:${userId}`;
const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[LibrarySync]', ...args);
};

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Called when an account signs in (and on each start while signed in). */
export async function attach(next: Session, convex: ConvexReactClient): Promise<void> {
  if (session?.userId === next.userId) return;
  detach();
  session = next;
  observedLibraryRevision = undefined;
  db.getOutboxStuckSince().then(setStuckSince).catch(() => setStuckSince(null));
  try {
    const bound = await db.getMeta('account');
    if (bound === next.userId) {
      active = true;
    } else {
      const phone = await readPhoneLibrary();
      const hasLibrary = phone.likes.length > 0 || phone.playlists.length > 0;
      if (hasLibrary) {
        // A phone with its own library meets an account for the first time: ask.
        const token = next.getToken();
        const account = token ? await readAccountLibrary(token) : null;
        useSyncStore.getState().set({
          question: {
            phoneLikes: phone.likes.length,
            phonePlaylists: phone.playlists.length,
            accountLikes: account?.library.likedRefs.size ?? null,
            accountPlaylists: account?.library.playlists.size ?? null,
          },
        });
      } else {
        await bind(next.userId);
      }
    }
  } catch (error) {
    log('attach failed', error);
  }

  try {
    const watch = convex.watchQuery(libraryRevision, {});
    unwatch = watch.onUpdate(() => {
      try {
        const rev = watch.localQueryResult();
        if (typeof rev === 'number') {
          observedLibraryRevision = rev;
          syncSoon(0);
        }
      } catch {
        // The function may not be deployed yet: sync still runs on the other triggers.
      }
    });
  } catch {
    unwatch = null;
  }
  appState = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') syncSoon(0);
  });
  syncSoon(0);
}

/** Called on sign-out. The phone keeps its library; nothing is deleted. */
export function detach(): void {
  unwatch?.();
  unwatch = null;
  appState?.remove();
  appState = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  session = null;
  observedLibraryRevision = undefined;
  setStuckSince(null);
  active = false;
  useSyncStore.getState().set({ question: null, syncing: false });
}

async function bind(userId: string): Promise<void> {
  await db.setMeta('account', userId);
  await db.setMeta(revKey(userId), '0');
  active = true;
  useSyncStore.getState().set({ question: null });
}

// ── Recording what happens on this phone ────────────────────────────────────

/** A library change made here. Ignored until the phone is bound to an account. */
export function record(op: LibraryOp): void {
  if (!active) return;
  db.enqueueOutbox('op', op)
    .then(() => syncSoon(FLUSH_DELAY_MS))
    .catch(error => log('record failed', error));
}

/**
 * The ref for a phone song, finding it in the catalog for a download made before
 * origins were recorded (and remembering it, with the catalog's cover). Null for songs
 * that never leave the phone.
 */
export async function refFor(song: { id: string; title: string; artist?: string; originId?: string }): Promise<SongRef | null> {
  const known = refForLocalSong(song);
  if (known) return known;
  const found = await findInCatalog(song.title, song.artist ?? '');
  if (found) {
    await db.setOriginId(song.id, found.ref).catch(() => undefined);
    if (found.artwork) await db.setCoverRemoteUri(song.id, found.artwork).catch(() => undefined);
  }
  return found?.ref ?? null;
}

/** Publish a valid play to shared history after five seconds of real playback. */
export function recordPlayStarted(ref: SongRef, song: SongSnapshot, playedAt: string): Promise<void> {
  if (!session || song.ref !== ref) return Promise.resolve();
  return db.enqueueOutbox('play', {
    songRef: ref,
    song,
    songId: toAllegraId(ref) ?? undefined,
    seconds: 0,
    playedAt,
    recentOnly: true,
  })
    .then(() => syncSoon(FLUSH_DELAY_MS))
    .catch(error => log('play start record failed', error));
}

/** A completed listen: update shared history and teach Quick picks the final heard duration. */
export function recordPlay(ref: SongRef, seconds: number, song: SongSnapshot, playedAt = new Date().toISOString()): void {
  if (!session) return;
  const songId = toAllegraId(ref);
  if (song.ref !== ref || seconds < 5) return;
  db.enqueueOutbox('play', {
    songRef: ref,
    song,
    ...(songId ? { songId } : {}),
    seconds: Math.round(seconds),
    playedAt,
  })
    .then(() => syncSoon(FLUSH_DELAY_MS))
    .catch(error => log('play record failed', error));
}

/** Subscribe to a play whose recent and taste writes both reached the account. */
export function onPlayReported(listener: () => void): () => void {
  playReportedListeners.add(listener);
  return () => playReportedListeners.delete(listener);
}

// ── First sign-in choice ────────────────────────────────────────────────────

export async function choose(choice: FirstSyncChoice): Promise<boolean> {
  const current = session;
  if (!current) return false;
  const token = current.getToken();
  if (!token) return false;
  useSyncStore.getState().set({ syncing: true });
  try {
    const account = await readAccountLibrary(token);
    if (!account) return false; // offline: the question stays until it can be answered
    const phone = await readPhoneLibrary();
    const ops = opsForFirstSync(choice, phone, account.library, Date.now());
    if (choice === 'account') await dropPhoneOnlyItems(account.library);
    await db.clearOutbox('op'); // the chosen library covers old library ops, but not recent listens
    for (const op of ops) await db.enqueueOutbox('op', op);
    await bind(current.userId);
    syncSoon(0);
    return true;
  } catch (error) {
    log('choice failed', error);
    return false;
  } finally {
    useSyncStore.getState().set({ syncing: false });
  }
}

// ── The loop ────────────────────────────────────────────────────────────────

/** Send and pull now (or after `delayMs`). Overlapping calls fold into one more run. */
export function syncSoon(delayMs: number): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    runOnce().catch(error => log('sync failed', error));
  }, delayMs);
}

async function runOnce(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      const current = session;
      if (!current) break;
      useSyncStore.getState().set({ syncing: true });
      let failed = false;
      const includeLibrary = active;
      try {
        const sent = await flush(current, includeLibrary);
        const pulled = includeLibrary ? sent.skippedPull || await pull(current) : true;
        failed = includeLibrary && (!sent.ok || !pulled);
        if (includeLibrary && sent.ok && pulled) useSyncStore.getState().set({ lastSyncedAt: Date.now() });
      } catch (error) {
        failed = includeLibrary;
        log('sync failed', error);
      } finally {
        if (includeLibrary && session?.userId === current.userId) {
          await updateSyncHealth(failed).catch(error => log('sync health update failed', error));
        }
        useSyncStore.getState().set({ syncing: false });
      }
    } while (rerun);
  })();
  try {
    await running;
  } finally {
    running = null;
  }
}

async function updateSyncHealth(failed: boolean): Promise<void> {
  const [ops, plays] = await Promise.all([db.peekOutbox('op', 1), db.peekOutbox('play', 1)]);
  if (ops.length === 0 && plays.length === 0) {
    await db.clearOutboxStuck();
    setStuckSince(null);
    return;
  }
  const stuckSince = failed ? await db.markOutboxStuck(Date.now()) : await db.getOutboxStuckSince();
  setStuckSince(stuckSince);
}

/** Sends the outbox. A known contiguous write may advance the cursor without a redundant pull. */
async function flush(current: Session, includeLibrary: boolean): Promise<{ readonly ok: boolean; readonly skippedPull: boolean }> {
  let cursor = includeLibrary ? Number((await db.getMeta(revKey(current.userId))) ?? '0') || 0 : 0;
  let canSkipPull = includeLibrary;
  let advancedCursor = false;
  if (includeLibrary) for (;;) {
    const token = current.getToken();
    if (!token) return { ok: false, skippedPull: false };
    const batch = await db.peekOutbox('op', OPS_PER_BATCH);
    if (batch.length === 0) break;
    const ops = batch.flatMap(entry => {
      try {
        return [JSON.parse(entry.body) as LibraryOp];
      } catch {
        return [];
      }
    });
    let reply = ops.length > 0 ? await postLibraryOps(token, ops, Date.now()) : { outcome: 'refused' as const };
    if (reply.outcome === 'offline') return { ok: false, skippedPull: false };
    const considerFastForward = async (result: typeof reply): Promise<void> => {
      if (result.outcome !== 'sent') { canSkipPull = false; return; }
      const data = result.data;
      if (data.applied === undefined || data.superseded === undefined || data.superseded.length > 0 || data.rejected.length > 0 ||
          data.rev - data.applied !== cursor || observedLibraryRevision !== data.rev) {
        canSkipPull = false;
        return;
      }
      cursor = data.rev;
      advancedCursor = true;
      await db.setMeta(revKey(current.userId), String(cursor));
    };
    if (ops.length > 0) await considerFastForward(reply);
    if (reply.outcome === 'refused' && ops.length > 1) {
      // One bad operation must not cost the good ones: send them singly, drop only what is still refused.
      for (const op of ops) {
        reply = await postLibraryOps(token, [op], Date.now());
        if (reply.outcome === 'offline') return { ok: false, skippedPull: false };
        await considerFastForward(reply);
      }
    }
    // Sent, or refused for good (malformed): either way these entries are done.
    await db.removeOutbox(batch.map(entry => entry.id));
    if (reply.outcome === 'refused') log('batch refused', ops.length);
  }
  for (;;) {
    const token = current.getToken();
    if (!token) return { ok: false, skippedPull: false };
    const plays = await db.peekOutbox('play', 20);
    if (plays.length === 0) break;
    for (const entry of plays) {
      const play = parsePendingPlay(entry.body);
      if (!play || (!play.recentOnly && play.seconds < 5)) {
        await db.removeOutbox([entry.id]);
        continue;
      }
      if (nextPlayOutboxAction(play) === 'recent') {
        const recent = await api.postPlay(token, {
          ...(play.songId ? { songId: play.songId } : {}),
          songRef: play.songRef,
          ...(play.song ? { song: play.song } : {}),
          playDuration: play.seconds,
          playedAt: play.playedAt,
        });
        if (recent.outcome === 'offline') return { ok: false, skippedPull: false };
        if (recent.outcome === 'refused') {
          log('play refused', play.songId);
          await db.removeOutbox([entry.id]);
          continue;
        }
        // Save the completed side effect before attempting taste; a failed taste
        // request will resume at that stage on the next online sync.
        await db.updateOutboxBody(entry.id, { ...play, recentPosted: true });
      }
      if (play.recentOnly) {
        await db.removeOutbox([entry.id]);
        continue;
      }
      const taste = await api.postListenSignal(token, {
        playId: `${play.songRef}:${play.playedAt}`.slice(0, 128),
        cumulativeSeconds: play.seconds,
        ...(play.songId ? { songId: play.songId } : {}),
        songRef: play.songRef,
        ...(play.song ? { song: play.song } : {}),
        seconds: play.seconds,
        playedAt: play.playedAt,
      });
      if (taste.outcome === 'offline') return { ok: false, skippedPull: false };
      if (taste.outcome === 'refused') log('taste signal refused', play.songId);
      await db.removeOutbox([entry.id]);
      if (taste.outcome === 'sent') for (const listener of [...playReportedListeners]) listener();
    }
  }
  useSyncStore.getState().set({ pending: 0 });
  return { ok: true, skippedPull: canSkipPull && advancedCursor };
}

/** Applies every change after the stored revision. False when offline. */
async function pull(current: Session): Promise<boolean> {
  let since = Number((await db.getMeta(revKey(current.userId))) ?? '0') || 0;
  let changed = false;
  for (let guard = 0; guard < 100; guard++) {
    const token = current.getToken();
    if (!token) return false;
    const reply = await api.getLibraryChanges(token, since);
    if (reply.outcome !== 'sent') return false;
    if (reply.data.resync === true) {
      const changes = [...reply.data.changes];
      let resyncSince = reply.data.rev;
      let more = reply.data.more;
      let pages = 1;
      while (more && pages < RESYNC_MAX_PAGES) {
        const nextToken = current.getToken();
        if (!nextToken) return false;
        const next = await api.getLibraryChanges(nextToken, resyncSince, 500, true);
        if (next.outcome !== 'sent' || next.data.resync !== true) return false;
        if (next.data.more && next.data.rev <= resyncSince) return false;
        changes.push(...next.data.changes);
        resyncSince = next.data.rev;
        more = next.data.more;
        pages += 1;
      }
      if (more) return false;
      if (!await reconcileResync(changes, token)) {
        await refreshStores();
        return false;
      }
      await refreshStores();
      // This is the only cursor write in a resync: every page and every local write succeeded.
      await db.setMeta(revKey(current.userId), String(resyncSince));
      return true;
    }
    if (reply.data.changes.length > 0) {
      const applied = await apply(reply.data.changes, token);
      changed = true;
      // Not stored: the next pull asks for these again (applying is idempotent).
      if (!applied) {
        await refreshStores();
        return false;
      }
    }
    since = reply.data.rev;
    await db.setMeta(revKey(current.userId), String(since));
    if (!reply.data.more) break;
  }
  if (changed) await refreshStores();
  return true;
}

interface PendingLibraryEdits {
  readonly likeRefs: ReadonlySet<string>;
  /** Any pending operation keeps a local playlist from being dropped during replacement. */
  readonly playlistIds: ReadonlySet<string>;
  /** Pending playlist metadata changes also protect the playlist's existing contents. */
  readonly playlistMetadataIds: ReadonlySet<string>;
  readonly itemKeys: ReadonlySet<string>;
}

function pendingLibraryEdits(entries: readonly db.OutboxEntry[]): PendingLibraryEdits {
  const likeRefs = new Set<string>();
  const playlistIds = new Set<string>();
  const playlistMetadataIds = new Set<string>();
  const itemKeys = new Set<string>();
  for (const entry of entries) {
    let value: unknown;
    try {
      value = JSON.parse(entry.body) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(value) || typeof value.op !== 'string') continue;
    if ((value.op === 'like' || value.op === 'unlike') && typeof value.ref === 'string') {
      likeRefs.add(value.ref);
      continue;
    }
    if ((value.op === 'playlist_upsert' || value.op === 'playlist_delete') && typeof value.playlistId === 'string') {
      playlistIds.add(value.playlistId);
      playlistMetadataIds.add(value.playlistId);
      continue;
    }
    if ((value.op === 'playlist_add' || value.op === 'playlist_remove') && typeof value.playlistId === 'string' && typeof value.ref === 'string') {
      playlistIds.add(value.playlistId);
      itemKeys.add(`${value.playlistId}\u0000${value.ref}`);
    }
  }
  return { likeRefs, playlistIds, playlistMetadataIds, itemKeys };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Replaces the account-synced part of the phone library from a full live feed. The outbox is a
 * separate source of pending local intent: rows it names are left alone until the operation is sent.
 */
async function reconcileResync(changes: readonly LibraryChange[], token: string): Promise<boolean> {
  try {
    const [outbox, songs, playlists, onlineLikes] = await Promise.all([
      db.readOutbox('op'),
      db.getLocalSongs(),
      db.getLocalPlaylists(),
      db.getOnlineLikes(),
    ]);
    const pending = pendingLibraryEdits(outbox);
    const liveChanges = changes.filter((change) => !isTombstone(change));
    const liveLikes = new Set(liveChanges.flatMap((change) => change.kind === 'like' && change.liked ? [change.ref] : []));
    const livePlaylists = new Map<string, Set<string>>();
    for (const change of liveChanges) {
      if (change.kind === 'playlist' && change.playlistId !== LIKED_PLAYLIST_ID) {
        livePlaylists.set(change.playlistId, new Set());
      }
    }
    for (const change of liveChanges) {
      if (change.kind === 'playlist_item' && change.playlistId !== LIKED_PLAYLIST_ID) {
        livePlaylists.get(change.playlistId)?.add(change.ref);
      }
    }

    const songById = new Map(songs.map((song) => [song.id, song]));
    const likedPlaylist = playlists.find((playlist) => playlist.isDefault);
    for (const songId of likedPlaylist?.songIds ?? []) {
      const song = songById.get(songId);
      const ref = song ? refForLocalSong(song) : null;
      if (ref && !pending.likeRefs.has(ref) && !liveLikes.has(ref)) {
        await db.setPlaylistMembership(LIKED_PLAYLIST_ID, songId, false);
      }
    }
    for (const row of onlineLikes) {
      const parsed = parseSongRef(row.ref);
      if (parsed && !pending.likeRefs.has(row.ref) && !liveLikes.has(`${parsed.source}:${parsed.id}`)) {
        await db.removeOnlineLike(row.ref);
      }
    }

    for (const playlist of playlists) {
      if (playlist.isDefault) continue;
      const accountItems = livePlaylists.get(playlist.id);
      if (!accountItems) {
        if (!pending.playlistIds.has(playlist.id)) await db.deletePlaylistRaw(playlist.id);
        continue;
      }
      if (pending.playlistMetadataIds.has(playlist.id)) continue;
      const pendingItem = (ref: string) => pending.itemKeys.has(`${playlist.id}\u0000${ref}`);
      for (const songId of playlist.songIds) {
        const song = songById.get(songId);
        const ref = song ? refForLocalSong(song) : null;
        if (ref && !pendingItem(ref) && !accountItems.has(ref)) {
          await db.setPlaylistMembership(playlist.id, songId, false);
        }
      }
      for (const row of await db.getOnlinePlaylistSongs(playlist.id)) {
        const parsed = parseSongRef(row.ref);
        const ref = parsed ? `${parsed.source}:${parsed.id}` : null;
        if (ref && !pendingItem(ref) && !accountItems.has(ref)) {
          await db.removeOnlinePlaylistSong(playlist.id, row.ref);
        }
      }
    }

    const applicable = liveChanges.filter((change) => {
      if (change.kind === 'like') return !pending.likeRefs.has(change.ref);
      if (change.kind === 'playlist') return !pending.playlistMetadataIds.has(change.playlistId);
      return !pending.playlistMetadataIds.has(change.playlistId) && !pending.itemKeys.has(`${change.playlistId}\u0000${change.ref}`);
    });
    return await apply(applicable, token);
  } catch (error) {
    log('resync reconcile failed', error);
    return false;
  }
}

/** False when any change could not be written, so the caller keeps its place and retries. */
async function apply(changes: readonly LibraryChange[], token: string): Promise<boolean> {
  const [songs, playlists] = await Promise.all([db.getLocalSongs(), db.getLocalPlaylists()]);
  const index = buildLocalIndex(songs);
  const playlistIds = new Set(playlists.filter(list => !list.isDefault).map(list => list.id));
  const actions = planInbound(changes, index, playlistIds);
  const { details, complete } = await detailsFor(actions, token);

  // Details that could not be fetched (offline) mean a like or playlist song would be skipped:
  // apply the rest, but keep our place so the next pull brings those back.
  let ok = complete;
  for (const action of actions) {
    try {
      await applyAction(action, details);
    } catch (error) {
      ok = false;
      log('apply failed', action.kind, error);
    }
  }
  return ok;
}

async function applyAction(action: LocalAction, details: Map<string, SongSnapshot>): Promise<void> {
  switch (action.kind) {
    case 'like_local':
      await db.setPlaylistMembership(LIKED_PLAYLIST_ID, action.songId, action.liked);
      await db.setOriginId(action.songId, action.ref);
      return;
    case 'online_like': {
      const song = action.song ?? details.get(action.ref);
      if (song) await db.upsertOnlineLike(rowOf(song, action.likedAt));
      return;
    }
    case 'online_unlike':
      await db.removeOnlineLike(action.ref);
      return;
    case 'playlist_upsert':
      await db.upsertPlaylistRaw(action.playlistId, action.name, action.description, action.createdAt);
      return;
    case 'playlist_delete':
      await db.deletePlaylistRaw(action.playlistId);
      return;
    case 'playlist_local':
      await db.setPlaylistMembership(action.playlistId, action.songId, action.present);
      if (action.present) await db.setOriginId(action.songId, action.ref);
      return;
    case 'playlist_online': {
      if (!action.present) {
        await db.removeOnlinePlaylistSong(action.playlistId, action.ref);
        return;
      }
      const song = action.song ?? details.get(action.ref);
      if (song) await db.upsertOnlinePlaylistSong(action.playlistId, rowOf(song, action.addedAt));
      return;
    }
  }
}

/**
 * Songs a change named without details (e.g. liked on the website while the catalog was down).
 * `complete` is false when the API could not be reached for some of them; a song the catalog
 * no longer has cannot be shown and is left out for good.
 */
async function detailsFor(actions: readonly LocalAction[], token: string): Promise<{ details: Map<string, SongSnapshot>; complete: boolean }> {
  const missing = new Set<string>();
  for (const action of actions) {
    if ((action.kind === 'online_like' || (action.kind === 'playlist_online' && action.present)) && !action.song) {
      missing.add(action.ref);
    }
  }
  const found = new Map<string, SongSnapshot>();
  let complete = true;
  const refs = [...missing];
  for (let i = 0; i < refs.length; i += 50) {
    const songs = await api.getAllegraSongs(token, refs.slice(i, i + 50));
    if (!songs) {
      complete = false;
      continue;
    }
    for (const song of songs) {
      const ref = songRef(song.source, song.id);
      if (ref) found.set(ref, { ref, title: song.title, artist: song.artist, ...(song.album ? { album: song.album } : {}), artwork: song.artwork, duration: song.duration });
    }
  }
  return { details: found, complete };
}

const rowOf = (song: SongSnapshot, at: number): db.OnlineSongRow => ({
  ref: song.ref,
  title: song.title,
  ...(song.artist ? { artist: song.artist } : {}),
  ...(song.album ? { album: song.album } : {}),
  ...(song.artwork ? { artwork: song.artwork } : {}),
  duration: song.duration,
  at,
});

async function refreshStores(): Promise<void> {
  // Imported late: the stores import this module to record changes.
  const [{ usePlaylistStore }, { useSongsStore }] = await Promise.all([import('../../store/playlistStore'), import('../../store/songsStore')]);
  await Promise.all([
    usePlaylistStore.getState().fetchPlaylists(),
    useSongsStore.getState().fetchSongs(),
    useOnlineLibraryStore.getState().load(),
  ]);
  useOnlineLibraryStore.getState().bumpPlaylists();
}

// ── Reading both libraries (first sign-in) ──────────────────────────────────

async function readPhoneLibrary(): Promise<PhoneLibrary> {
  const [songs, playlists, onlineLikes] = await Promise.all([db.getLocalSongs(), db.getLocalPlaylists(), db.getOnlineLikes()]);
  const byId = new Map(songs.map(song => [song.id, song]));
  const syncable = async (songId: string) => {
    const song = byId.get(songId);
    if (!song) return null;
    const ref = await refFor(song);
    return ref ? { ref, song: snapshotOfLocal(song, ref) } : null;
  };
  const likes: { ref: SongRef; song?: SongSnapshot }[] = [];
  const lists: PhoneLibrary['playlists'][number][] = [];
  for (const list of playlists) {
    const items = (await Promise.all(list.songIds.map(syncable))).filter((item): item is { ref: SongRef; song: SongSnapshot } => item !== null);
    if (list.isDefault) likes.push(...items);
    else {
      const online = await db.getOnlinePlaylistSongs(list.id);
      lists.push({
        id: list.id,
        name: list.name,
        ...(list.description ? { description: list.description } : {}),
        items: [
          ...items,
          ...online.flatMap(row => {
            const ref = parseSongRef(row.ref) ? row.ref as SongRef : null;
            return ref ? [{ ref, song: snapshotOfOnlineRow(row, ref) }] : [];
          }),
        ],
      });
    }
  }
  for (const row of onlineLikes) {
    if (!parseSongRef(row.ref)) continue;
    const ref = row.ref as SongRef;
    likes.push({ ref, song: snapshotOfOnlineRow(row, ref) });
  }
  return {
    likes: [...new Map(likes.map(like => [like.ref, like])).values()],
    playlists: lists,
  };
}

async function readAccountLibrary(token: string): Promise<{ library: AccountLibrary } | null> {
  const likedRefs = new Set<SongRef>();
  const playlists = new Map<string, Set<SongRef>>();
  let since = 0;
  for (let guard = 0; guard < 100; guard++) {
    const reply = await api.getLibraryChanges(token, since, 500);
    if (reply.outcome !== 'sent') return null;
    for (const change of reply.data.changes) {
      if (change.kind === 'like') {
        if (change.liked) likedRefs.add(change.ref);
        else likedRefs.delete(change.ref);
      } else if (change.kind === 'playlist') {
        if (change.playlistId === LIKED_PLAYLIST_ID) continue;
        if (change.deleted) playlists.delete(change.playlistId);
        else if (!playlists.has(change.playlistId)) playlists.set(change.playlistId, new Set());
      } else {
        if (change.playlistId === LIKED_PLAYLIST_ID) continue;
        const list = playlists.get(change.playlistId);
        if (list) {
          if (change.deleted) list.delete(change.ref);
          else list.add(change.ref);
        }
      }
    }
    since = reply.data.rev;
    if (!reply.data.more) break;
  }
  return { library: { likedRefs, playlists } };
}

function snapshotOfOnlineRow(row: db.OnlineSongRow, ref: SongRef): SongSnapshot {
  return {
    ref,
    title: row.title,
    artist: row.artist ?? '',
    ...(row.album ? { album: row.album } : {}),
    artwork: row.artwork ?? '',
    duration: Math.max(0, row.duration),
  };
}

/** "Use my account's library": the phone's likes and playlists the account lacks go. Downloads stay. */
async function dropPhoneOnlyItems(account: AccountLibrary): Promise<void> {
  const [songs, playlists, onlineLikes] = await Promise.all([db.getLocalSongs(), db.getLocalPlaylists(), db.getOnlineLikes()]);
  const byId = new Map(songs.map(song => [song.id, song]));
  const onlineRows = await Promise.all(playlists
    .filter(list => !list.isDefault && account.playlists.has(list.id))
    .map(async list => [list.id, await db.getOnlinePlaylistSongs(list.id)] as const));
  const onlineByPlaylist = new Map(onlineRows);
  const replacement = planPhonePlaylistReplacement(
    playlists.map(list => ({
      id: list.id,
      isDefault: list.isDefault,
      songIds: list.songIds,
      onlineRefs: onlineByPlaylist.get(list.id)?.map(row => row.ref) ?? [],
    })),
    new Map(songs.map(song => [song.id, refForLocalSong(song)])),
    account.playlists,
  );
  for (const playlistId of replacement.deletePlaylistIds) await db.deletePlaylistRaw(playlistId);
  for (const item of replacement.removeMemberships) {
    await db.setPlaylistMembership(item.playlistId, item.songId, false);
  }
  for (const item of replacement.removeOnlineItems) {
    await db.removeOnlinePlaylistSong(item.playlistId, item.ref);
  }
  for (const list of playlists) {
    if (!list.isDefault) continue;
    for (const songId of list.songIds) {
      const song = byId.get(songId);
      const ref = song ? refForLocalSong(song) : null;
      if (!ref || !account.likedRefs.has(ref)) await db.setPlaylistMembership(LIKED_PLAYLIST_ID, songId, false);
    }
  }
  for (const row of onlineLikes) if (!account.likedRefs.has(row.ref as SongRef)) await db.removeOnlineLike(row.ref);
}

// ── Catalog lookups ─────────────────────────────────────────────────────────

/** The catalog song with this exact title and lead artist, or null. Never a guess. */
/** The catalog song a phone song is, and the catalog's cover for it ('' when it has none to share). */
export interface CatalogMatch {
  readonly ref: SongRef;
  readonly artwork: string;
}

/**
 * The catalog row with the same cleaned title and lead artist (`matchKey`), or null. Offline or a
 * provider down reads as "not found": the song simply stays on the phone for now.
 */
export async function findInCatalog(title: string, artist: string): Promise<CatalogMatch | null> {
  if (!title.trim()) return null;
  try {
    const key = matchKey(title, artist);
    const hits = await searchMusic(`${title} ${artist}`.trim(), artist || undefined);
    for (const hit of hits) {
      if (matchKey(hit.title, hit.artist) !== key) continue;
      const ref = songRef(hit.source, hit.id);
      if (ref) return { ref, artwork: shareableArtwork(hit.highResArt, hit.thumbnail) };
    }
  } catch {
    // Offline or provider down: the song simply stays on the phone for now.
  }
  return null;
}
