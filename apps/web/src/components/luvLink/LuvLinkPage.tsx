'use client';

import { LogIn, Music2, Pause, Play, Plus, Share2, SkipForward, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConvexReactClient, Watch } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import type { LuvLinkGroupPicks, LuvLinkMemberSnapshot, LuvLinkPlaybackAnchor, LuvLinkQueueSnapshot, LuvLinkRoomSnapshot } from '@shared/luvLink';
import type { SongSnapshot } from '@shared/songRef';
import { parseSongRef } from '@shared/songRef';

import { useConvexAppClient } from '../../../app/ConvexSignInProvider';
import { paths } from '../../lib/routes';
import { projectLuvLinkPosition, estimateLuvLinkClockOffset } from '@shared/luvLink';
import { isAppliedLuvLinkPlayerEcho, type AppliedLuvLinkAnchor } from './playerEcho';

const emptyQueue: LuvLinkQueueSnapshot = { revision: 0, entries: [] };
const commandId = (): string => crypto.randomUUID();

function validatedSong(song: { readonly ref: string; readonly title: string; readonly artist: string; readonly album?: string; readonly artwork: string; readonly duration: number } | null): SongSnapshot | null {
  if (!song) return null;
  const parsed = parseSongRef(song.ref);
  return parsed ? { ...song, ref: `${parsed.source}:${parsed.id}` } : null;
}

function useLiveQuery<T>(client: ConvexReactClient | null, watch: (() => Watch<T> | null) | null): T | undefined {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!client || !watch) { setValue(undefined); return; }
    const live = watch();
    if (!live) { setValue(undefined); return; }
    const refresh = (): void => {
      try { setValue(live.localQueryResult()); setError(null); }
      catch (failure) { setError(failure instanceof Error ? failure : new Error('LuvLink could not update.')); }
    };
    const unsubscribe = live.onUpdate(refresh);
    refresh();
    return unsubscribe;
  }, [client, watch]);
  if (error) throw error;
  return value;
}

function readableError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const nested = record?.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>).message : null;
  return typeof nested === 'string' ? nested : error instanceof Error ? error.message : 'That did not work. Try again.';
}

export interface LuvLinkPageProps {
  readonly signedIn: boolean;
  readonly displayName: string;
  readonly userId: string | null;
  readonly inviteCode: string | null;
  readonly roomId: string | null;
  readonly currentSong: SongSnapshot | null;
  readonly currentSongKey: string | null;
  readonly isPlaying: boolean;
  readonly positionSec: number;
  readonly audioElement: HTMLAudioElement | null;
  readonly onSignIn: () => void;
  readonly onStopOutput: () => Promise<void>;
  /** Applies a committed anchor through the existing layout-owned player; false means user gesture is needed. */
  readonly onApplyPlayback: (anchor: LuvLinkPlaybackAnchor, positionSec: number) => Promise<boolean>;
}

export function LuvLinkPage(props: LuvLinkPageProps) {
  const client = useConvexAppClient();
  const router = useRouter();
  const [roomId, setRoomId] = useState<string | null>(props.roomId);
  const [inviteCode, setInviteCode] = useState(props.inviteCode ?? '');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [name, setName] = useState(props.displayName || 'Listener');
  const [sessionId] = useState(() => crypto.randomUUID());
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tapToListen, setTapToListen] = useState(false);
  const lastAutoAnchor = useRef<AppliedLuvLinkAnchor | null>(null);
  const publishedTrackKey = useRef<string | null>(null);
  const acknowledgedEpoch = useRef<number | null>(null);
  const readyReportedEpoch = useRef<number | null>(null);
  const applyingAnchorRef = useRef(false);
  sessionTokenRef.current = sessionToken;

  useEffect(() => setRoomId(props.roomId), [props.roomId]);
  useEffect(() => { if (props.inviteCode) setInviteCode(props.inviteCode); }, [props.inviteCode]);

  const roomIdValue = roomId as Id<'luvLinkRooms'> | null;
  const roomWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getRoom, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const membersWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getMembers, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const queueWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getQueue, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const playbackWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getPlayback, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const picksWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getGroupPicks, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const presenceWatch = useCallback(() => client && roomIdValue ? client.watchQuery(api.luvLink.getPresence, { roomId: roomIdValue! }) : null, [client, roomIdValue]);
  const room = useLiveQuery<LuvLinkRoomSnapshot | null>(client, roomWatch) ?? null;
  const members = useLiveQuery<LuvLinkMemberSnapshot[]>(client, membersWatch) ?? [];
  const rawQueue = useLiveQuery(client, queueWatch);
  const queue = useMemo<LuvLinkQueueSnapshot>(() => rawQueue ? { revision: rawQueue.revision, entries: rawQueue.entries.flatMap(entry => { const song = validatedSong(entry.song); return song ? [{ ...entry, song }] : []; }) } : emptyQueue, [rawQueue]);
  const rawPlayback = useLiveQuery(client, playbackWatch);
  const playback = useMemo<LuvLinkPlaybackAnchor | null>(() => rawPlayback ? { ...rawPlayback, song: validatedSong(rawPlayback.song) } : null, [rawPlayback]);
  const rawPicks = useLiveQuery(client, picksWatch);
  const picks = useMemo<LuvLinkGroupPicks>(() => rawPicks ? {
    revision: rawPicks.revision,
    picks: rawPicks.picks.flatMap(pick => { const song = validatedSong(pick.song); return song ? [{ ...pick, song }] : []; })
  } : { revision: 0, picks: [] }, [rawPicks]);
  const online = useLiveQuery<string[]>(client, presenceWatch) ?? [];
  const me = members.find(member => member.userId === props.userId);
  const isLeader = room?.leaderUserId === props.userId;
  const canControl = Boolean(me?.canControl || me?.role === 'host');
  const projected = useMemo(() => playback ? projectLuvLinkPosition(playback, Date.now(), clockOffsetMs) : 0, [playback, clockOffsetMs]);

  const applyToPlayer = useCallback(async (anchor: LuvLinkPlaybackAnchor, positionSec: number): Promise<boolean> => {
    applyingAnchorRef.current = true;
    try { return await props.onApplyPlayback(anchor, positionSec); }
    finally { window.setTimeout(() => { applyingAnchorRef.current = false; }, 300); }
  }, [props.onApplyPlayback]);

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

  const createRoom = async (): Promise<void> => {
    if (!client || !props.signedIn) return;
    setBusy(true); setMessage(null);
    try {
      const result = await client.mutation(api.luvLink.createRoom, { displayName: name });
      setCreatedCode(result.code); setRoomId(result.roomId); setInviteCode('');
      router.push(paths.luvLinkRoom(result.roomId));
    } catch (error) { setMessage(readableError(error)); }
    finally { setBusy(false); }
  };

  const join = async (rawCode = inviteCode): Promise<void> => {
    if (!client || !props.signedIn) return;
    setBusy(true); setMessage(null);
    try {
      const result = await client.mutation(api.luvLink.joinRoom, { code: rawCode.trim().toUpperCase(), displayName: name });
      setRoomId(result.roomId); setCreatedCode(null);
      router.replace(paths.luvLinkRoom(result.roomId));
    } catch (error) { setMessage(readableError(error)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!client || !roomIdValue || !props.signedIn || !room) return;
    let active = true;
    const establish = async (): Promise<void> => {
      try {
        const [offset, presenceResult] = await Promise.all([
          sampleClock(),
          client.mutation(api.luvLink.heartbeat, { roomId: roomIdValue!, sessionId })
        ]);
        if (!active) return;
        setClockOffsetMs(offset);
        setSessionToken(presenceResult.sessionToken);
      } catch { /* room still works; the next foreground visit retries clock/presence */ }
    };
    void establish();
    const timer = window.setInterval(() => { void client.mutation(api.luvLink.heartbeat, { roomId: roomIdValue!, sessionId }).then(result => setSessionToken(result.sessionToken)).catch(() => undefined); }, 55_000);
    return () => {
      active = false; window.clearInterval(timer);
      if (sessionTokenRef.current) void client.mutation(api.luvLink.disconnectPresence, { roomId: roomIdValue!, sessionToken: sessionTokenRef.current }).catch(() => undefined);
    };
  }, [client, roomIdValue, props.signedIn, room?.roomId, sampleClock, sessionId]);

  const applyAnchor = useCallback(async (anchor: LuvLinkPlaybackAnchor): Promise<void> => {
    if (!props.userId) return;
    if (room?.mode === 'speaker' && room.leaderUserId !== props.userId) {
      await props.onStopOutput();
      if (room.handoffFromUserId === props.userId && acknowledgedEpoch.current !== room.leaderEpoch && client && roomIdValue) {
        acknowledgedEpoch.current = room.leaderEpoch;
        await client.mutation(api.luvLink.acknowledgeSpeakerHandoff, { roomId: roomIdValue, expectedLeaderEpoch: room.leaderEpoch }).catch(() => { acknowledgedEpoch.current = null; });
      }
      return;
    }
    if (room?.mode === 'speaker' && room.handoffFromUserId) return;
    if (room?.mode === 'speaker' && room.leaderUserId === props.userId && anchor.intentByUserId === props.userId && anchor.outputAppliedSequence >= anchor.sequence) return;
    if (room?.mode === 'speaker' && room.leaderUserId !== props.userId) return;
    if (room?.mode === 'speaker' && room.leaderUserId === props.userId && anchor.outputAppliedSequence >= anchor.sequence) return;
    if (room?.mode !== 'speaker' && anchor.leaderUserId === props.userId && anchor.sequence === playback?.sequence) return;
    const appliedAnchor = { roomId: String(anchor.roomId), leaderEpoch: anchor.leaderEpoch, sequence: anchor.sequence, songRef: anchor.song?.ref ?? null };
    if (lastAutoAnchor.current?.roomId === appliedAnchor.roomId && lastAutoAnchor.current.leaderEpoch === appliedAnchor.leaderEpoch && lastAutoAnchor.current.sequence === appliedAnchor.sequence) return;
    lastAutoAnchor.current = appliedAnchor;
    const positionSec = projectLuvLinkPosition(anchor, Date.now(), clockOffsetMs);
    const ready = await applyToPlayer(anchor, positionSec);
    if (room?.mode === 'speaker' && isLeader && ready && anchor.outputAppliedSequence < anchor.sequence && client && roomIdValue) {
      await client.mutation(api.luvLink.acknowledgePlaybackIntent, { roomId: roomIdValue, sequence: anchor.sequence, leaderEpoch: anchor.leaderEpoch }).catch(() => undefined);
    }
    if (anchor.song && ready && roomIdValue && readyReportedEpoch.current !== anchor.trackEpoch) {
      readyReportedEpoch.current = anchor.trackEpoch;
      setTapToListen(false);
      await client?.mutation(api.luvLink.reportReady, { roomId: roomIdValue!, trackEpoch: anchor.trackEpoch, ready: true }).catch(() => undefined);
    } else if (anchor.song && anchor.playing && !ready) setTapToListen(true);
  }, [props, room, playback?.sequence, clockOffsetMs, roomIdValue, client, applyToPlayer]);

  useEffect(() => { if (playback) void applyAnchor(playback); else if (room?.mode === 'speaker' && room.leaderUserId !== props.userId) void props.onStopOutput(); }, [playback?.sequence, room?.leaderEpoch, room?.handoffFromUserId, applyAnchor, props.userId, props.onStopOutput]);

  useEffect(() => {
    const audio = props.audioElement;
    if (!audio || !client || !roomIdValue || !room || !playback?.song) return;
    const reportOutputReady = (): void => {
      if (audio.paused || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !props.currentSong || props.currentSong.ref !== playback.song?.ref || readyReportedEpoch.current === playback.trackEpoch) return;
      const declaredSource = audio.getAttribute('src');
      if (declaredSource && audio.currentSrc && new URL(declaredSource, window.location.href).href !== audio.currentSrc) return;
      readyReportedEpoch.current = playback.trackEpoch;
      void client.mutation(api.luvLink.reportReady, { roomId: roomIdValue, trackEpoch: playback.trackEpoch, ready: true }).catch(() => { readyReportedEpoch.current = null; });
    };
    audio.addEventListener('canplay', reportOutputReady);
    audio.addEventListener('playing', reportOutputReady);
    reportOutputReady();
    return () => { audio.removeEventListener('canplay', reportOutputReady); audio.removeEventListener('playing', reportOutputReady); };
  }, [props.audioElement, props.currentSong?.ref, client, roomIdValue, room?.mode, playback?.trackEpoch, playback?.song?.ref]);

  const publish = useCallback(async (song: SongSnapshot | null, positionSec: number, playing: boolean, next = false, intent: 'control' | 'natural_end' | 'checkpoint' = 'control', localAlreadyApplied = false): Promise<void> => {
    if (!client || !roomIdValue || !room || !props.userId || !canControl) return;
    const current = playback;
    const selected = next ? queue.entries[0] : undefined;
    const resolvedSong = selected?.song ?? song;
    const trackChanged = Boolean(resolvedSong && current?.song?.ref !== resolvedSong.ref);
    if (next && !selected) { setMessage('Add a song to the queue first.'); return; }
    try {
      const result = await client.mutation(api.luvLink.publishPlayback, {
        roomId: roomIdValue!, commandId: commandId(), expectedLeaderEpoch: room.leaderEpoch,
        expectedSequence: current?.sequence ?? 0, trackEpoch: (current?.trackEpoch ?? 0) + (trackChanged ? 1 : 0), intent,
        queueEntryId: selected?.entryId ?? (trackChanged ? null : current?.queueEntryId ?? null),
        song: resolvedSong, positionSec: selected ? 0 : positionSec, playing, playbackRate: 1, effectiveAtMs: Date.now() + clockOffsetMs
      });
      setMessage(`Playback synced · #${result.sequence}`);
      const needsBarrier = playing && trackChanged && resolvedSong !== null;
      if (room.mode === 'speaker' && isLeader && !needsBarrier) {
        if (localAlreadyApplied) await client.mutation(api.luvLink.acknowledgePlaybackIntent, { roomId: roomIdValue, sequence: result.sequence, leaderEpoch: room.leaderEpoch });
        else {
          const anchor: LuvLinkPlaybackAnchor = { roomId: String(roomIdValue), leaderUserId: room.leaderUserId, leaderEpoch: room.leaderEpoch, sequence: result.sequence, trackEpoch: (current?.trackEpoch ?? 0) + (trackChanged ? 1 : 0), queueEntryId: selected?.entryId ?? (trackChanged ? null : current?.queueEntryId ?? null), intent, intentByUserId: props.userId, outputAppliedSequence: current?.outputAppliedSequence ?? 0, barrierPending: false, song: resolvedSong, positionSec: selected ? 0 : positionSec, serverAtMs: result.serverAtMs, playing, effectiveAtMs: Date.now() + clockOffsetMs, playbackRate: 1 };
          const ready = await applyToPlayer(anchor, positionSec);
          if (ready) await client.mutation(api.luvLink.acknowledgePlaybackIntent, { roomId: roomIdValue, sequence: result.sequence, leaderEpoch: room.leaderEpoch });
        }
      } else if (room.mode === 'listen' && isLeader && !localAlreadyApplied) {
        const anchor: LuvLinkPlaybackAnchor = { roomId: String(roomIdValue), leaderUserId: room.leaderUserId, leaderEpoch: room.leaderEpoch, sequence: result.sequence, trackEpoch: (current?.trackEpoch ?? 0) + (trackChanged ? 1 : 0), queueEntryId: selected?.entryId ?? (trackChanged ? null : current?.queueEntryId ?? null), intent, intentByUserId: props.userId, outputAppliedSequence: result.sequence, barrierPending: false, song: resolvedSong, positionSec: selected ? 0 : positionSec, serverAtMs: result.serverAtMs, playing, effectiveAtMs: Date.now() + clockOffsetMs, playbackRate: 1 };
        await applyToPlayer(anchor, positionSec);
      }
    } catch (error) { setMessage(readableError(error)); }
  }, [client, roomIdValue, room, props.userId, canControl, playback, queue.entries, clockOffsetMs, isLeader, applyToPlayer]);

  // The elected output publishes only meaningful changes, plus one coarse checkpoint while playing.
  useEffect(() => {
    if (!room || !isLeader || !props.currentSong || !props.currentSongKey || !canControl) return;
    if (isAppliedLuvLinkPlayerEcho(lastAutoAnchor.current, {
      roomId: room.roomId,
      leaderEpoch: playback?.leaderEpoch ?? room.leaderEpoch,
      sequence: playback?.sequence ?? null,
      songRef: props.currentSong.ref,
    })) {
      publishedTrackKey.current = props.currentSongKey;
      return;
    }
    const trackChanged = publishedTrackKey.current !== props.currentSongKey;
    if (trackChanged || !playback || playback.playing !== props.isPlaying) {
      publishedTrackKey.current = props.currentSongKey;
      void publish(props.currentSong, props.positionSec, props.isPlaying, false, 'control', true);
    }
  }, [room?.roomId, isLeader, canControl, props.currentSongKey, props.isPlaying, playback?.sequence]);

  useEffect(() => {
    if (!room || !isLeader || !props.isPlaying) return;
    const timer = window.setInterval(() => {
      if (props.currentSong) void publish(props.currentSong, props.audioElement?.currentTime ?? props.positionSec, true, false, 'checkpoint', true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [room?.roomId, isLeader, props.isPlaying, props.currentSongKey, publish]);

  useEffect(() => {
    const audio = props.audioElement;
    if (!audio || !room || !isLeader) return;
    const onSeeked = (): void => { if (!applyingAnchorRef.current && props.currentSong) void publish(props.currentSong, audio.currentTime, !audio.paused, false, 'control', true); };
    audio.addEventListener('seeked', onSeeked);
    return () => audio.removeEventListener('seeked', onSeeked);
  }, [props.audioElement, props.currentSongKey, room?.roomId, isLeader, publish]);

  const addCurrent = async (): Promise<void> => {
    if (!client || !roomIdValue || !props.currentSong) return;
    await client.mutation(api.luvLink.addQueueItem, { roomId: roomIdValue!, commandId: commandId(), song: props.currentSong, next: false })
      .then(() => setMessage('Added to the LuvLink queue.')).catch(error => setMessage(readableError(error)));
  };
  const addPick = async (song: SongSnapshot): Promise<void> => {
    if (!client || !roomIdValue) return;
    await client.mutation(api.luvLink.addQueueItem, { roomId: roomIdValue, commandId: commandId(), song, next: false })
      .then(() => setMessage('Added a group pick to the queue.')).catch(error => setMessage(readableError(error)));
  };
  const inviteHref = useMemo(() => {
    if (!createdCode || typeof window === 'undefined') return null;
    try {
      const origin = new URL(process.env.NEXT_PUBLIC_WEB_ORIGIN || window.location.origin);
      return origin.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(origin.hostname)
        ? `${origin.origin}${paths.luvLinkJoin(createdCode)}` : null;
    } catch { return null; }
  }, [createdCode]);
  // Encoded on this device: the private invite link never goes to a QR service.
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setInviteQr(null);
    if (inviteHref) void QRCode.toDataURL(inviteHref, { margin: 1, width: 168 }).then(url => { if (current) setInviteQr(url); }).catch(() => undefined);
    return () => { current = false; };
  }, [inviteHref]);

  const shareInvite = async (): Promise<void> => {
    if (!inviteHref) return;
    if (navigator.share) await navigator.share({ title: 'Join my LuvLink', text: 'Different places. Same song.', url: inviteHref }).catch(() => undefined);
    else await navigator.clipboard.writeText(inviteHref).then(() => setMessage('Invite link copied.')).catch(() => setMessage('Could not copy the invite link.'));
  };

  if (!props.signedIn) return <section className="luvlink-page"><div className="luvlink-card"><span className="luvlink-kicker">LUVLINK</span><h1>Different places. Same song.</h1><p>Sign in to start a room or join a private invite.</p><button className="luvlink-primary" onClick={props.onSignIn}><LogIn size={17} /> Sign in to continue</button></div></section>;
  if (!client) return <section className="luvlink-page"><div className="luvlink-card"><span className="luvlink-kicker">LUVLINK</span><h1>Realtime rooms need a connection</h1><p>Convex is not configured in this build.</p></div></section>;
  if (!roomId) return <section className="luvlink-page">
    <div className="luvlink-card luvlink-intro"><span className="luvlink-kicker">LUVLINK · LISTEN IN SYNC</span><h1>Different places.<br /><em>Same song.</em></h1><p>Bring your people into the moment. Everyone listens on their own device, or one person plays for the room.</p>
      <label>Your name<input value={name} maxLength={40} onChange={event => setName(event.target.value)} /></label>
      <button className="luvlink-primary" disabled={busy} onClick={() => void createRoom()}><Users size={17} /> {busy ? 'Starting…' : 'Start a LuvLink'}</button>
      {!props.currentSong ? <small>You can choose music after the room starts.</small> : null}
      <div className="luvlink-join"><label htmlFor="luvlink-code">Have an invite code?</label><div><input id="luvlink-code" value={inviteCode} maxLength={8} placeholder="8 character code" onChange={event => setInviteCode(event.target.value.toUpperCase())} /><button className="luvlink-secondary" disabled={busy || inviteCode.trim().length !== 8} onClick={() => void join()}>{busy ? 'Joining…' : 'Join'}</button></div></div>
      {props.inviteCode ? <button className="luvlink-primary" disabled={busy} onClick={() => void join(props.inviteCode!)}>{busy ? 'Joining…' : 'Join this invite'}</button> : null}
      {message ? <p className="luvlink-error" role="alert">{message}</p> : null}
    </div>
  </section>;
  if (!room) return <section className="luvlink-page"><div className="luvlink-card"><span className="luvlink-kicker">LUVLINK</span><h1>This room is unavailable</h1><p>It may have expired, ended, or your invite access was revoked.</p><button className="luvlink-secondary" onClick={() => router.push(paths.luvLink)}>Back to LuvLink</button></div></section>;

  return <section className="luvlink-page" aria-labelledby="luvlink-title">
    <header className="luvlink-room-head"><div><span className="luvlink-kicker">LUVLINK · {room.mode === 'speaker' ? 'ONE SPEAKER' : 'EVERYONE LISTENS'}</span><h1 id="luvlink-title">On the same wavelength.</h1><p>{isLeader ? 'Your device is the active output.' : `Following ${members.find(member => member.userId === room.leaderUserId)?.displayName ?? 'the room'}.`}</p></div><button className="luvlink-icon" aria-label="Leave LuvLink" title="Leave LuvLink" onClick={() => void client.mutation(api.luvLink.leaveRoom, { roomId: roomIdValue! }).then(() => router.push(paths.luvLink)).catch(error => setMessage(readableError(error)))}><X size={18} /></button></header>
    <div className="luvlink-grid">
      <div className="luvlink-card luvlink-now">
        <div className="luvlink-art">{playback?.song?.artwork ? <img src={playback.song.artwork} alt="" /> : <Music2 size={34} />}</div>
        <span className="luvlink-kicker">{playback?.playing ? 'PLAYING TOGETHER' : 'ROOM PLAYBACK'}</span>
        <h2>{playback?.song?.title ?? props.currentSong?.title ?? 'Pick a song to begin'}</h2><p>{playback?.song?.artist ?? props.currentSong?.artist ?? 'Your room is ready'}</p>
        <div className="luvlink-time"><span>{Math.floor(projected / 60)}:{String(Math.floor(projected % 60)).padStart(2, '0')}</span><span>{playback?.song ? `${Math.floor(playback.song.duration / 60)}:${String(Math.floor(playback.song.duration % 60)).padStart(2, '0')}` : '--:--'}</span></div>
        <div className="luvlink-controls">
          <button className="luvlink-primary" disabled={!canControl} onClick={() => void publish(playback?.song ?? props.currentSong, projected || props.positionSec, !playback?.playing)}>{playback?.playing ? <Pause size={17} /> : <Play size={17} />} {playback?.playing ? 'Pause for everyone' : 'Play for everyone'}</button>
          <button className="luvlink-secondary" disabled={!canControl || queue.entries.length === 0} onClick={() => void publish(null, 0, true, true)}><SkipForward size={16} /> Play next</button>
        </div>
        {tapToListen ? <button className="luvlink-tap" onClick={() => playback && void applyAnchor(playback)}>Tap to listen</button> : null}
      </div>
      <aside className="luvlink-card luvlink-side">
        <div className="luvlink-section-head"><div><span className="luvlink-kicker">YOUR CIRCLE</span><h2>{members.length} listening</h2></div><span className="luvlink-online">{online.length} online</span></div>
        <div className="luvlink-members">{members.map(member => <div className="luvlink-member" key={member.userId}><span className="luvlink-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span><span>{member.displayName}{member.userId === props.userId ? ' · you' : ''}</span><small>{member.role === 'host' ? 'host' : member.userId === room.leaderUserId ? 'speaker' : canControl && member.canControl ? 'controller' : 'listener'}</small>{online.includes(member.userId) ? <i aria-label="Online" /> : null}{member.role !== 'host' && me?.role === 'host' ? <button className="luvlink-permission" onClick={() => void client.mutation(api.luvLink.setController, { roomId: roomIdValue!, targetUserId: member.userId, canControl: !member.canControl }).catch(error => setMessage(readableError(error)))}>{member.canControl ? 'Remove control' : 'Allow control'}</button> : null}</div>)}</div>
        {me?.role === 'host' ? <div className="luvlink-mode"><span>Room style</span><button className={room.mode === 'listen' ? 'selected' : ''} onClick={() => void client.mutation(api.luvLink.setRoomMode, { roomId: roomIdValue!, mode: 'listen' })}>Listen on devices</button><button className={room.mode === 'speaker' ? 'selected' : ''} onClick={() => void client.mutation(api.luvLink.setRoomMode, { roomId: roomIdValue!, mode: 'speaker' })}>One shared speaker</button>{room.mode === 'speaker' ? <label>Output<select value={room.leaderUserId} onChange={event => void client.mutation(api.luvLink.setSpeaker, { roomId: roomIdValue!, commandId: commandId(), targetUserId: event.target.value }).catch(error => setMessage(readableError(error)))}>{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></label> : null}</div> : null}
        {createdCode || me?.role === 'host' ? <div className="luvlink-invite"><span>Invite friends</span>{createdCode ? <strong>{createdCode}</strong> : null}{inviteQr ? <img className="luvlink-qr" src={inviteQr} width={168} height={168} alt="QR code for the LuvLink invite link" /> : null}<button className="luvlink-secondary" onClick={() => { if (inviteHref) void shareInvite(); else void client.mutation(api.luvLink.regenerateInvite, { roomId: roomIdValue! }).then(result => { setCreatedCode(result.code); setMessage('New invite link is ready.'); }).catch(error => setMessage(readableError(error))); }}><Share2 size={15} /> {createdCode ? 'Share invite link' : 'Create invite link'}</button><button className="luvlink-text-button" onClick={() => void client.mutation(api.luvLink.revokeInvite, { roomId: roomIdValue! }).then(() => { setCreatedCode(null); setMessage('Invite revoked.'); }).catch(error => setMessage(readableError(error)))}>Revoke invite</button></div> : null}
      </aside>
    </div>
    <div className="luvlink-card luvlink-queue"><div className="luvlink-section-head"><div><span className="luvlink-kicker">COMING UP</span><h2>Room queue <small>{queue.entries.length}/100</small></h2></div><button className="luvlink-secondary" disabled={!props.currentSong} onClick={() => void addCurrent()}><Plus size={15} /> Add current song</button></div>
      {queue.entries.length ? <ol>{queue.entries.map((entry, index) => <li key={entry.entryId}><span className="luvlink-queue-index">{index + 1}</span><div><strong>{entry.song.title}</strong><small>{entry.song.artist} · added by {entry.addedByName}</small></div>{canControl ? <><button className="luvlink-text-button" aria-label={`Move ${entry.song.title} earlier`} disabled={index === 0} onClick={() => void client.mutation(api.luvLink.moveQueueItem, { roomId: roomIdValue!, commandId: commandId(), entryId: entry.entryId, beforeEntryId: queue.entries[index - 1]!.entryId, expectedRevision: queue.revision }).catch(error => setMessage(readableError(error)))}>↑</button><button className="luvlink-text-button" aria-label={`Remove ${entry.song.title}`} onClick={() => void client.mutation(api.luvLink.removeQueueItem, { roomId: roomIdValue!, commandId: commandId(), entryId: entry.entryId, expectedRevision: queue.revision }).catch(error => setMessage(readableError(error)))}>Remove</button></> : null}</li>)}</ol> : <div className="luvlink-empty"><Music2 size={20} /><p>The room queue is clear.</p><small>Add the song playing now to keep the vibe going.</small></div>}
    </div>
    <div className="luvlink-card luvlink-picks"><div className="luvlink-section-head"><div><span className="luvlink-kicker">MADE FOR THE ROOM</span><h2>Group picks</h2></div><button className="luvlink-secondary" onClick={() => void client.mutation(api.luvLink.refreshGroupPicks, { roomId: roomIdValue! }).catch(error => setMessage(readableError(error)))}>Refresh picks</button></div>
      <label className="luvlink-consent"><input type="checkbox" checked={Boolean(me?.canSuggest)} onChange={event => void client.mutation(api.luvLink.setSuggestionsConsent, { roomId: roomIdValue!, enabled: event.target.checked }).catch(error => setMessage(readableError(error)))} /> Share my recent listening for group picks</label>
      {picks.picks.length ? <ol>{picks.picks.map(pick => <li key={pick.song.ref}><span className="luvlink-avatar">{pick.kind === 'shared' ? '♡' : '♪'}</span><div><strong>{pick.song.title}</strong><small>{pick.song.artist} · {pick.kind === 'shared' ? 'shared favorite' : 'someone’s pick'}</small></div><button className="luvlink-text-button" aria-label={`Add ${pick.song.title} to queue`} onClick={() => void addPick(pick.song)}>Add</button></li>)}</ol> : <p className="luvlink-empty">Opt in to recent listening, then refresh to find songs your circle already loves.</p>}
    </div>
    {message ? <p className="luvlink-notice" role="status">{message}</p> : null}
  </section>;
}
