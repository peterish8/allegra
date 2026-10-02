/**
 * Library sync storage. The rules (newest change wins per item, deletes remembered,
 * revisions for catching up) live in packages/shared/library.ts; this file loads the
 * rows a batch touches, runs them, writes the result and rebuilds the profile's
 * likedSongIds/libraries copy — all in one transaction, so two devices changing the
 * library at once can never lose either change.
 *
 * `apply` and `changes` are called by the Express API only, gated on the server
 * secret like convex/profiles.ts. `myRev` is for a signed-in browser or phone to
 * notice that its library changed somewhere else.
 *
 * A listener's library moves from the profile into rows on their first change
 * (seedFromProfile). From then on `profiles.save` leaves likedSongIds/libraries alone.
 */
import { getAuthUserId } from '@convex-dev/auth/server';
import { v, type Infer } from 'convex/values';

import {
  applyLibraryOps,
  isTombstone,
  itemKey,
  pageOfChanges,
  seedFromProfile,
  toProfileLibrary,
  type LibraryOp,
  type LibraryRowsView,
  type LibraryWrite,
  type LikeRow,
  type ProfileLibrary,
  type PlaylistItemRow,
  type PlaylistRow
} from '../packages/shared/library';
import { parseSongRef, type SongRef, type SongSnapshot } from '../packages/shared/songRef';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireSecret } from './profiles';
import { songSnapshot } from './schema';

/**
 * Most rows read to rebuild the profile copy: together well under Convex's 16,384 documents read
 * per function, leaving room for the batch itself. Only current rows are read (never unlikes or
 * removed songs), newest first, so past these a listener loses their oldest entries from the
 * website's copy, never a playlist they just made. The rows, and so the phone, stay complete.
 */
const MAX_LIKES = 4000;
const MAX_PLAYLISTS = 300;
const MAX_ITEMS = 8000;
const MAX_PAGE = 500;

const rejectReason = v.union(v.literal('bad_time'), v.literal('no_playlist'), v.literal('missing_name'));
const libraryChange = v.union(
  v.object({ kind: v.literal('like'), rev: v.number(), ref: v.string(), song: v.optional(songSnapshot), liked: v.boolean(), likedAt: v.number() }),
  v.object({ kind: v.literal('playlist'), rev: v.number(), playlistId: v.string(), name: v.string(), description: v.optional(v.string()), isPublic: v.boolean(), coverUrl: v.optional(v.string()), deleted: v.boolean(), createdAt: v.number() }),
  v.object({ kind: v.literal('playlist_item'), rev: v.number(), playlistId: v.string(), ref: v.string(), song: v.optional(songSnapshot), deleted: v.boolean(), addedAt: v.number() })
);

const at = v.number();
const libraryOp = v.union(
  v.object({ op: v.literal('like'), ref: v.string(), song: v.optional(songSnapshot), at }),
  v.object({ op: v.literal('unlike'), ref: v.string(), at }),
  v.object({
    op: v.literal('playlist_upsert'),
    playlistId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    isPublic: v.optional(v.boolean()),
    cover: v.optional(v.union(v.null(), v.object({ key: v.optional(v.string()), url: v.string() }))),
    at
  }),
  v.object({ op: v.literal('playlist_delete'), playlistId: v.string(), at }),
  v.object({ op: v.literal('playlist_add'), playlistId: v.string(), ref: v.string(), song: v.optional(songSnapshot), at }),
  v.object({ op: v.literal('playlist_remove'), playlistId: v.string(), ref: v.string(), at })
);

// The validator stores refs as plain strings; the API only sends refs parseLibraryOps accepted.
const asOps = (ops: Infer<typeof libraryOp>[]): LibraryOp[] => ops as unknown as LibraryOp[];

type LikeDoc = Doc<'libraryLikes'>;
type PlaylistDoc = Doc<'libraryPlaylists'>;
type ItemDoc = Doc<'libraryItems'>;

function likeRow(doc: LikeDoc): LikeRow {
  const { _id, _creationTime, userId, ref, song, ...rest } = doc;
  return { ...rest, ref: ref as SongRef, ...(song ? { song: song as SongSnapshot } : {}) };
}

function playlistRow(doc: PlaylistDoc): PlaylistRow {
  const { _id, _creationTime, userId, ...rest } = doc;
  return rest;
}

function itemRow(doc: ItemDoc): PlaylistItemRow {
  const { _id, _creationTime, userId, ref, song, ...rest } = doc;
  return { ...rest, ref: ref as SongRef, ...(song ? { song: song as SongSnapshot } : {}) };
}

async function stateOf(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query('libraryState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

async function profileOf(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query('profiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

/** True once this listener's library lives in rows (profiles.save must then keep its copy). */
export async function libraryOwnsProfileCopy(ctx: QueryCtx, userId: string): Promise<boolean> {
  return (await stateOf(ctx, userId)) !== null;
}

async function rebuildProfileCopy(ctx: MutationCtx, userId: string, profileId: Doc<'profiles'>['_id']): Promise<void> {
  const [likes, playlists, items] = await Promise.all([
    ctx.db
      .query('libraryLikes')
      .withIndex('by_userId_and_liked_and_likedAt', (q) => q.eq('userId', userId).eq('liked', true))
      .order('desc')
      .take(MAX_LIKES),
    ctx.db
      .query('libraryPlaylists')
      .withIndex('by_userId_and_deleted_and_createdAt', (q) => q.eq('userId', userId).eq('deleted', false))
      .order('desc')
      .take(MAX_PLAYLISTS),
    ctx.db
      .query('libraryItems')
      .withIndex('by_userId_and_deleted_and_addedAt', (q) => q.eq('userId', userId).eq('deleted', false))
      .order('desc')
      .take(MAX_ITEMS)
  ]);
  const copy = toProfileLibrary(likes.map(likeRow), playlists.map(playlistRow), items.map(itemRow));
  await ctx.db.patch('profiles', profileId, { ...copy, lastActiveAt: Date.now() });
}

function saavnId(ref: SongRef): string | null {
  const parsed = parseSongRef(ref);
  return parsed?.source === 'saavn' ? parsed.id : null;
}

/** Keep the compatibility copy in sync from the touched rows, without reading the whole library. */
async function updateProfileCopy(ctx: MutationCtx, profile: Doc<'profiles'>, write: LibraryWrite): Promise<void> {
  const likedSongIds = [...profile.likedSongIds];
  for (const row of write.likes) {
    const id = saavnId(row.ref);
    if (!id) continue;
    const index = likedSongIds.indexOf(id);
    if (row.liked && index < 0) likedSongIds.push(id);
    else if (!row.liked && index >= 0) likedSongIds.splice(index, 1);
  }

  const libraries = new Map<string, ProfileLibrary>(profile.libraries.map((library) => [
    library.id,
    { ...library, songIds: [...library.songIds] }
  ]));
  for (const row of write.playlists) {
    if (row.deleted) {
      libraries.delete(row.playlistId);
      continue;
    }
    const previous = libraries.get(row.playlistId);
    libraries.set(row.playlistId, {
      id: row.playlistId,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      isPublic: row.isPublic,
      songIds: previous?.songIds ?? [],
      createdAt: new Date(row.createdAt).toISOString(),
      ...(row.coverKey ? { coverKey: row.coverKey } : {}),
      ...(row.coverUrl ? { coverUrl: row.coverUrl } : {})
    });
  }
  for (const row of write.items) {
    const id = saavnId(row.ref);
    const library = libraries.get(row.playlistId);
    if (!id || !library) continue;
    const songIds = [...library.songIds];
    const index = songIds.indexOf(id);
    if (row.deleted && index >= 0) songIds.splice(index, 1);
    else if (!row.deleted && index < 0) songIds.push(id);
    libraries.set(row.playlistId, { ...library, songIds });
  }

  if (likedSongIds.length > MAX_LIKES || libraries.size > MAX_PLAYLISTS) {
    await rebuildProfileCopy(ctx, profile.userId, profile._id);
    return;
  }
  const nextLibraries = [...libraries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (
    likedSongIds.length !== profile.likedSongIds.length || likedSongIds.some((id, index) => id !== profile.likedSongIds[index]) ||
    nextLibraries.length !== profile.libraries.length || nextLibraries.some((library, index) => {
      const previous = profile.libraries[index];
      return !previous || library.id !== previous.id || library.name !== previous.name || library.description !== previous.description ||
        library.isPublic !== previous.isPublic || library.createdAt !== previous.createdAt || library.coverKey !== previous.coverKey ||
        library.coverUrl !== previous.coverUrl || library.songIds.length !== previous.songIds.length ||
        library.songIds.some((id, songIndex) => id !== previous.songIds[songIndex]);
    })
  ) {
    await ctx.db.patch('profiles', profile._id, { likedSongIds, libraries: nextLibraries, lastActiveAt: Date.now() });
  }
}

export const apply = mutation({
  args: { secret: v.string(), userId: v.string(), ops: v.array(libraryOp) },
  returns: v.object({
    rev: v.number(),
    rejected: v.array(v.object({ index: v.number(), reason: rejectReason })),
    superseded: v.array(v.number()),
    applied: v.number(),
    removedCoverKeys: v.array(v.string())
  }),
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const profile = await profileOf(ctx, args.userId);
    if (!profile) throw new Error('No profile');

    // First change for this listener: their profile's library becomes rows.
    let state = await stateOf(ctx, args.userId);
    const wasSeeded = !state;
    let changed = false;
    if (!state) {
      const seed = seedFromProfile(profile);
      for (const row of seed.likes) await ctx.db.insert('libraryLikes', { userId: args.userId, ...row });
      for (const row of seed.playlists) await ctx.db.insert('libraryPlaylists', { userId: args.userId, ...row });
      for (const row of seed.items) await ctx.db.insert('libraryItems', { userId: args.userId, ...row });
      const stateId = await ctx.db.insert('libraryState', { userId: args.userId, rev: seed.rev });
      state = await ctx.db.get('libraryState', stateId);
      if (!state) throw new Error('Library state missing');
      changed = true;
    }

    // Load exactly the rows this batch can touch.
    const ops = asOps(args.ops);
    const likeDocs = new Map<string, LikeDoc>();
    const playlistDocs = new Map<string, PlaylistDoc>();
    const itemDocs = new Map<string, ItemDoc>();
    for (const op of ops) {
      if (op.op === 'like' || op.op === 'unlike') {
        if (likeDocs.has(op.ref)) continue;
        const doc = await ctx.db
          .query('libraryLikes')
          .withIndex('by_userId_and_ref', (q) => q.eq('userId', args.userId).eq('ref', op.ref))
          .unique();
        if (doc) likeDocs.set(op.ref, doc);
        continue;
      }
      if (!playlistDocs.has(op.playlistId)) {
        const doc = await ctx.db
          .query('libraryPlaylists')
          .withIndex('by_userId_and_playlistId', (q) => q.eq('userId', args.userId).eq('playlistId', op.playlistId))
          .unique();
        if (doc) playlistDocs.set(op.playlistId, doc);
      }
      if (op.op === 'playlist_add' || op.op === 'playlist_remove') {
        const key = itemKey(op.playlistId, op.ref);
        if (itemDocs.has(key)) continue;
        const doc = await ctx.db
          .query('libraryItems')
          .withIndex('by_userId_and_playlistId_and_ref', (q) =>
            q.eq('userId', args.userId).eq('playlistId', op.playlistId).eq('ref', op.ref)
          )
          .unique();
        if (doc) itemDocs.set(key, doc);
      }
    }

    const view: LibraryRowsView = {
      like: (ref) => {
        const doc = likeDocs.get(ref);
        return doc ? likeRow(doc) : undefined;
      },
      playlist: (id) => {
        const doc = playlistDocs.get(id);
        return doc ? playlistRow(doc) : undefined;
      },
      item: (id, ref) => {
        const doc = itemDocs.get(itemKey(id, ref));
        return doc ? itemRow(doc) : undefined;
      }
    };
    const write = applyLibraryOps(view, ops, { now: Date.now(), rev: state.rev });

    for (const row of write.likes) {
      const doc = likeDocs.get(row.ref);
      if (doc) await ctx.db.replace('libraryLikes', doc._id, { userId: args.userId, ...row });
      else await ctx.db.insert('libraryLikes', { userId: args.userId, ...row });
    }
    for (const row of write.playlists) {
      const doc = playlistDocs.get(row.playlistId);
      if (doc) await ctx.db.replace('libraryPlaylists', doc._id, { userId: args.userId, ...row });
      else await ctx.db.insert('libraryPlaylists', { userId: args.userId, ...row });
    }
    for (const row of write.items) {
      const doc = itemDocs.get(itemKey(row.playlistId, row.ref));
      if (doc) await ctx.db.replace('libraryItems', doc._id, { userId: args.userId, ...row });
      else await ctx.db.insert('libraryItems', { userId: args.userId, ...row });
    }
    if (write.rev !== state.rev) {
      await ctx.db.patch('libraryState', state._id, { rev: write.rev });
      changed = true;
    }
    if (changed) {
      if (wasSeeded) await rebuildProfileCopy(ctx, args.userId, profile._id);
      else await updateProfileCopy(ctx, profile, write);
    }

    return {
      rev: write.rev,
      rejected: write.rejected,
      superseded: write.superseded,
      applied: write.applied,
      removedCoverKeys: write.removedCoverKeys
    };
  }
});

/** Everything after revision `since`, a page at a time. `seeded: false` means the library still lives only in the profile. */
export const changes = query({
  args: { secret: v.string(), userId: v.string(), since: v.number(), limit: v.number() },
  returns: v.object({ seeded: v.boolean(), rev: v.number(), changes: v.array(libraryChange), more: v.boolean() }),
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const state = await stateOf(ctx, args.userId);
    if (!state) return { seeded: false, rev: 0, changes: [], more: false };
    const limit = Math.max(1, Math.min(MAX_PAGE, Math.floor(args.limit)));
    const since = Math.max(0, args.since);
    const [likes, playlists, items] = await Promise.all([
      ctx.db.query('libraryLikes').withIndex('by_userId_and_rev', (q) => q.eq('userId', args.userId).gt('rev', since)).take(limit),
      ctx.db.query('libraryPlaylists').withIndex('by_userId_and_rev', (q) => q.eq('userId', args.userId).gt('rev', since)).take(limit),
      ctx.db.query('libraryItems').withIndex('by_userId_and_rev', (q) => q.eq('userId', args.userId).gt('rev', since)).take(limit)
    ]);
    const page = pageOfChanges([likes.map(likeRow), playlists.map(playlistRow), items.map(itemRow)], limit, state.rev);
    return {
      seeded: true,
      rev: page.next,
      changes: since === 0 ? page.changes.filter((change) => !isTombstone(change)) : page.changes,
      more: page.more
    };
  }
});

/**
 * The signed-in listener's newest library revision: a subscription to this is how the
 * website and the phone notice a change made on the other one. Null when signed out.
 */
export const myRev = query({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return (await stateOf(ctx, userId))?.rev ?? 0;
  }
});
