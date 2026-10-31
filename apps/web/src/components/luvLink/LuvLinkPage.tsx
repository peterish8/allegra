'use client';

import { LogIn, Music2, Pause, Play, Plus, Share2, SkipForward, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import type { SongSnapshot } from '@shared/songRef';

import { paths } from '../../lib/routes';
import { useLuvLinkSession, type LuvLinkSession } from './LuvLinkSession';
import { readableLuvLinkError as readableError } from './sync';

const commandId = (): string => crypto.randomUUID();

/** The room's position, ticking while it plays. Read from the session so a pause never reuses a stale projection. */
function useRoomPosition(session: LuvLinkSession): number {
  const { playback, readPositionSec } = session;
  const [position, setPosition] = useState(0);
  useEffect(() => {
    setPosition(readPositionSec());
    if (!playback?.playing) return;
    const timer = window.setInterval(() => setPosition(readPositionSec()), 500);
    return () => window.clearInterval(timer);
  }, [playback, readPositionSec]);
  return position;
}

export interface LuvLinkPageProps {
  readonly displayName: string;
  readonly inviteCode: string | null;
  /** The room named by the URL; the session keeps its room when the URL has none. */
  readonly roomId: string | null;
  readonly currentSong: SongSnapshot | null;
  readonly onSignIn: () => void;
}

export function LuvLinkPage(props: LuvLinkPageProps) {
  const session = useLuvLinkSession();
  const router = useRouter();
  const { client, room, members, queue, picks, online, me, isLeader, canControl, playback, busy, message, createdCode, tapToListen, userId } = session;
  const roomId = session.roomId;
  const roomIdValue = roomId as Id<'luvLinkRooms'>;
  const { enterRoom, setMessage, setCreatedCode } = session;
  const [inviteCode, setInviteCode] = useState(props.inviteCode ?? '');
  const [name, setName] = useState(props.displayName || 'Listener');
  const projected = useRoomPosition(session);

  useEffect(() => { if (props.inviteCode) setInviteCode(props.inviteCode); }, [props.inviteCode]);
  useEffect(() => { if (props.roomId) enterRoom(props.roomId); }, [props.roomId, enterRoom]);
  // Coming back to /luvlink while in a room shows that room, at an address a reload can open.
  useEffect(() => {
    if (!props.roomId && !props.inviteCode && roomId) router.replace(paths.luvLinkRoom(roomId));
  }, [props.roomId, props.inviteCode, roomId, router]);

  const createRoom = async (): Promise<void> => {
    const id = await session.createRoom(name);
    if (id) { setInviteCode(''); router.push(paths.luvLinkRoom(id)); }
  };

  const join = async (rawCode = inviteCode): Promise<void> => {
    const id = await session.joinRoom(rawCode, name);
    if (id) router.replace(paths.luvLinkRoom(id));
  };

  const addCurrent = async (): Promise<void> => { if (props.currentSong) await session.addQueueItem(props.currentSong); };
  const addPick = async (song: SongSnapshot): Promise<void> => { await session.addQueueItem(song); };
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

  if (!session.signedIn) return <section className="luvlink-page"><div className="luvlink-card"><span className="luvlink-kicker">LUVLINK</span><h1>Different places. Same song.</h1><p>Sign in to start a room or join a private invite.</p><button className="luvlink-primary" onClick={props.onSignIn}><LogIn size={17} /> Sign in to continue</button></div></section>;
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
  if (session.roomLoading) return <section className="luvlink-page"><div className="luvlink-card"><span className="luvlink-kicker">LUVLINK</span><h1>Opening your room…</h1></div></section>;
  if (!room) return <section className="luvlink-page"><div className="luvlink-card"><span className="luvlink-kicker">LUVLINK</span><h1>This room is unavailable</h1><p>It may have expired, ended, or your invite access was revoked.</p><button className="luvlink-secondary" onClick={() => { enterRoom(null); router.push(paths.luvLink); }}>Back to LuvLink</button></div></section>;

  return <section className="luvlink-page" aria-labelledby="luvlink-title">
    <header className="luvlink-room-head"><div><span className="luvlink-kicker">LUVLINK · {room.mode === 'speaker' ? 'ONE SPEAKER' : 'EVERYONE LISTENS'}</span><h1 id="luvlink-title">On the same wavelength.</h1><p>{isLeader ? 'Your device is the active output.' : `Following ${members.find(member => member.userId === room.leaderUserId)?.displayName ?? 'the room'}.`}</p></div><button className="luvlink-icon" aria-label="Leave LuvLink" title="Leave LuvLink" onClick={() => void session.leaveRoom().then(left => { if (left) router.push(paths.luvLink); })}><X size={18} /></button></header>
    <div className="luvlink-grid">
      <div className="luvlink-card luvlink-now">
        <div className="luvlink-art">{playback?.song?.artwork ? <img src={playback.song.artwork} alt="" /> : <Music2 size={34} />}</div>
        <span className="luvlink-kicker">{playback?.playing ? 'PLAYING TOGETHER' : 'ROOM PLAYBACK'}</span>
        <h2>{playback?.song?.title ?? props.currentSong?.title ?? 'Pick a song to begin'}</h2><p>{playback?.song?.artist ?? props.currentSong?.artist ?? 'Your room is ready'}</p>
        <div className="luvlink-time"><span>{Math.floor(projected / 60)}:{String(Math.floor(projected % 60)).padStart(2, '0')}</span><span>{playback?.song ? `${Math.floor(playback.song.duration / 60)}:${String(Math.floor(playback.song.duration % 60)).padStart(2, '0')}` : '--:--'}</span></div>
        <div className="luvlink-controls">
          <button className="luvlink-primary" disabled={!canControl} onClick={() => void session.publish(playback?.song ?? props.currentSong, session.readPositionSec(), !playback?.playing)}>{playback?.playing ? <Pause size={17} /> : <Play size={17} />} {playback?.playing ? 'Pause for everyone' : 'Play for everyone'}</button>
          <button className="luvlink-secondary" disabled={!canControl || queue.entries.length === 0} onClick={() => void session.publish(null, 0, true, { next: true })}><SkipForward size={16} /> Play next</button>
        </div>
        {tapToListen ? <button className="luvlink-tap" onClick={session.listenNow}>Tap to listen</button> : null}
      </div>
      <aside className="luvlink-card luvlink-side">
        <div className="luvlink-section-head"><div><span className="luvlink-kicker">YOUR CIRCLE</span><h2>{members.length} listening</h2></div><span className="luvlink-online">{online.length} online</span></div>
        <div className="luvlink-members">{members.map(member => <div className="luvlink-member" key={member.userId}><span className="luvlink-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span><span>{member.displayName}{member.userId === userId ? ' · you' : ''}</span><small>{member.role === 'host' ? 'host' : member.userId === room.leaderUserId ? 'speaker' : canControl && member.canControl ? 'controller' : 'listener'}</small>{online.includes(member.userId) ? <i aria-label="Online" /> : null}{member.role !== 'host' && me?.role === 'host' ? <button className="luvlink-permission" onClick={() => void client.mutation(api.luvLink.setController, { roomId: roomIdValue!, targetUserId: member.userId, canControl: !member.canControl }).catch(error => setMessage(readableError(error)))}>{member.canControl ? 'Remove control' : 'Allow control'}</button> : null}</div>)}</div>
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
