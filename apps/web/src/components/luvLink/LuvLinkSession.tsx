'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ConvexReactClient, Watch } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import type { LuvLinkGroupPicks, LuvLinkMemberSnapshot, LuvLinkPlaybackAnchor, LuvLinkQueueSnapshot, LuvLinkRoomSnapshot } from '@shared/luvLink';
import { estimateLuvLinkClockOffset, projectLuvLinkPosition } from '@shared/luvLink';
import type { SongSnapshot } from '@shared/songRef';
import { parseSongRef } from '@shared/songRef';

import { useConvexAppClient } from '../../../app/ConvexSignInProvider';
import { waitForAudioReady } from './audioReady';
import { isAppliedLuvLinkPlayerEcho, type AppliedLuvLinkAnchor } from './playerEcho';
import { liveRoomPosition, needsSeek, planAnchorApplication, readableLuvLinkError, retryLuvLink, startDelayMs } from './sync';

const emptyQueue: LuvLinkQueueSnapshot = { revision: 0, entries: [] };
const emptyPicks: LuvLinkGroupPicks = { revision: 0, picks: [] };
const noMembers: readonly LuvLinkMemberSnapshot[] = [];
const noOnline: readonly string[] = [];
const commandId = (): string => crypto.randomUUID();
const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

function validatedSong(song: { readonly ref: string; readonly title: string; readonly artist: string; readonly album?: string; readonly artwork: string; readonly duration: number } | null): SongSnapshot | null {
  if (!song) return null;
  const parsed = parseSongRef(song.ref);
  return parsed ? { ...song, ref: `${parsed.source}:${parsed.id}` } : null;
}

/** Live Convex result. A failed query reports through `onError` instead of throwing: this runs at the app root. */
function useLiveQuery<T>(client: ConvexReactClient | null, watch: (() => Watch<T> | null) | null, onError: (error: Error) => void): T | undefined {
  const [value, setValue] = useState<T>();
  const reportRef = useRef(onError);
  reportRef.current = onError;
  useEffect(() => {
    if (!client || !watch) { setValue(undefined); return; }
    const live = watch();
    if (!live) { setValue(undefined); return; }
    const refresh = (): void => {
      try { setValue(live.localQueryResult()); }
      catch (failure) { setValue(undefined); reportRef.current(failure instanceof Error ? failure : new Error('LuvLink could not update.')); }
    };
    const unsubscribe = live.onUpdate(refresh);
    refresh();
    return unsubscribe;
  }, [client, watch]);
  return value;
}

export interface LuvLinkPublishOptions {
  readonly next?: boolean;
  readonly intent?: 'control' | 'natural_end' | 'checkpoint';
  /** The local player already shows this change (the listener did it on this device). */
  readonly localAlreadyApplied?: boolean;
}

export interface LuvLinkSession {
  readonly client: ConvexReactClient | null;
  readonly signedIn: boolean;
  readonly userId: string | null;
  readonly roomId: string | null;
  readonly roomLoading: boolean;
  readonly room: LuvLinkRoomSnapshot | null;
  readonly members: readonly LuvLinkMemberSnapshot[];
  readonly queue: LuvLinkQueueSnapshot;
  readonly playback: LuvLinkPlaybackAnchor | null;
  readonly picks: LuvLinkGroupPicks;
  readonly online: readonly string[];
  readonly me: LuvLinkMemberSnapshot | undefined;
  readonly isLeader: boolean;
  readonly canControl: boolean;
  readonly busy: boolean;
  readonly message: string | null;
  readonly createdCode: string | null;
  readonly tapToListen: boolean;
  readonly setMessage: (message: string | null) => void;
  readonly setCreatedCode: (code: string | null) => void;
  /** Points the session at a room (from the URL) or lets go of it locally without leaving it. */
  readonly enterRoom: (roomId: string | null) => void;
  readonly createRoom: (displayName: string) => Promise<string | null>;
  readonly joinRoom: (code: string, displayName: string) => Promise<string | null>;
  readonly leaveRoom: () => Promise<boolean>;
  readonly publish: (song: SongSnapshot | null, positionSec: number, playing: boolean, options?: LuvLinkPublishOptions) => Promise<void>;
  /** The room's position now: this device's own playhead when it plays the room's song, else the projected anchor. */
  readonly readPositionSec: () => number;
  /** Retries the current anchor after a blocked autoplay, from a tap. */
  readonly listenNow: () => void;
  readonly addQueueItem: (song: SongSnapshot) => Promise<void>;
}

const LuvLinkSessionContext = createContext<LuvLinkSession | null>(null);

export function useLuvLinkSession(): LuvLinkSession {
  const session = useContext(LuvLinkSessionContext);
  if (!session) throw new Error('LuvLink session is not mounted.');
  return session;
}

export interface LuvLinkSessionProviderProps {
  readonly children: ReactNode;
  readonly signedIn: boolean;
  readonly userId: string | null;
  readonly currentSong: SongSnapshot | null;
  readonly currentSongKey: string | null;
  readonly isPlaying: boolean;
  readonly isBuffering: boolean;
  /** The layout's single audio element. Read lazily: it exists once the shell has rendered. */
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly onStopOutput: () => Promise<void>;
  /** Applies a committed anchor through the layout-owned player; false means a user gesture is needed. */
  /** The position is read when the player is ready for it, since opening a track takes time the room keeps counting. */
  readonly onApplyPlayback: (anchor: LuvLinkPlaybackAnchor, resolvePositionSec: () => number) => Promise<boolean>;
}

/**
 * The listener's LuvLink room, mounted once above every route so navigating away from the
 * LuvLink page neither drops presence nor stops following the room. The page is only a view.
 */
export function LuvLinkSessionProvider(props: LuvLinkSessionProviderProps) {
  const client = useConvexAppClient();
  const { signedIn, userId } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const [roomId, setRoomId] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const sessionTokenRef = useRef<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tapToListen, setTapToListen] = useState(false);
  const tapToListenRef = useRef(false);
  tapToListenRef.current = tapToListen;
  const lastAutoAnchor = useRef<AppliedLuvLinkAnchor | null>(null);
  const publishedTrackKey = useRef<string | null>(null);
  const acknowledgedEpoch = useRef<number | null>(null);
  const readyReported = useRef<string | null>(null);
  const ownApplied = useRef<{ readonly roomId: string; readonly sequence: number } | null>(null);
  const lastPublished = useRef<{ readonly roomId: string; readonly leaderEpoch: number; readonly sequence: number; readonly trackEpoch: number; readonly queueEntryId: string | null; readonly song: SongSnapshot | null } | null>(null);
  const applyGeneration = useRef(0);
  const applying = useRef(0);
  const applyGraceUntil = useRef(0);
  const publishChain = useRef<Promise<void>>(Promise.resolve());

  // A different account never inherits the previous one's room. A momentary signed-out gap keeps it.
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (lastUserId.current && lastUserId.current !== userId) { setRoomId(null); setCreatedCode(null); setTapToListen(false); }
    lastUserId.current = userId;
  }, [userId]);

  // Everything remembered about one room is meaningless in the next.
  useEffect(() => {
    lastAutoAnchor.current = null; publishedTrackKey.current = null; acknowledgedEpoch.current = null; readyReported.current = null;
    ownApplied.current = null; lastPublished.current = null; applyGeneration.current += 1;
    setTapToListen(false);
  }, [roomId]);

  const roomIdValue = signedIn ? roomId as Id<'luvLinkRooms'> | null : null;
  const reportError = useCallback((error: Error) => setMessage(readableLuvLinkError(error)), []);
  const roomWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getRoom, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const membersWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getMembers, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const queueWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getQueue, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const playbackWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getPlayback, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const picksWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getGroupPicks, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const presenceWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getPresence, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const rawRoom = useLiveQuery<LuvLinkRoomSnapshot | null>(client, roomWatch, reportError);
  const room = rawRoom ?? null;
  const roomLoading = Boolean(roomIdValue) && rawRoom === undefined;
  const members = useLiveQuery<LuvLinkMemberSnapshot[]>(client, membersWatch, reportError) ?? noMembers;
  const rawQueue = useLiveQuery(client, queueWatch, reportError);
  const queue = useMemo<LuvLinkQueueSnapshot>(() => rawQueue ? { revision: rawQueue.revision, entries: rawQueue.entries.flatMap(entry => { const song = validatedSong(entry.song); return song ? [{ ...entry, song }] : []; }) } : emptyQueue, [rawQueue]);
  const rawPlayback = useLiveQuery(client, playbackWatch, reportError);
  const playback = useMemo<LuvLinkPlaybackAnchor | null>(() => rawPlayback ? { ...rawPlayback, song: validatedSong(rawPlayback.song) } : null, [rawPlayback]);
  const rawPicks = useLiveQuery(client, picksWatch, reportError);
  const picks = useMemo<LuvLinkGroupPicks>(() => rawPicks ? {
    revision: rawPicks.revision,
    picks: rawPicks.picks.flatMap(pick => { const song = validatedSong(pick.song); return song ? [{ ...pick, song }] : []; })
  } : emptyPicks, [rawPicks]);
  const online = useLiveQuery<string[]>(client, presenceWatch, reportError) ?? noOnline;
  const me = members.find(member => member.userId === userId);
  const isLeader = room?.leaderUserId === userId;
  const canControl = Boolean(me?.canControl || me?.role === 'host');

  // What the callbacks below read at the moment they run, so they never act on a render-old room.
  const latest = useRef({ room, playback, queue, clockOffsetMs, canControl, isLeader });
  latest.current = { room, playback, queue, clockOffsetMs, canControl, isLeader };

  const isApplying = useCallback((): boolean => applying.current > 0 || Date.now() < applyGraceUntil.current, []);
  const applyToPlayer = useCallback(async (anchor: LuvLinkPlaybackAnchor, resolvePositionSec: () => number): Promise<boolean> => {
    applying.current += 1;
    try { return await propsRef.current.onApplyPlayback(anchor, resolvePositionSec); }
    finally { applying.current -= 1; applyGraceUntil.current = Date.now() + 400; }
  }, []);

  const readPositionSec = useCallback((): number => {
    const { playback: anchor, clockOffsetMs: offset } = latest.current;
    const audio = propsRef.current.audioRef.current;
    const song = propsRef.current.currentSong;
    return liveRoomPosition(anchor, Date.now(), offset, audio && song
      ? { songRef: song.ref, currentTime: audio.currentTime, loaded: audio.readyState >= 1, playing: !audio.paused }
      : null);
  }, []);

  const sampleClock = useCallback(async (): Promise<number> => {
    if (!client || !roomIdValue) return 0;
    const samples = [];
    for (let index = 0; index < 3; index += 1) {
      const clientSentAtMs = Date.now();
      const result = await client.mutation(api.luvLink.getServerTime, { roomId: roomIdValue! });
      const clientReceivedAtMs = Date.now();
      samples.push({ clientSentAtMs, clientReceivedAtMs, serverAtMs: result.serverAtMs });
    }
    return estimateLuvLinkClockOffset(samples);
  }, [client, roomIdValue]);

  const createRoom = useCallback(async (displayName: string): Promise<string | null> => {
    if (!client || !signedIn) return null;
    setBusy(true); setMessage(null);
    try {
      const result = await client.mutation(api.luvLink.createRoom, { displayName });
      setCreatedCode(result.code); setRoomId(result.roomId);
      return result.roomId;
    } catch (error) { setMessage(readableLuvLinkError(error)); return null; }
    finally { setBusy(false); }
  }, [client, signedIn]);

  const joinRoom = useCallback(async (code: string, displayName: string): Promise<string | null> => {
    if (!client || !signedIn) return null;
    setBusy(true); setMessage(null);
    try {
      const result = await client.mutation(api.luvLink.joinRoom, { code: code.trim().toUpperCase(), displayName });
      setRoomId(result.roomId); setCreatedCode(null);
      return result.roomId;
    } catch (error) { setMessage(readableLuvLinkError(error)); return null; }
    finally { setBusy(false); }
  }, [client, signedIn]);

  const leaveRoom = useCallback(async (): Promise<boolean> => {
    if (!client || !roomIdValue) return false;
    try {
      await retryLuvLink(() => client.mutation(api.luvLink.leaveRoom, { roomId: roomIdValue! }));
      setRoomId(null); setCreatedCode(null);
      return true;
    } catch (error) { setMessage(readableLuvLinkError(error)); return false; }
  }, [client, roomIdValue]);

  // Presence and the clock live as long as the session does, not as long as the page is open.
  const hasRoom = Boolean(room);
  useEffect(() => {
    if (!client || !roomIdValue || !signedIn || !hasRoom) return;
    let active = true;
    const heartbeat = (): Promise<string> => client.mutation(api.luvLink.heartbeat, { roomId: roomIdValue!, sessionId }).then(result => { sessionTokenRef.current = result.sessionToken; return result.sessionToken; });
    const establish = async (): Promise<void> => {
      try {
        const [offset] = await retryLuvLink(() => Promise.all([sampleClock(), heartbeat()]), { isCurrent: () => active });
        if (active) setClockOffsetMs(offset);
      } catch { /* the room still works; the next heartbeat or foreground visit tries again */ }
    };
    void establish();
    const timer = window.setInterval(() => { void heartbeat().catch(() => undefined); }, 55_000);
    const onVisible = (): void => { if (document.visibilityState === 'visible') void establish(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false; window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      const token = sessionTokenRef.current;
      sessionTokenRef.current = null;
      if (token) void client.mutation(api.luvLink.disconnectPresence, { roomId: roomIdValue!, sessionToken: token }).catch(() => undefined);
    };
  }, [client, roomIdValue, signedIn, hasRoom, sessionId, sampleClock]);

  /** Tells the room this device could start the track now. Repeats on transport failures; a newer track makes it moot. */
  const reportReady = useCallback(async (anchor: LuvLinkPlaybackAnchor, generation: number): Promise<void> => {
    if (!client || !roomIdValue) return;
    const key = `${anchor.roomId}:${anchor.leaderEpoch}:${anchor.trackEpoch}`;
    if (readyReported.current === key) return;
    readyReported.current = key;
    try {
      await retryLuvLink(() => client.mutation(api.luvLink.reportReady, { roomId: roomIdValue!, trackEpoch: anchor.trackEpoch, ready: true }), { isCurrent: () => generation === applyGeneration.current });
    } catch (error) {
      // A stale track or a changed speaker is final; anything else may succeed on the next anchor.
      const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
      if (typeof code !== 'string') readyReported.current = null;
    }
  }, [client, roomIdValue]);

  const projectNow = useCallback((anchor: LuvLinkPlaybackAnchor) => (): number => projectLuvLinkPosition(anchor, Date.now(), latest.current.clockOffsetMs), []);

  const applyAnchor = useCallback(async (anchor: LuvLinkPlaybackAnchor, force = false): Promise<void> => {
    const { room: currentRoom, clockOffsetMs: offset } = latest.current;
    const self = propsRef.current.userId;
    if (!self || !currentRoom || !client || !roomIdValue) return;
    const plan = planAnchorApplication({
      mode: currentRoom.mode, userId: self, leaderUserId: currentRoom.leaderUserId, handoffFromUserId: currentRoom.handoffFromUserId, anchor,
      ownAppliedSequence: ownApplied.current?.roomId === String(anchor.roomId) ? ownApplied.current.sequence : null,
    });
    if (plan.kind === 'stop-output') {
      lastAutoAnchor.current = null;
      await propsRef.current.onStopOutput();
      if (plan.acknowledgeHandoff && acknowledgedEpoch.current !== currentRoom.leaderEpoch) {
        acknowledgedEpoch.current = currentRoom.leaderEpoch;
        await retryLuvLink(() => client.mutation(api.luvLink.acknowledgeSpeakerHandoff, { roomId: roomIdValue!, expectedLeaderEpoch: currentRoom.leaderEpoch }))
          .catch(() => { acknowledgedEpoch.current = null; setMessage('The speaker change is waiting for this device. Keep LuvLink open.'); });
      }
      return;
    }
    if (plan.kind !== 'apply') return;
    const applied: AppliedLuvLinkAnchor = { roomId: String(anchor.roomId), leaderEpoch: anchor.leaderEpoch, sequence: anchor.sequence, songRef: anchor.song?.ref ?? null };
    const prior = lastAutoAnchor.current;
    if (!force && prior?.roomId === applied.roomId && prior.leaderEpoch === applied.leaderEpoch && prior.sequence === applied.sequence) return;
    lastAutoAnchor.current = applied;
    const generation = ++applyGeneration.current;
    const current = (): boolean => generation === applyGeneration.current;

    let ready: boolean;
    const delay = startDelayMs(anchor, Date.now(), offset);
    if (delay > 0) {
      // Load and place the track paused, then start together at the moment the server stamped.
      ready = await applyToPlayer({ ...anchor, playing: false }, () => anchor.positionSec);
      if (!current()) return;
      if (ready) {
        await sleep(Math.max(0, startDelayMs(anchor, Date.now(), latest.current.clockOffsetMs)));
        if (!current()) return;
        ready = await applyToPlayer(anchor, projectNow(anchor));
      }
    } else {
      ready = await applyToPlayer(anchor, projectNow(anchor));
    }
    if (!current()) return;

    if (plan.acknowledgeIntent && ready && anchor.outputAppliedSequence < anchor.sequence) {
      await retryLuvLink(() => client.mutation(api.luvLink.acknowledgePlaybackIntent, { roomId: roomIdValue!, sequence: anchor.sequence, leaderEpoch: anchor.leaderEpoch }), { isCurrent: current }).catch(() => undefined);
      if (!current()) return;
    }
    if (anchor.song && anchor.playing && !ready) { setTapToListen(true); return; }
    if (ready) setTapToListen(false);
    if (anchor.barrierPending && anchor.song && ready) {
      // Ready means buffered, not merely selected: the room starts when every device says so.
      const audio = propsRef.current.audioRef.current;
      if (audio && await waitForAudioReady(audio) && current()) await reportReady(anchor, generation);
    }
  }, [client, roomIdValue, applyToPlayer, reportReady, projectNow]);

  useEffect(() => {
    if (!room || !signedIn) return;
    if (playback) void applyAnchor(playback);
    else if (room.mode === 'speaker' && room.leaderUserId !== userId) void propsRef.current.onStopOutput();
  }, [room?.roomId, room?.mode, room?.leaderUserId, room?.leaderEpoch, room?.handoffFromUserId, playback?.sequence, applyAnchor, signedIn, userId]);

  const listenNow = useCallback((): void => {
    const anchor = latest.current.playback;
    if (anchor) void applyAnchor(anchor, true);
  }, [applyAnchor]);

  const publish = useCallback((song: SongSnapshot | null, positionSec: number, playing: boolean, options: LuvLinkPublishOptions = {}): Promise<void> => {
    const { next = false, intent = 'control', localAlreadyApplied = false } = options;
    const run = async (): Promise<void> => {
      const { room: currentRoom, queue: currentQueue, canControl: allowed, isLeader: leading, clockOffsetMs: offset } = latest.current;
      const self = propsRef.current.userId;
      if (!client || !roomIdValue || !currentRoom || !self || !allowed) return;
      // Writes go one at a time, and the next one builds on the last result when the subscription has not caught up.
      const live = latest.current.playback;
      const recent = lastPublished.current;
      const base = recent && recent.roomId === String(roomIdValue) && recent.leaderEpoch === currentRoom.leaderEpoch && recent.sequence > (live?.sequence ?? 0)
        ? recent
        : live ? { sequence: live.sequence, trackEpoch: live.trackEpoch, queueEntryId: live.queueEntryId, song: live.song } : null;
      const selected = next ? currentQueue.entries[0] : undefined;
      if (next && !selected) { setMessage('Add a song to the queue first.'); return; }
      const resolvedSong = selected?.song ?? song;
      const trackChanged = Boolean(resolvedSong && (selected || base?.song?.ref !== resolvedSong.ref));
      const startSec = resolvedSong && !selected ? Math.max(0, Math.min(positionSec, resolvedSong.duration)) : 0;
      const shouldPlay = playing && resolvedSong !== null;
      const needsBarrier = shouldPlay && trackChanged;
      const trackEpoch = (base?.trackEpoch ?? 0) + (trackChanged ? 1 : 0);
      const queueEntryId = selected?.entryId ?? (trackChanged ? null : base?.queueEntryId ?? null);
      const expectedSequence = base?.sequence ?? 0;
      const sequence = expectedSequence + 1;
      const roomKey = String(roomIdValue);
      // A change this device made is already playing here; its own anchor must not seek the player again.
      // A track change with a barrier is the exception: the room waits for everyone, this device too.
      const markApplied = localAlreadyApplied && !needsBarrier;
      if (markApplied) ownApplied.current = { roomId: roomKey, sequence };
      try {
        const id = commandId();
        const result = await retryLuvLink(() => client.mutation(api.luvLink.publishPlayback, {
          roomId: roomIdValue!, commandId: id, expectedLeaderEpoch: currentRoom.leaderEpoch, expectedSequence, trackEpoch, intent,
          queueEntryId, song: resolvedSong, positionSec: startSec, playing: shouldPlay, playbackRate: 1, effectiveAtMs: Date.now() + offset,
        }), { isCurrent: () => latest.current.room?.leaderEpoch === currentRoom.leaderEpoch });
        lastPublished.current = { roomId: roomKey, leaderEpoch: currentRoom.leaderEpoch, sequence: result.sequence, trackEpoch, queueEntryId, song: resolvedSong };
        setMessage(`Playback synced · #${result.sequence}`);
        if (markApplied) ownApplied.current = { roomId: roomKey, sequence: result.sequence };
        // The server counts the speaker's own change as applied, so its anchor would be skipped: apply it here.
        if (!localAlreadyApplied && currentRoom.mode === 'speaker' && leading && !needsBarrier) {
          ownApplied.current = { roomId: roomKey, sequence: result.sequence };
          const anchor: LuvLinkPlaybackAnchor = {
            roomId: roomKey, leaderUserId: currentRoom.leaderUserId, leaderEpoch: currentRoom.leaderEpoch, sequence: result.sequence, trackEpoch, queueEntryId, intent,
            intentByUserId: self, outputAppliedSequence: result.sequence, barrierPending: false, song: resolvedSong, positionSec: startSec, serverAtMs: result.serverAtMs,
            playing: shouldPlay, effectiveAtMs: Date.now() + offset, playbackRate: 1,
          };
          await applyToPlayer(anchor, () => startSec);
        }
      } catch (error) {
        if (markApplied && ownApplied.current?.sequence === sequence) ownApplied.current = null;
        setMessage(readableLuvLinkError(error));
      }
    };
    const queued = publishChain.current.then(run);
    publishChain.current = queued.catch(() => undefined);
    return queued;
  }, [client, roomIdValue, applyToPlayer]);

  // The elected output publishes meaningful changes made at its own player, plus one coarse checkpoint while playing.
  const { currentSong, currentSongKey, isPlaying, isBuffering } = props;
  useEffect(() => {
    if (!room || !isLeader || !canControl || room.handoffFromUserId || !currentSong || !currentSongKey) return;
    if (publishedTrackKey.current !== currentSongKey) {
      publishedTrackKey.current = currentSongKey;
      const echo = playback?.song?.ref === currentSong.ref || isApplying() || isAppliedLuvLinkPlayerEcho(lastAutoAnchor.current, {
        roomId: room.roomId, leaderEpoch: playback?.leaderEpoch ?? room.leaderEpoch, sequence: playback?.sequence ?? null, songRef: currentSong.ref,
      });
      if (!echo) {
        const audio = propsRef.current.audioRef.current;
        void publish(currentSong, audio?.currentTime ?? 0, isPlaying || isBuffering, { localAlreadyApplied: true });
        return;
      }
    }
    // Pause and play follow the element, settled for a moment: a seek pauses and resumes it within the same breath.
    const timer = window.setTimeout(() => {
      const state = latest.current;
      const audio = propsRef.current.audioRef.current;
      const song = propsRef.current.currentSong;
      if (!audio || !song || !state.room || isApplying() || tapToListenRef.current || audio.seeking) return;
      const playingNow = !audio.paused;
      if (!state.playback) { void publish(song, audio.currentTime, playingNow, { localAlreadyApplied: true }); return; }
      if (state.playback.barrierPending || state.playback.song?.ref !== song.ref) return;
      if (state.playback.playing !== playingNow) void publish(song, audio.currentTime, playingNow, { localAlreadyApplied: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [room?.roomId, room?.handoffFromUserId, isLeader, canControl, currentSongKey, isPlaying, playback?.sequence, playback?.playing, playback?.barrierPending, publish, isApplying]);

  useEffect(() => {
    if (!room || !isLeader || !canControl || !isPlaying) return;
    const timer = window.setInterval(() => {
      const state = latest.current;
      const audio = propsRef.current.audioRef.current;
      const song = propsRef.current.currentSong;
      const anchor = state.playback;
      if (!audio || !song || !anchor?.playing || anchor.barrierPending || anchor.song?.ref !== song.ref || isApplying() || state.room?.handoffFromUserId) return;
      void publish(song, audio.currentTime, true, { intent: 'checkpoint', localAlreadyApplied: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [room?.roomId, isLeader, canControl, isPlaying, currentSongKey, publish, isApplying]);

  // A seek at the elected output moves the room; one the room caused, or one that lands where the room already is, does not.
  useEffect(() => {
    const audio = props.audioRef.current;
    if (!audio || !room || !isLeader || !canControl) return;
    const onSeeked = (): void => {
      const song = propsRef.current.currentSong;
      const anchor = latest.current.playback;
      if (!song || isApplying() || tapToListenRef.current || latest.current.room?.handoffFromUserId) return;
      if (anchor && (anchor.barrierPending || anchor.song?.ref !== song.ref)) return;
      const playingNow = !audio.paused;
      const expected = anchor ? liveRoomPosition(anchor, Date.now(), latest.current.clockOffsetMs, null) : null;
      if (expected !== null && !needsSeek(audio.currentTime, expected, playingNow)) return;
      void publish(song, audio.currentTime, playingNow, { localAlreadyApplied: true });
    };
    audio.addEventListener('seeked', onSeeked);
    return () => audio.removeEventListener('seeked', onSeeked);
  }, [props.audioRef, currentSongKey, room?.roomId, isLeader, canControl, publish, isApplying]);

  const addQueueItem = useCallback(async (song: SongSnapshot): Promise<void> => {
    if (!client || !roomIdValue) return;
    await client.mutation(api.luvLink.addQueueItem, { roomId: roomIdValue!, commandId: commandId(), song, next: false })
      .then(() => setMessage('Added to the LuvLink queue.')).catch(error => setMessage(readableLuvLinkError(error)));
  }, [client, roomIdValue]);

  const enterRoom = useCallback((id: string | null): void => setRoomId(id), []);

  const value = useMemo<LuvLinkSession>(() => ({
    client, signedIn, userId, roomId, roomLoading, room, members, queue, playback, picks, online, me, isLeader, canControl, busy, message, createdCode, tapToListen,
    setMessage, setCreatedCode, enterRoom, createRoom, joinRoom, leaveRoom, publish, readPositionSec, listenNow, addQueueItem,
  }), [client, signedIn, userId, roomId, roomLoading, room, members, queue, playback, picks, online, busy, message, createdCode, tapToListen, enterRoom, createRoom, joinRoom, leaveRoom, publish, readPositionSec, listenNow, addQueueItem]);

  return <LuvLinkSessionContext.Provider value={value}>{props.children}</LuvLinkSessionContext.Provider>;
}
