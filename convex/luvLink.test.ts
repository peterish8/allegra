/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api';
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

  it('allows controllers to pause and the leader to checkpoint a consumed queue entry', async () => {
    const t = backend();
    const host = asUser(t, 'users:queue-host');
    const guest = asUser(t, 'users:queue-guest');
    const { roomId, code } = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code, displayName: 'Guest' });
    await host.mutation(api.luvLink.setController, { roomId, targetUserId: 'users:queue-guest', canControl: true });
    const { entryId } = await host.mutation(api.luvLink.addQueueItem, { roomId, commandId: 'queue-add-test-001', song, next: false });
    await host.mutation(api.luvLink.publishPlayback, {
      roomId, commandId: 'queue-play-test-01', expectedLeaderEpoch: 1, expectedSequence: 0,
      trackEpoch: 1, intent: 'control', queueEntryId: entryId, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    });
    await host.mutation(api.luvLink.reportReady, { roomId, trackEpoch: 1, ready: true });
    await guest.mutation(api.luvLink.reportReady, { roomId, trackEpoch: 1, ready: true });
    const anchor = await host.query(api.luvLink.getPlayback, { roomId });
    const pause = await guest.mutation(api.luvLink.publishPlayback, {
      roomId, commandId: 'queue-pause-test-1', expectedLeaderEpoch: 1, expectedSequence: anchor!.sequence,
      trackEpoch: 1, intent: 'control', queueEntryId: entryId, song, positionSec: 12, playing: false, playbackRate: 1, effectiveAtMs: Date.now()
    });
    await host.mutation(api.luvLink.publishPlayback, {
      roomId, commandId: 'queue-checkpoint-1', expectedLeaderEpoch: 1, expectedSequence: pause.sequence,
      trackEpoch: 1, intent: 'checkpoint', queueEntryId: entryId, song, positionSec: 12, playing: false, playbackRate: 1, effectiveAtMs: Date.now()
    });
    await expectCode(host.mutation(api.luvLink.publishPlayback, {
      roomId, commandId: 'queue-reuse-test-1', expectedLeaderEpoch: 1, expectedSequence: pause.sequence + 1,
      trackEpoch: 2, intent: 'control', queueEntryId: entryId, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
    }), 'queue_item_missing');
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
    await host.mutation(api.luvLink.heartbeat, { roomId: created.roomId, sessionId: 'host-session-0001' });
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

  it('prevents changing room mode until the old speaker confirms its handoff', async () => {
    const t = backend();
    const host = asUser(t, 'users:handoff-host');
    const guest = asUser(t, 'users:handoff-guest');
    const { roomId, code } = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code, displayName: 'Guest' });
    await host.mutation(api.luvLink.setRoomMode, { roomId, mode: 'speaker' });
    await host.mutation(api.luvLink.heartbeat, { roomId, sessionId: 'host-session-0002' });
    const { leaderEpoch } = await host.mutation(api.luvLink.setSpeaker, { roomId, commandId: 'mode-handoff-test', targetUserId: 'users:handoff-guest' });
    await expectCode(host.mutation(api.luvLink.setRoomMode, { roomId, mode: 'listen' }), 'handoff_pending');
    await host.mutation(api.luvLink.acknowledgeSpeakerHandoff, { roomId, expectedLeaderEpoch: leaderEpoch });
    await host.mutation(api.luvLink.setRoomMode, { roomId, mode: 'listen' });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.mode).toBe('listen');
  });

  async function speakerRoom(t: ReturnType<typeof backend>, prefix: string) {
    const host = asUser(t, `users:${prefix}-host`);
    const guest = asUser(t, `users:${prefix}-guest`);
    const { roomId, code } = await host.mutation(api.luvLink.createRoom, { displayName: 'Host' });
    await guest.mutation(api.luvLink.joinRoom, { code, displayName: 'Guest' });
    await host.mutation(api.luvLink.setRoomMode, { roomId, mode: 'speaker' });
    await host.mutation(api.luvLink.setController, { roomId, targetUserId: `users:${prefix}-guest`, canControl: true });
    return { host, guest, roomId, code };
  }
  const play = (roomId: string, leaderEpoch: number, commandId: string) => ({
    roomId: roomId as never, commandId, expectedLeaderEpoch: leaderEpoch, expectedSequence: 0,
    trackEpoch: 1, intent: 'control' as const, queueEntryId: null, song, positionSec: 0, playing: true, playbackRate: 1, effectiveAtMs: Date.now()
  });

  it('hands the output straight to the new speaker when the old one is offline', async () => {
    const t = backend();
    const { host, guest, roomId } = await speakerRoom(t, 'offline');
    // The host (current output) never heartbeats: no live session, so nothing there can still be playing in step.
    const { leaderEpoch } = await host.mutation(api.luvLink.setSpeaker, { roomId, commandId: 'offline-move-001', targetUserId: 'users:offline-guest' });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBeNull();
    await guest.mutation(api.luvLink.publishPlayback, play(roomId, leaderEpoch, 'offline-play-0001'));
    expect((await guest.query(api.luvLink.getPlayback, { roomId }))?.leaderUserId).toBe('users:offline-guest');
  });

  it('releases a pending handoff once the old speaker goes offline without confirming', async () => {
    const t = backend();
    const { host, guest, roomId } = await speakerRoom(t, 'drop');
    const { sessionToken } = await host.mutation(api.luvLink.heartbeat, { roomId, sessionId: 'drop-host-session' });
    expect(await guest.query(api.luvLink.getPresence, { roomId })).toEqual(['users:drop-host']);
    const { leaderEpoch } = await host.mutation(api.luvLink.setSpeaker, { roomId, commandId: 'drop-move-0001', targetUserId: 'users:drop-guest' });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBe('users:drop-host');

    // Still online: the check keeps waiting for the pause confirmation and books another check.
    await t.mutation(internal.luvLink.checkSpeakerHandoff, { roomId, leaderEpoch, checks: 1 });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBe('users:drop-host');
    await expectCode(guest.mutation(api.luvLink.publishPlayback, play(roomId, leaderEpoch, 'drop-early-00001')), 'handoff_pending');

    await host.mutation(api.luvLink.disconnectPresence, { roomId, sessionToken });
    await t.mutation(internal.luvLink.checkSpeakerHandoff, { roomId, leaderEpoch, checks: 2 });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBeNull();
    await guest.mutation(api.luvLink.publishPlayback, play(roomId, leaderEpoch, 'drop-play-000001'));
  });

  it('ignores a handoff check or confirmation from an older speaker move', async () => {
    const t = backend();
    const { host, roomId } = await speakerRoom(t, 'stale');
    await host.mutation(api.luvLink.heartbeat, { roomId, sessionId: 'stale-host-session' });
    const { leaderEpoch } = await host.mutation(api.luvLink.setSpeaker, { roomId, commandId: 'stale-move-0001', targetUserId: 'users:stale-guest' });
    await t.mutation(internal.luvLink.checkSpeakerHandoff, { roomId, leaderEpoch: leaderEpoch - 1, checks: 1 });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBe('users:stale-host');
    await expectCode(host.mutation(api.luvLink.acknowledgeSpeakerHandoff, { roomId, expectedLeaderEpoch: leaderEpoch - 1 }), 'stale_handoff');
  });

  it('stops waiting for a member who owed a pause confirmation and then left', async () => {
    const t = backend();
    const { host, guest, roomId, code } = await speakerRoom(t, 'left');
    const third = asUser(t, 'users:left-third');
    await third.mutation(api.luvLink.joinRoom, { code, displayName: 'Third' });
    await host.mutation(api.luvLink.setController, { roomId, targetUserId: 'users:left-third', canControl: true });
    // The host offline: guest becomes the output at once. Then guest (online) hands over to the third member.
    await host.mutation(api.luvLink.setSpeaker, { roomId, commandId: 'left-move-00001', targetUserId: 'users:left-guest' });
    await guest.mutation(api.luvLink.heartbeat, { roomId, sessionId: 'left-guest-session' });
    const { leaderEpoch } = await host.mutation(api.luvLink.setSpeaker, { roomId, commandId: 'left-move-00002', targetUserId: 'users:left-third' });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBe('users:left-guest');
    await guest.mutation(api.luvLink.leaveRoom, { roomId });
    expect((await host.query(api.luvLink.getRoom, { roomId }))?.handoffFromUserId).toBeNull();
    await third.mutation(api.luvLink.publishPlayback, play(roomId, leaderEpoch, 'left-play-000001'));
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
