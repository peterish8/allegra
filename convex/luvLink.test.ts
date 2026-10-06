/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = { ...import.meta.glob('./**/*.ts'), ...import.meta.glob('./_generated/*.js') };
const song = { ref: 'saavn:test', title: 'Test track', artist: 'LuvLink', artwork: 'https://example.test/cover.jpg', duration: 180 };

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}
function asUser(t: ReturnType<typeof backend>, userId: string) {
  return t.withIdentity({ subject: `${userId}|luvlink-test-session` });
}
function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ data: expect.objectContaining({ code }) });
}

afterEach(() => vi.useRealTimers());

describe('LuvLink rooms', () => {
  it('requires identity and hides room data from non-members', async () => {
    const t = backend();
    await expectCode(t.mutation(api.luvLink.createRoom, { displayName: 'Host' }), 'unauthenticated');
    const host = asUser(t, 'users:host');
    const outsider = asUser(t, 'users:outsider');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await expect(outsider.query(api.luvLink.getRoom, { roomId: created.roomId })).resolves.toBeNull();
    await expectCode(outsider.query(api.luvLink.getQueue, { roomId: created.roomId }), 'not_a_member');
    const guest = await asUser(t, 'users:guest').mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Guest' });
    await expect(guest.role).toBe('member');
    await host.mutation(api.luvLink.revokeInvite, { roomId: created.roomId });
    await expectCode(outsider.mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Late' }), 'invite_unavailable');
  });

  it('commits distinct ordered entries and makes a retried queue add idempotent', async () => {
    const t = backend();
    const host = asUser(t, 'users:host');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    const first = await host.mutation(api.luvLink.addQueueItem, { roomId: created.roomId, commandId: 'command-add-0001', song, next: false });
    const retry = await host.mutation(api.luvLink.addQueueItem, { roomId: created.roomId, commandId: 'command-add-0001', song, next: false });
    const repeated = await host.mutation(api.luvLink.addQueueItem, { roomId: created.roomId, commandId: 'command-add-0002', song, next: false });
    expect(retry).toEqual(first);
    expect(repeated.entryId).not.toBe(first.entryId);
    const queue = await host.query(api.luvLink.getQueue, { roomId: created.roomId });
    expect(queue.entries.map(row => row.entryId)).toEqual([first.entryId, repeated.entryId]);
    await expectCode(host.mutation(api.luvLink.removeQueueItem, {
      roomId: created.roomId, commandId: 'command-remove-1', entryId: first.entryId, expectedRevision: 0
    }), 'stale_revision');
  });

  it('builds bounded Blend-ranked group picks only from opted-in members and clears cache on withdrawal', async () => {
    const t = backend();
    const host = asUser(t, 'users:host');
    const guest = asUser(t, 'users:guest');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Guest' });
    await t.run(async ctx => {
      await ctx.db.insert('profiles', { userId: 'users:guest', isGuest: false, createdAt: new Date().toISOString(), libraries: [], likedSongIds: [], recentlyPlayed: [], settings: { personalization: true } });
    });
    const addTaste = async (userId: string, n: number, title: string, artist: string): Promise<void> => {
      await t.run(async (ctx) => {
        await ctx.db.insert('tasteSongs', {
          userId, identity: `${title}|${artist}`, ref: `saavn:${n}`, title, artist, artwork: '', duration: 180,
          score: 100_000, likeBonus: false, recentListens: [], updatedAt: Date.now()
        });
      });
    };
    await addTaste('users:host', 1, 'Common song', 'Artist A');
    await addTaste('users:host', 2, 'Host song', 'Artist B');
    await addTaste('users:guest', 1, 'Common song', 'Artist A');
    await addTaste('users:guest', 3, 'Guest song', 'Artist C');
    await host.mutation(api.luvLink.setSuggestionsConsent, { roomId: created.roomId, enabled: true });
    await guest.mutation(api.luvLink.setSuggestionsConsent, { roomId: created.roomId, enabled: true });

    const built = await host.mutation(api.luvLink.refreshGroupPicks, { roomId: created.roomId });
    expect(built.picks.some(pick => pick.kind === 'shared' && pick.forUserIds.length === 2)).toBe(true);
    await expect(host.query(api.luvLink.getGroupPicks, { roomId: created.roomId })).resolves.toEqual(built);
    await t.run(async ctx => {
      const profile = await ctx.db.query('profiles').withIndex('by_userId', q => q.eq('userId', 'users:guest')).unique();
      if (profile) await ctx.db.patch(profile._id, { settings: { personalization: false } });
    });
    const afterGlobalOptOut = await host.query(api.luvLink.getGroupPicks, { roomId: created.roomId });
    expect(afterGlobalOptOut.picks.every(pick => !pick.forUserIds.includes('users:guest'))).toBe(true);
    await guest.mutation(api.luvLink.setSuggestionsConsent, { roomId: created.roomId, enabled: false });
    expect(await host.query(api.luvLink.getGroupPicks, { roomId: created.roomId })).toEqual({ revision: built.revision + 1, picks: [] });

    await t.run(async ctx => {
      const cache = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', created.roomId)).unique();
      expect(cache).toBeNull();
    });
  });

  it('fences playback by leader epoch and releases a barrier after eligible listeners are ready', async () => {
    const t = backend();
    const host = asUser(t, 'users:host');
    const guest = asUser(t, 'users:guest');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Guest' });
    const first = await host.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'playback-command-001', expectedLeaderEpoch: 1, expectedSequence: 0,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    });
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.playing).toBe(false);
    await guest.mutation(api.luvLink.reportReady, { roomId: created.roomId, trackEpoch: 1, ready: true });
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.playing).toBe(false);
    await host.mutation(api.luvLink.reportReady, { roomId: created.roomId, trackEpoch: 1, ready: true });
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.playing).toBe(true);
    await expectCode(host.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'stale-leader-0001', expectedLeaderEpoch: 0, expectedSequence: first.sequence,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 1, playing: false, playbackRate: 1, effectiveAtMs: Date.now()
    }), 'stale_leader');
  });

  it('keeps one barrier per room across several track changes', async () => {
    const t = backend();
    const host = asUser(t, 'users:host');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    let sequence = 0;
    for (let trackEpoch = 1; trackEpoch <= 3; trackEpoch += 1) {
      const published = await host.mutation(api.luvLink.publishPlayback, {
        roomId: created.roomId, commandId: `track-change-000${trackEpoch}`, expectedLeaderEpoch: 1, expectedSequence: sequence,
        trackEpoch, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
      });
      await host.mutation(api.luvLink.reportReady, { roomId: created.roomId, trackEpoch, ready: true });
      sequence = (await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.sequence ?? published.sequence;
    }
    const barriers = await t.run(ctx => ctx.db.query('luvLinkBarriers').collect());
    expect(barriers).toHaveLength(1);
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.trackEpoch).toBe(3);
  });

  it('stops new rooms when creation is disabled but keeps open rooms usable', async () => {
    const t = backend();
    const host = asUser(t, 'users:host');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    vi.stubEnv('LUVLINK_CREATION_DISABLED', 'true');
    try {
      await expectCode(asUser(t, 'users:other').mutation(api.luvLink.createRoom, { displayName: 'Other' }), 'creation_disabled');
      await asUser(t, 'users:guest').mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Guest' });
      await asUser(t, 'users:guest').mutation(api.luvLink.leaveRoom, { roomId: created.roomId });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses a scheduled deadline and preserves a pause that supersedes a pending barrier', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 6));
    const t = backend();
    const host = asUser(t, 'users:host');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    const start = await host.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'playback-start-0001', expectedLeaderEpoch: 1, expectedSequence: 0,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    });
    await host.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'playback-pause-0001', expectedLeaderEpoch: 1, expectedSequence: start.sequence,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: false, playbackRate: 1, effectiveAtMs: Date.now()
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.playing).toBe(false);
  });

  it('releases a still-current ready barrier at its durable deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 6));
    const t = backend();
    const host = asUser(t, 'users:deadline-host');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await host.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'deadline-play-001', expectedLeaderEpoch: 1, expectedSequence: 0,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    });
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.playing).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.playing).toBe(true);
  });

  it('waits for the old speaker to pause, keeps the elected identity, and consumes the committed queue entry', async () => {
    const t = backend();
    const host = asUser(t, 'users:speaker-host');
    const guest = asUser(t, 'users:speaker-guest');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Guest' });
    await host.mutation(api.luvLink.setRoomMode, { roomId: created.roomId, mode: 'speaker' });
    await host.mutation(api.luvLink.setController, { roomId: created.roomId, targetUserId: 'users:speaker-guest', canControl: true });
    const handoff = await host.mutation(api.luvLink.setSpeaker, { roomId: created.roomId, commandId: 'speaker-move-0001', targetUserId: 'users:speaker-guest' });
    await expectCode(guest.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'handoff-early-001', expectedLeaderEpoch: handoff.leaderEpoch, expectedSequence: 0,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    }), 'handoff_pending');
    await host.mutation(api.luvLink.acknowledgeSpeakerHandoff, { roomId: created.roomId, expectedLeaderEpoch: handoff.leaderEpoch });
    await guest.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'speaker-play-0001', expectedLeaderEpoch: handoff.leaderEpoch, expectedSequence: 0,
      trackEpoch: 1, intent: 'control', queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    });
    expect((await host.query(api.luvLink.getPlayback, { roomId: created.roomId }))?.leaderUserId).toBe('users:speaker-guest');
    await expectCode(host.mutation(api.luvLink.reportReady, { roomId: created.roomId, trackEpoch: 1, ready: true }), 'not_output');
    await guest.mutation(api.luvLink.reportReady, { roomId: created.roomId, trackEpoch: 1, ready: true });
    const playingAnchor = await guest.query(api.luvLink.getPlayback, { roomId: created.roomId });
    expect(playingAnchor?.playing).toBe(true);
    const nextSong = { ...song, ref: 'saavn:next', title: 'Next song' };
    const queued = await guest.mutation(api.luvLink.addQueueItem, { roomId: created.roomId, commandId: 'speaker-queue-001', song: nextSong, next: false });
    await expectCode(host.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'speaker-host-natural-001', expectedLeaderEpoch: handoff.leaderEpoch, expectedSequence: playingAnchor!.sequence,
      trackEpoch: 2, intent: 'natural_end', queueEntryId: queued.entryId, song: nextSong, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    }), 'not_leader');
    await guest.mutation(api.luvLink.publishPlayback, {
      roomId: created.roomId, commandId: 'speaker-next-0001', expectedLeaderEpoch: handoff.leaderEpoch, expectedSequence: playingAnchor!.sequence,
      trackEpoch: 2, intent: 'natural_end', queueEntryId: queued.entryId, song: nextSong, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    });
    expect((await host.query(api.luvLink.getQueue, { roomId: created.roomId })).entries).toHaveLength(0);
  });

  it('revokes member reads immediately when a listener leaves', async () => {
    const t = backend();
    const host = asUser(t, 'users:leave-host');
    const guest = asUser(t, 'users:leave-guest');
    const created = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code: created.code, displayName: 'Guest' });
    await guest.mutation(api.luvLink.leaveRoom, { roomId: created.roomId });
    await expectCode(guest.query(api.luvLink.getQueue, { roomId: created.roomId }), 'not_a_member');
  });
});
