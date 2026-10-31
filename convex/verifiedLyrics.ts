import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';

import { requireSecret } from './profiles';
import { lyricsVersion } from './schema';
import { RateLimiter } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';

const pasteLimiter = new RateLimiter(components.rateLimiter, {
  pasteAttempts: { kind: 'fixed window', rate: 5, period: 300_000 },
  pasteGlobal: { kind: 'fixed window', rate: 60, period: 300_000 }
});

export const createPasted = mutation({
  args: { secret: v.string(), id: v.string(), ref: v.string(), userId: v.string(), language: v.string(), lines: v.array(v.string()), passcode: v.string() },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const perUser = await pasteLimiter.limit(ctx, 'pasteAttempts', { key: args.userId });
    const global = await pasteLimiter.limit(ctx, 'pasteGlobal', { key: 'all' });
    // Return rejection so rate-limit writes commit, including wrong passcodes.
    if (!perUser.ok || !global.ok) return { allowed: false };
    const expected = process.env.LYRICS_ADMIN_PASSCODE_SHA256;
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected) || args.passcode.length > 256) return { allowed: false };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(args.passcode));
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.toLowerCase().charCodeAt(i);
    if (difference !== 0) return { allowed: false };
    if (!args.userId || !/^(saavn|gaana):[^:]{1,70}$/.test(args.ref) || !/^[a-f0-9]{64}$/.test(args.id)
      || args.language.length > 40 || !args.lines.length || args.lines.length > 3000
      || args.lines.join('\n').length > 24_000 || args.lines.some(line => !line.trim())
      || args.lines.flatMap(line => line.split(/\s+/u)).length > 3000
      || /[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\p{Z}\s]/u.test(args.lines.join(' '))) return { allowed: false };
    const existing = await ctx.db.query('pastedLyrics').withIndex('by_candidateId_and_userId_and_ref',
      q => q.eq('candidateId', args.id).eq('userId', args.userId).eq('ref', args.ref)).unique();
    if (!existing) await ctx.db.insert('pastedLyrics', { candidateId: args.id, ref: args.ref, userId: args.userId,
      language: args.language, lines: args.lines, createdAt: Date.now() });
    return { allowed: true };
  }
});

export const getPasted = query({
  args: { secret: v.string(), id: v.string(), ref: v.string(), userId: v.string() },
  returns: v.union(v.null(), v.object({ language: v.string(), lines: v.array(v.string()) })),
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('pastedLyrics').withIndex('by_candidateId_and_userId_and_ref',
      q => q.eq('candidateId', args.id).eq('userId', args.userId).eq('ref', args.ref)).unique();
    return row ? { language: row.language, lines: row.lines } : null;
  }
});

/**
 * Lyrics listeners synced on their own computers and confirmed, shared with everyone who plays the
 * song. Only the API calls these (with the server secret): it holds the words, checks every
 * submission and decides what listeners see. Rules: one row per recording, one version per script,
 * a new sync replaces a version only when it is more confident, and a version reported by
 * REPORTS_TO_HIDE different listeners hides itself until the owner restores it.
 */

export const REPORTS_TO_HIDE = 3;
/** About ten times a long song's enhanced LRC; anything bigger is not lyrics. */
const MAX_LRC_CHARS = 200_000;

const song = v.object({
  ref: v.string(),
  matchKey: v.string(),
  title: v.string(),
  artist: v.string(),
  duration: v.number()
});
const submission = lyricsVersion.omit('syncedAt', 'reportedBy', 'hidden');
const script = lyricsVersion.fields.script;

type Row = Doc<'verifiedLyrics'>;
type Version = Row['versions'][number];

function view(row: Row): Omit<Row, '_id' | '_creationTime'> {
  const { _id, _creationTime, ...rest } = row;
  return rest;
}

/** Latin first, so the version listeners see by default leads. */
function ordered(versions: readonly Version[]): Version[] {
  return [...versions].sort((left, right) => Number(left.script !== 'latin') - Number(right.script !== 'latin'));
}

export const get = query({
  args: { secret: v.string(), ref: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('verifiedLyrics')
      .withIndex('by_ref', (q) => q.eq('ref', args.ref))
      .unique();
    return row ? view(row) : null;
  }
});

export const byMatchKey = query({
  args: { secret: v.string(), matchKey: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('verifiedLyrics')
      .withIndex('by_matchKey', (q) => q.eq('matchKey', args.matchKey))
      .first();
    return row ? view(row) : null;
  }
});

export const submit = mutation({
  args: { secret: v.string(), song, version: submission },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const { version } = args;
    if (!args.song.ref || !args.song.matchKey || !version.lrc || version.lrc.length > MAX_LRC_CHARS) {
      throw new Error('Invalid lyrics');
    }
    if (!Number.isFinite(version.confidence) || version.confidence < 0 || version.confidence > 1) {
      throw new Error('Invalid confidence');
    }
    const now = Date.now();
    const incoming: Version = { ...version, syncedAt: now, reportedBy: [], hidden: false };
    const row = await ctx.db
      .query('verifiedLyrics')
      .withIndex('by_ref', (q) => q.eq('ref', args.song.ref))
      .unique();
    if (!row) {
      await ctx.db.insert('verifiedLyrics', { ...args.song, versions: [incoming], updatedAt: now });
      return { saved: true };
    }
    const existing = row.versions.find((item) => item.script === version.script);
    if (existing && !existing.hidden && existing.confidence >= version.confidence) {
      return { saved: false };
    }
    const versions = ordered([...row.versions.filter((item) => item.script !== version.script), incoming]);
    await ctx.db.patch('verifiedLyrics', row._id, { ...args.song, versions, updatedAt: now });
    return { saved: true };
  }
});

export const report = mutation({
  args: { secret: v.string(), ref: v.string(), script, reporter: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('verifiedLyrics')
      .withIndex('by_ref', (q) => q.eq('ref', args.ref))
      .unique();
    const target = row?.versions.find((item) => item.script === args.script);
    if (!row || !target) return { found: false, hidden: false };
    // Hidden versions stop counting; the owner decides from here.
    if (target.hidden || target.reportedBy.includes(args.reporter)) return { found: true, hidden: target.hidden };
    const reportedBy = [...target.reportedBy, args.reporter];
    const hidden = reportedBy.length >= REPORTS_TO_HIDE;
    const versions = row.versions.map((item) => (item.script === args.script ? { ...item, reportedBy, hidden } : item));
    await ctx.db.patch('verifiedLyrics', row._id, { versions, updatedAt: Date.now() });
    return { found: true, hidden };
  }
});

/** The owner's switch. Restoring a version clears its reports. */
export const setHidden = mutation({
  args: { secret: v.string(), ref: v.string(), script, hidden: v.boolean() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('verifiedLyrics')
      .withIndex('by_ref', (q) => q.eq('ref', args.ref))
      .unique();
    if (!row || !row.versions.some((item) => item.script === args.script)) return { found: false };
    const versions = row.versions.map((item) =>
      item.script === args.script ? { ...item, hidden: args.hidden, reportedBy: args.hidden ? item.reportedBy : [] } : item
    );
    await ctx.db.patch('verifiedLyrics', row._id, { versions, updatedAt: Date.now() });
    return { found: true };
  }
});
