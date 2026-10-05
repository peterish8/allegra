/**
 * The bounded, forward-decayed song tally used by Blend. The Express API calls these secret-guarded
 * functions; each write is safe to repeat, and the rows are derived listening data erased with the account.
 */
import { addDecayed, listenAmount, TALLY_MAX_SONGS, TALLY_RECENT_LISTENS, TALLY_AMOUNT } from '../packages/shared/blendDecay';
import { identityKey } from '../packages/shared/identity';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { requireSecret } from './profiles';
import { v, type Infer } from 'convex/values';

const snapshot = v.object({
  ref: v.string(),
  title: v.string(),
  artist: v.string(),
  album: v.optional(v.string()),
  artwork: v.string(),
  duration: v.number()
});

type SongSnapshot = Infer<typeof snapshot>;
type TasteMark = Partial<Pick<Doc<'tasteSongs'>, 'likeBonus' | 'likeBonusAt' | 'recentListens' | 'recentPlayEvents' | 'seedLikeBonusAt' | 'playlistMemberships'>>;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

async function meta(ctx: MutationCtx, userId: string): Promise<Doc<'tasteMeta'>> {
  const existing = await ctx.db.query('tasteMeta').withIndex('by_userId', (q) => q.eq('userId', userId)).unique();
  if (existing) return existing;
  const id = await ctx.db.insert('tasteMeta', { userId, songCount: 0, updatedAt: Date.now() });
  const created = await ctx.db.get('tasteMeta', id);
  if (!created) throw new Error('Taste metadata could not be created');
  return created;
}

async function rowOf(ctx: MutationCtx, userId: string, identity: string): Promise<Doc<'tasteSongs'> | null> {
  return ctx.db.query('tasteSongs')
    .withIndex('by_userId_and_identity', (q) => q.eq('userId', userId).eq('identity', identity))
    .unique();
}

async function learningEnabled(ctx: MutationCtx, userId: string): Promise<boolean> {
  const profile = await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', userId)).unique();
  return profile?.settings?.personalization !== false;
}

async function evictIfOver(ctx: MutationCtx, userId: string, metaDoc: Doc<'tasteMeta'>): Promise<void> {
  let songCount = metaDoc.songCount;
  let evicted = 0;
  while (songCount > TALLY_MAX_SONGS && evicted < 5) {
    const lowest = await ctx.db.query('tasteSongs')
      .withIndex('by_userId_and_score', (q) => q.eq('userId', userId))
      .order('asc')
      .take(1);
    const row = lowest[0];
    if (!row) {
      songCount = 0;
      break;
    }
    await ctx.db.delete('tasteSongs', row._id);
    songCount -= 1;
    evicted += 1;
  }
  if (songCount !== metaDoc.songCount) {
    await ctx.db.patch('tasteMeta', metaDoc._id, { songCount, updatedAt: Date.now() });
  }
}

/** Insert or update one identity; metadata and the 200-row cap move in the same transaction. */
async function addToRow(
  ctx: MutationCtx,
  userId: string,
  song: SongSnapshot,
  amount: number,
  atMs: number,
  mark: TasteMark = {}
): Promise<void> {
  const identity = identityKey(song.title, song.artist);
  const row = await rowOf(ctx, userId, identity);
  const score = addDecayed(row?.score ?? 0, amount, atMs);
  const now = Date.now();

  if (!row && score <= 0) return;

  const metadata = await meta(ctx, userId);
  if (row && score <= 0) {
    await ctx.db.delete('tasteSongs', row._id);
    await ctx.db.patch('tasteMeta', metadata._id, {
      songCount: Math.max(0, metadata.songCount - 1),
      updatedAt: now
    });
    return;
  }

  if (row) {
    await ctx.db.patch('tasteSongs', row._id, {
      ref: song.ref,
      title: song.title,
      artist: song.artist,
      artwork: song.artwork,
      duration: song.duration,
      score,
      updatedAt: now,
      ...mark
    });
    await ctx.db.patch('tasteMeta', metadata._id, { updatedAt: now });
    return;
  }

  const newCount = metadata.songCount + 1;
  await ctx.db.insert('tasteSongs', {
    userId,
    identity,
    ref: song.ref,
    title: song.title,
    artist: song.artist,
    artwork: song.artwork,
    duration: song.duration,
    score,
    likeBonus: mark.likeBonus ?? false,
      ...(mark.likeBonusAt !== undefined ? { likeBonusAt: mark.likeBonusAt } : {}),
      ...(mark.seedLikeBonusAt !== undefined ? { seedLikeBonusAt: mark.seedLikeBonusAt } : {}),
      ...(mark.playlistMemberships !== undefined ? { playlistMemberships: mark.playlistMemberships } : {}),
      ...(mark.recentPlayEvents !== undefined ? { recentPlayEvents: mark.recentPlayEvents } : {}),
    recentListens: mark.recentListens ?? [],
    updatedAt: now
  });
  await ctx.db.patch('tasteMeta', metadata._id, { songCount: newCount, updatedAt: now });
  await evictIfOver(ctx, userId, { ...metadata, songCount: newCount, updatedAt: now });
}

/** Delete one bounded batch; continue through an internal mutation when another batch may remain. */
async function clearSome(ctx: MutationCtx, userId: string): Promise<void> {
  const rows = await ctx.db.query('tasteSongs')
    .withIndex('by_userId_and_identity', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of rows) await ctx.db.delete('tasteSongs', row._id);

  if (rows.length === BATCH) {
    await ctx.scheduler.runAfter(0, internal.taste.clearRest, { userId });
    return;
  }
  const metadata = await ctx.db.query('tasteMeta').withIndex('by_userId', (q) => q.eq('userId', userId)).unique();
  if (metadata) await ctx.db.delete('tasteMeta', metadata._id);
}

export const record = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    song: snapshot,
    secondsHeard: v.number(),
    playedAt: v.number(),
    playId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!await learningEnabled(ctx, args.userId)) return { applied: false };
    const now = Date.now();
    if (!Number.isFinite(args.playedAt) || !Number.isFinite(args.secondsHeard)) return { applied: false };
    const playedAt = Math.min(args.playedAt, now);
    if (now - playedAt > 30 * DAY_MS) return { applied: false };

    const identity = identityKey(args.song.title, args.song.artist);
    const row = await rowOf(ctx, args.userId, identity);
    let amount = listenAmount(args.secondsHeard, args.song.duration);
    let recentPlayEvents = row?.recentPlayEvents ?? [];
    const identityAt = args.playedAt;
    let signalAt = playedAt;
    if (args.playId) {
      if (args.playId.length > 128) return { applied: false };
      const prior = recentPlayEvents.find((event) => event.playId === args.playId);
      if (prior) {
        if (args.secondsHeard <= prior.maxSeconds) return { applied: false };
        amount -= listenAmount(prior.maxSeconds, args.song.duration);
        signalAt = prior.playedAt;
        recentPlayEvents = recentPlayEvents.filter((event) => event.playId !== args.playId);
      } else if (row?.recentListens.includes(identityAt)) return { applied: false };
      recentPlayEvents = [...recentPlayEvents, { playId: args.playId, maxSeconds: args.secondsHeard, playedAt: signalAt }].slice(-16);
    } else if (row?.recentListens.includes(identityAt)) return { applied: false };
    const recentListens = args.playId ? (row?.recentListens ?? []) : [...(row?.recentListens ?? []), identityAt].slice(-TALLY_RECENT_LISTENS);
    await addToRow(ctx, args.userId, args.song, amount, signalAt, { recentListens, ...(args.playId ? { recentPlayEvents } : {}) });
    return { applied: true };
  }
});

export const bonus = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    song: snapshot,
    kind: v.union(v.literal('like'), v.literal('unlike'), v.literal('playlistAdd')),
    at: v.number()
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!await learningEnabled(ctx, args.userId)) return null;
    const identity = identityKey(args.song.title, args.song.artist);
    const row = await rowOf(ctx, args.userId, identity);
    if (args.kind === 'like') {
      if (row?.likeBonus) return null;
      await addToRow(ctx, args.userId, args.song, TALLY_AMOUNT.likeBonus, args.at, { likeBonus: true, likeBonusAt: args.at });
      return null;
    }
    if (args.kind === 'unlike') {
      if (!row?.likeBonus) return null;
      const likeAt = row.likeBonusAt ?? args.at;
      await addToRow(ctx, args.userId, args.song, -TALLY_AMOUNT.likeBonus, likeAt, {
        likeBonus: false,
        likeBonusAt: undefined,
        seedLikeBonusAt: undefined
      });
      return null;
    }
    await addToRow(ctx, args.userId, args.song, TALLY_AMOUNT.playlistAdd, args.at);
    return null;
  }
});

export const seed = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    likes: v.array(v.object({ song: snapshot, at: v.number() })),
    items: v.array(v.object({ song: snapshot, at: v.number() })),
    recents: v.array(v.object({ song: snapshot, at: v.number() }))
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!await learningEnabled(ctx, args.userId)) return null;
    const metadata = await meta(ctx, args.userId);
    if (metadata.seededAt !== undefined) return null;
    if (args.likes.length > 200 || args.items.length > 300 || args.recents.length > 25) {
      throw new Error('Taste seed exceeds its maximum size');
    }
    for (const { song, at } of args.likes) {
      const row = await rowOf(ctx, args.userId, identityKey(song.title, song.artist));
      if (!row?.likeBonus) await addToRow(ctx, args.userId, song, TALLY_AMOUNT.likeBonus, at, { likeBonus: true, likeBonusAt: at, seedLikeBonusAt: at });
    }
    for (const { song, at } of args.items) await addToRow(ctx, args.userId, song, TALLY_AMOUNT.playlistAdd, at);
    for (const { song, at } of args.recents) await addToRow(ctx, args.userId, song, TALLY_AMOUNT.seedRecent, at);
    const current = await meta(ctx, args.userId);
    await ctx.db.patch('tasteMeta', current._id, { seededAt: Date.now(), updatedAt: Date.now() });
    return null;
  }
});

export const top = query({
  args: { secret: v.string(), userId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const profile = await ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', args.userId)).unique();
    if (profile?.settings?.personalization === false) return [];
    const limit = Math.max(0, Math.min(200, Math.floor(args.limit)));
    const rows = await ctx.db.query('tasteSongs')
      .withIndex('by_userId_and_score', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(limit);
    return rows.map(({ identity, ref, title, artist, artwork, duration, score }) => ({
      identity, ref, title, artist, artwork, duration, score
    }));
  }
});

export const clear = mutation({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await clearSome(ctx, args.userId);
    return null;
  }
});

export const clearRest = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await clearSome(ctx, args.userId);
    return null;
  }
});
