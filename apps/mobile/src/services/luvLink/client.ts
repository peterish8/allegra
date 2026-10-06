import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { estimateLuvLinkClockOffset, type LuvLinkMemberSnapshot, type LuvLinkPlaybackAnchor, type LuvLinkQueueEntry, type LuvLinkQueueSnapshot, type LuvLinkRoomSnapshot } from '@shared/luvLink';
import type { SongSnapshot } from '@shared/songRef';
import { fromAllegraSong } from '@shared/songRef';
import { allegraConvex } from '../account/AccountProvider';
import { useLuvLinkStore } from '../../store/luvLinkStore';

type RoomId = Id<'luvLinkRooms'>;
export type OwnedLuvLinkGroupPicks = FunctionReturnType<typeof api.luvLink.getGroupPicks>;
const state = () => useLuvLinkStore.getState();
const commandId = (): string => `ll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const roomId = (): RoomId => {
  const value = state().ownedRoomId;
  if (!value) throw new Error('Join a LuvLink first.');
  return value as RoomId;
};

let stopRoomWatches: (() => void) | null = null;
let observedRoomId: string | null = null;
let stopStoreWatch: (() => void) | null = null;
let stopAppState: { remove: () => void } | null = null;
let publishTail: Promise<void> = Promise.resolve();
let presenceInterval: ReturnType<typeof setInterval> | null = null;
let presenceSessionId: string | null = null;
let presenceRoomId: string | null = null;
let presenceSessionToken: string | null = null;

const presenceKey = (id: string) => `luvlink_presence_${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;

function subscribeRoom(id: RoomId): void {
  if (observedRoomId === id) return;
  stopRoomWatches?.();
  observedRoomId = id;
  state().setOwnedRoomId(id);

  const room = allegraConvex.watchQuery(api.luvLink.getRoom, { roomId: id });
  const members = allegraConvex.watchQuery(api.luvLink.getMembers, { roomId: id });
  const queue = allegraConvex.watchQuery(api.luvLink.getQueue, { roomId: id });
  const playback = allegraConvex.watchQuery(api.luvLink.getPlayback, { roomId: id });
  const presence = allegraConvex.watchQuery(api.luvLink.getPresence, { roomId: id });
  let cancelled = false;
  const updateRoom = (): void => {
    if (cancelled) return;
    try {
      const nextRoom = room.localQueryResult();
      if (nextRoom === null) {
        state().setOwnedRoomId(null);
        state().announce('This LuvLink has ended or your access changed.');
        return;
      }
      useLuvLinkStore.setState({ ownedRoom: nextRoom as LuvLinkRoomSnapshot, ownedConnection: 'connected' });
    } catch { /* The initial query is pending, or Convex will report its error on a later update. */ }
  };
  const updateMembers = (): void => {
    try {
      const next = members.localQueryResult() as LuvLinkMemberSnapshot[];
      useLuvLinkStore.setState(current => ({
        ownedMembers: next,
        ownedUserId: current.ownedUserId,
      }));
    } catch { /* pending */ }
  };
  const updateQueue = (): void => { try { useLuvLinkStore.setState({ ownedQueue: queue.localQueryResult() as LuvLinkQueueSnapshot }); } catch { /* pending */ } };
  const updatePlayback = (): void => { try { useLuvLinkStore.setState({ ownedPlayback: playback.localQueryResult() as LuvLinkPlaybackAnchor | null }); } catch { /* pending */ } };
  const updatePresence = (): void => { try { useLuvLinkStore.setState({ ownedPresence: presence.localQueryResult() as string[] }); } catch { /* pending */ } };
  const off = [
    room.onUpdate(updateRoom), members.onUpdate(updateMembers), queue.onUpdate(updateQueue), playback.onUpdate(updatePlayback), presence.onUpdate(updatePresence),
  ];
  updateRoom(); updateMembers(); updateQueue(); updatePlayback(); updatePresence();
  stopRoomWatches = () => { cancelled = true; off.forEach(unsubscribe => unsubscribe()); };
  sampleClock(id).catch(() => undefined);
  startPresence(id).catch(() => undefined);
}

async function startPresence(id: RoomId): Promise<void> {
  if (presenceRoomId === id && presenceInterval) return;
  await disconnectPresence();
  presenceRoomId = id;
  presenceSessionId = commandId();
  const key = presenceKey(id);
  presenceSessionToken = await SecureStore.getItemAsync(key).catch(() => null);
  const heartbeat = async () => {
    if (!presenceRoomId || presenceRoomId !== id || !state().ownedRoomId) return;
    try {
      const result = await allegraConvex.mutation(api.luvLink.heartbeat, { roomId: id, sessionId: presenceSessionId! });
      presenceSessionToken = result.sessionToken;
      await SecureStore.setItemAsync(key, result.sessionToken);
    } catch { /* Convex retries on reconnect; presence never gates playback. */ }
  };
  await heartbeat();
  presenceInterval = setInterval(() => { if (AppState.currentState === 'active') void heartbeat(); }, 60_000);
}

async function disconnectPresence(): Promise<void> {
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = null;
  const id = presenceRoomId;
  const token = presenceSessionToken;
  presenceRoomId = null; presenceSessionId = null; presenceSessionToken = null;
  if (id && token) {
    await allegraConvex.mutation(api.luvLink.disconnectPresence, { roomId: id as RoomId, sessionToken: token }).catch(() => undefined);
    await SecureStore.deleteItemAsync(presenceKey(id)).catch(() => undefined);
  }
}

async function sampleClock(id: RoomId): Promise<void> {
  const samples: { clientSentAtMs: number; serverAtMs: number; clientReceivedAtMs: number }[] = [];
  for (let i = 0; i < 3; i += 1) {
    const sentAt = Date.now();
    try {
      const { serverAtMs } = await allegraConvex.mutation(api.luvLink.getServerTime, { roomId: id });
      const receivedAt = Date.now();
      samples.push({ clientSentAtMs: sentAt, serverAtMs, clientReceivedAtMs: receivedAt });
      useLuvLinkStore.setState({ wallMinusMonotonicMs: receivedAt - performance.now() });
    } catch { return; }
  }
  if (samples.length) useLuvLinkStore.setState({ clockOffsetMs: estimateLuvLinkClockOffset(samples) });
}

export function startOwnedLuvLinkClient(userId: string): () => void {
  useLuvLinkStore.setState({ ownedUserId: userId });
  const attach = (): void => {
    const id = state().ownedRoomId;
    if (id) subscribeRoom(id as RoomId);
  };
  attach();
  stopStoreWatch = useLuvLinkStore.subscribe(next => {
    if (next.ownedRoomId && next.ownedRoomId !== observedRoomId) subscribeRoom(next.ownedRoomId as RoomId);
    else if (!next.ownedRoomId && observedRoomId) {
      stopRoomWatches?.(); stopRoomWatches = null; observedRoomId = null;
    }
  });
  stopAppState = AppState.addEventListener('change', next => {
    if (next === 'active' && observedRoomId) {
      const currentId = observedRoomId as RoomId;
      sampleClock(currentId).then(async () => {
        const fresh = await allegraConvex.query(api.luvLink.getPlayback, { roomId: currentId });
        useLuvLinkStore.setState({ ownedPlayback: fresh as LuvLinkPlaybackAnchor | null });
      }).catch(() => undefined);
      startPresence(currentId).catch(() => undefined);
    }
  });
  return () => {
    stopStoreWatch?.(); stopStoreWatch = null;
    stopAppState?.remove(); stopAppState = null;
    stopRoomWatches?.(); stopRoomWatches = null; observedRoomId = null;
    void disconnectPresence();
  };
}

export async function createOwnedLuvLink(displayName: string, userId: string): Promise<{ roomId: string; code: string }> {
  if (state().session || state().room) throw new Error('Leave your Echo room before starting a LuvLink.');
  const created = await allegraConvex.mutation(api.luvLink.createRoom, { displayName });
  useLuvLinkStore.setState({ ownedUserId: userId, ownedCode: created.code });
  state().setOwnedRoomId(created.roomId);
  return created;
}

export async function joinOwnedLuvLink(code: string, displayName: string): Promise<void> {
  if (state().session || state().room) throw new Error('Leave your Echo room before joining a LuvLink.');
  const joined = await allegraConvex.mutation(api.luvLink.joinRoom, { code: code.trim().toUpperCase(), displayName });
  useLuvLinkStore.setState({ ownedUserId: joined.userId, ownedCode: code.trim().toUpperCase() });
  state().setOwnedRoomId(joined.roomId);
}

export async function leaveOwnedLuvLink(): Promise<void> {
  const id = state().ownedRoomId;
  if (!id) return;
  const member = state().ownedMembers.find(item => item.userId === state().ownedUserId);
  if (member?.role === 'host') await allegraConvex.mutation(api.luvLink.closeRoom, { roomId: id as RoomId });
  else await allegraConvex.mutation(api.luvLink.leaveRoom, { roomId: id as RoomId });
  await disconnectPresence();
  state().setOwnedRoomId(null);
}

export async function regenerateOwnedLuvLinkInvite(): Promise<string> {
  const { code } = await allegraConvex.mutation(api.luvLink.regenerateInvite, { roomId: roomId() });
  useLuvLinkStore.setState({ ownedCode: code });
  return code;
}

export const revokeOwnedLuvLinkInvite = (): Promise<null> => allegraConvex.mutation(api.luvLink.revokeInvite, { roomId: roomId() });
export const setOwnedLuvLinkMode = (mode: 'listen' | 'speaker'): Promise<null> => allegraConvex.mutation(api.luvLink.setRoomMode, { roomId: roomId(), mode });
export const setOwnedLuvLinkMemberMode = (mode: 'listen' | 'speaker'): Promise<null> => allegraConvex.mutation(api.luvLink.setMemberMode, { roomId: roomId(), mode });
export const setOwnedLuvLinkSpeaker = (targetUserId: string): Promise<{ leaderEpoch: number }> => allegraConvex.mutation(api.luvLink.setSpeaker, { roomId: roomId(), commandId: commandId(), targetUserId });
export const acknowledgeOwnedLuvLinkSpeakerHandoff = (expectedLeaderEpoch: number): Promise<null> => allegraConvex.mutation(api.luvLink.acknowledgeSpeakerHandoff, { roomId: roomId(), expectedLeaderEpoch });
export const setOwnedLuvLinkController = (targetUserId: string, canControl: boolean): Promise<null> => allegraConvex.mutation(api.luvLink.setController, { roomId: roomId(), targetUserId, canControl });

/** The visible room panel owns this subscription; closing it releases the watch. */
export function watchOwnedLuvLinkGroupPicks(onUpdate: (picks: OwnedLuvLinkGroupPicks) => void): () => void {
  const id = roomId();
  const watch = allegraConvex.watchQuery(api.luvLink.getGroupPicks, { roomId: id });
  let stopped = false;
  const update = () => {
    if (stopped || state().ownedRoomId !== id) return;
    try { onUpdate(watch.localQueryResult() as OwnedLuvLinkGroupPicks); } catch { /* Initial query is pending. */ }
  };
  const unsubscribe = watch.onUpdate(update);
  update();
  return () => { stopped = true; unsubscribe(); };
}

export const setOwnedLuvLinkSuggestionsConsent = (enabled: boolean): Promise<null> =>
  allegraConvex.mutation(api.luvLink.setSuggestionsConsent, { roomId: roomId(), enabled });

export const refreshOwnedLuvLinkGroupPicks = (): Promise<OwnedLuvLinkGroupPicks> =>
  allegraConvex.mutation(api.luvLink.refreshGroupPicks, { roomId: roomId() });

export const addOwnedLuvLinkQueueItem = (song: SongSnapshot, next = false): Promise<{ entryId: string; revision: number }> =>
  allegraConvex.mutation(api.luvLink.addQueueItem, { roomId: roomId(), commandId: commandId(), song, next });

export async function routeOwnedLuvLinkCatalogPick(song: { id: string; source: string; title: string; artist: string; album?: string; highResArt?: string; duration?: number }, next = false): Promise<boolean> {
  if (!state().ownedRoomId) return false;
  const ref = fromAllegraSong(song);
  if (!ref || !song.duration || song.duration <= 0) {
    state().announce('This track is missing a verified catalog ID or duration, so it cannot be added to LuvLink.');
    return true;
  }
  await addOwnedLuvLinkQueueItem({ ref, title: song.title, artist: song.artist, album: song.album, artwork: song.highResArt ?? '', duration: song.duration }, next);
  return true;
}

export const removeOwnedLuvLinkQueueItem = (entryId: string): Promise<{ revision: number }> =>
  allegraConvex.mutation(api.luvLink.removeQueueItem, { roomId: roomId(), commandId: commandId(), entryId, expectedRevision: state().ownedQueue.revision });

export const moveOwnedLuvLinkQueueItem = (entryId: string, beforeEntryId: string | null): Promise<{ revision: number }> =>
  allegraConvex.mutation(api.luvLink.moveQueueItem, { roomId: roomId(), commandId: commandId(), entryId, beforeEntryId, expectedRevision: state().ownedQueue.revision });

export interface PlaybackCommit {
  song: SongSnapshot | null;
  queueEntryId: string | null;
  positionSec: number;
  playing: boolean;
  playbackRate: number;
  effectiveAtMs?: number;
  forceTrackChange?: boolean;
  intent?: 'control' | 'natural_end' | 'checkpoint';
}

export function commitOwnedLuvLinkPlayback(commit: PlaybackCommit): Promise<void> {
  const run = async (): Promise<void> => {
    const current = state();
    const room = current.ownedRoom;
    const anchor = current.ownedPlayback;
    const member = current.ownedMembers.find(item => item.userId === current.ownedUserId);
    if (!room || !anchor && room.memberCount < 1) return;
    if (current.ownedUserId !== anchor?.leaderUserId && !member?.canControl) return;
    const trackChanged = Boolean(commit.forceTrackChange || commit.song?.ref !== anchor?.song?.ref);
    const trackEpoch = (anchor?.trackEpoch ?? 0) + (trackChanged ? 1 : 0);
    const effectiveAtMs = commit.effectiveAtMs ?? Date.now() + current.clockOffsetMs;
    const result = await allegraConvex.mutation(api.luvLink.publishPlayback, {
      roomId: room.roomId as RoomId,
      commandId: commandId(),
      expectedLeaderEpoch: anchor?.leaderEpoch ?? room.leaderEpoch,
      expectedSequence: anchor?.sequence ?? 0,
      trackEpoch,
      intent: commit.intent ?? 'control',
      queueEntryId: commit.queueEntryId,
      song: commit.song,
      positionSec: Math.max(0, commit.positionSec),
      playing: commit.playing,
      playbackRate: commit.playbackRate,
      effectiveAtMs,
    });
    const latest = state().ownedPlayback;
    if (!latest || latest.sequence < result.sequence) {
      useLuvLinkStore.setState({ ownedPlayback: {
        roomId: room.roomId,
        leaderUserId: anchor?.leaderUserId ?? current.ownedUserId ?? room.hostUserId,
        leaderEpoch: anchor?.leaderEpoch ?? 1,
        sequence: result.sequence,
        trackEpoch,
        queueEntryId: commit.queueEntryId,
        intent: commit.intent ?? 'control',
        intentByUserId: current.ownedUserId ?? room.hostUserId,
        outputAppliedSequence: anchor?.outputAppliedSequence ?? 0,
        barrierPending: Boolean(commit.playing && trackChanged),
        song: commit.song,
        positionSec: commit.positionSec,
        serverAtMs: result.serverAtMs,
        playing: commit.playing && !trackChanged,
        effectiveAtMs: commit.playing && !trackChanged ? effectiveAtMs : result.serverAtMs,
        playbackRate: commit.playbackRate,
      } });
    }
  };
  const next = publishTail.then(run, run);
  publishTail = next.catch(() => undefined);
  return next;
}

export async function reportOwnedLuvLinkReady(trackEpoch: number, ready: boolean): Promise<void> {
  await allegraConvex.mutation(api.luvLink.reportReady, { roomId: roomId(), trackEpoch, ready });
}

export async function acknowledgeOwnedLuvLinkPlaybackIntent(sequence: number, leaderEpoch: number): Promise<void> {
  await allegraConvex.mutation(api.luvLink.acknowledgePlaybackIntent, { roomId: roomId(), sequence, leaderEpoch });
}

/** Monotonic projected playhead; the wall-to-monotonic mapping is refreshed on foreground. */
export function projectedOwnedLuvLinkPosition(anchor: LuvLinkPlaybackAnchor, monotonicNowMs = performance.now()): number {
  const current = state();
  const estimatedServerNow = monotonicNowMs + current.wallMinusMonotonicMs + current.clockOffsetMs;
  const elapsed = anchor.playing ? Math.max(0, (estimatedServerNow - anchor.effectiveAtMs) / 1000) * anchor.playbackRate : 0;
  return Math.max(0, Math.min(anchor.song?.duration ?? 0, anchor.positionSec + elapsed));
}

export function ownedQueueEntryForSong(song: SongSnapshot | undefined): LuvLinkQueueEntry | null {
  if (!song) return null;
  const current = state().ownedPlayback;
  if (current?.song?.ref === song.ref && current.queueEntryId) return state().ownedQueue.entries.find(entry => entry.entryId === current.queueEntryId) ?? null;
  return state().ownedQueue.entries.find(entry => entry.song.ref === song.ref) ?? null;
}
