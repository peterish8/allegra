'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthToken } from '@convex-dev/auth/react';
import { makeFunctionReference } from 'convex/server';
import type { ConvexReactClient } from 'convex/react';

import type { SongSnapshot } from '@shared/songRef';
import { fromAllegraSong, parseSongRef, toAllegraId } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';
import {
  createConnectSession,
  systemClock,
  type ConnectCommand,
  type ConnectDevice,
  type ConnectPlayerState,
  type ConnectSession,
  type ConnectSnapshot,
  type ConnectTransport,
  type DeviceRegistration,
  type MutationResult,
  type PlayerPort,
  type PlayerSnapshot,
  type PlayerStatePatch,
  type RemoteCommand,
  type RepeatMode
} from '../../../../packages/connect/src/index';
import { useConvexAppClient } from '../../app/ConvexSignInProvider';
import { useSignIn } from '../auth/SignInContext';
import type { AudioPlayerState } from './useAudioPlayer';
import { exactSaavnMatch, type LibrarySong } from '../lib/libraryRows';
import { fetchSongsByIds, searchSongs } from '../lib/api';
import { accountIdFromToken, deviceIdForAccount } from '../lib/connectDeviceId';

interface DeviceRow {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: 'web' | 'android' | 'ios';
  readonly appVersion: string;
  readonly canPlay: boolean;
  readonly isOnline: boolean;
  readonly isActive: boolean;
}

interface CommandRow {
  readonly commandId: string;
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly kind: RemoteCommand['kind'];
  readonly args?: Record<string, unknown>;
  readonly createdAt: number;
  readonly status: 'pending' | 'done' | 'failed';
  readonly error?: string;
}

const registerRef = makeFunctionReference<'mutation', { deviceId: string; name: string; kind: 'web' | 'android' | 'ios'; appVersion: string; canPlay: boolean }, MutationResult>('connect:register');
const heartbeatRef = makeFunctionReference<'mutation', { deviceId: string }, MutationResult>('connect:heartbeat');
const devicesRef = makeFunctionReference<'query', Record<string, never>, DeviceRow[]>('connect:devices');
const stateRef = makeFunctionReference<'query', Record<string, never>, ConnectPlayerState | null>('connect:state');
const commandsRef = makeFunctionReference<'query', { deviceId: string }, CommandRow[]>('connect:commandsFor');
const reportRef = makeFunctionReference<'mutation', { deviceId: string; patch: PlayerStatePatch; rev: number }, MutationResult>('connect:report');
const claimRef = makeFunctionReference<'mutation', { deviceId: string; snapshot: PlayerSnapshot }, MutationResult>('connect:claim');
const sendRef = makeFunctionReference<'mutation', { fromDeviceId: string; targetDeviceId: string; kind: RemoteCommand['kind']; args?: Record<string, unknown> }, { commandId: string; serverNow: number }>('connect:send');
const ackRef = makeFunctionReference<'mutation', { deviceId: string; commandId: string; ok: boolean; error?: string }, MutationResult>('connect:ack');
const transferRef = makeFunctionReference<'mutation', { fromDeviceId: string; toDeviceId: string }, { commandId: string; serverNow: number }>('connect:transfer');

function remoteCommand(row: CommandRow): RemoteCommand {
  const args = row.args ?? {};
  switch (row.kind) {
    case 'play':
    case 'pause':
    case 'next':
    case 'prev':
      return { kind: row.kind };
    case 'seek':
      return { kind: 'seek', sec: Number(args.sec) };
    case 'volume':
      return { kind: 'volume', v: Number(args.v) };
    case 'shuffle':
      return { kind: 'shuffle', on: Boolean(args.on) };
    case 'repeat':
      return { kind: 'repeat', mode: args.mode as RepeatMode };
    case 'play_song':
      return { kind: 'play_song', song: args.song as SongSnapshot, ...(Array.isArray(args.queue) ? { queue: args.queue as SongSnapshot[] } : {}) };
    case 'queue_add':
      return { kind: 'queue_add', song: args.song as SongSnapshot };
    case 'take_over':
      return { kind: 'take_over', state: args.state as ConnectPlayerState };
  }
}

class ConvexConnectTransport implements ConnectTransport {
  public constructor(private readonly client: ConvexReactClient) {}

  public register(device: DeviceRegistration): Promise<MutationResult> {
    return this.client.mutation(registerRef, device);
  }

  public heartbeat(deviceId: string): Promise<MutationResult> {
    return this.client.mutation(heartbeatRef, { deviceId });
  }

  public watch(deviceId: string, listener: (snapshot: ConnectSnapshot) => void): () => void {
    let devices: DeviceRow[] = [];
    let state: ConnectPlayerState | null = null;
    let commands: CommandRow[] = [];
    const publish = (): void => {
      const connectDevices: ConnectDevice[] = devices.map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        kind: device.kind,
        appVersion: device.appVersion,
        canPlay: device.canPlay,
        isOnline: device.isOnline,
        lastSeenAt: device.isOnline ? Date.now() : 0
      }));
      const connectCommands: ConnectCommand[] = commands.map((row) => ({
        id: row.commandId,
        userDeviceId: row.sourceDeviceId,
        targetDeviceId: row.targetDeviceId,
        command: remoteCommand(row),
        createdAt: row.createdAt,
        status: row.status,
        ...(row.error ? { error: row.error } : {})
      }));
      listener({
        serverNow: Date.now(),
        devices: connectDevices,
        ...(state ? { state } : {}),
        commands: connectCommands
      });
    };
    const deviceWatch = this.client.watchQuery(devicesRef, {});
    const stateWatch = this.client.watchQuery(stateRef, {});
    const commandWatch = this.client.watchQuery(commandsRef, { deviceId });
    const stopDevices = deviceWatch.onUpdate(() => {
      try { devices = deviceWatch.localQueryResult() ?? []; publish(); } catch { /* the signed-in query will retry */ }
    });
    const stopState = stateWatch.onUpdate(() => {
      try { state = stateWatch.localQueryResult() ?? null; publish(); } catch { /* the signed-in query will retry */ }
    });
    const stopCommands = commandWatch.onUpdate(() => {
      try { commands = commandWatch.localQueryResult() ?? []; publish(); } catch { /* the signed-in query will retry */ }
    });
    // Subscribe before reading cached results so a change cannot land in the gap between the two.
    // The listeners above handle the first server result when nothing is cached yet.
    try { devices = deviceWatch.localQueryResult() ?? []; } catch { /* the first server result is pending */ }
    try { state = stateWatch.localQueryResult() ?? null; } catch { /* the first server result is pending */ }
    try { commands = commandWatch.localQueryResult() ?? []; } catch { /* the first server result is pending */ }
    publish();
    return () => {
      stopDevices();
      stopState();
      stopCommands();
    };
  }

  public report(deviceId: string, patch: PlayerStatePatch, rev: number): Promise<MutationResult> {
    return this.client.mutation(reportRef, { deviceId, patch, rev });
  }

  public claim(deviceId: string, snapshot: PlayerSnapshot): Promise<MutationResult> {
    if (!snapshot.song) return Promise.reject(new Error('There is no song to claim.'));
    return this.client.mutation(claimRef, { deviceId, snapshot });
  }

  public async send(fromDeviceId: string, targetDeviceId: string, command: RemoteCommand): Promise<{ commandId: string; serverNow: number }> {
    const { kind, ...args } = command;
    return this.client.mutation(sendRef, {
      fromDeviceId,
      targetDeviceId,
      kind,
      ...(Object.keys(args).length ? { args } : {})
    });
  }

  public ack(deviceId: string, commandId: string, result: { readonly ok: boolean; readonly error?: string }): Promise<MutationResult> {
    return this.client.mutation(ackRef, { deviceId, commandId, ...result });
  }

  public transfer(fromDeviceId: string, toDeviceId: string): Promise<{ commandId: string; serverNow: number }> {
    return this.client.mutation(transferRef, { fromDeviceId, toDeviceId });
  }
}

function snapshotFromSong(song: UnifiedSong): SongSnapshot | null {
  const librarySong = song as LibrarySong;
  const ref = librarySong.libraryRef ?? fromAllegraSong(song);
  if (!ref) return null;
  return librarySong.librarySnapshot ?? {
    ref,
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    artwork: song.artwork,
    duration: song.duration
  };
}

function songFromSnapshot(snapshot: SongSnapshot): LibrarySong {
  const source = parseSongRef(snapshot.ref)?.source;
  return {
    id: `library:${snapshot.ref}`,
    title: snapshot.title,
    artist: snapshot.artist,
    ...(snapshot.album ? { album: snapshot.album } : {}),
    artwork: snapshot.artwork,
    streamUrl: '',
    duration: snapshot.duration,
    hasLyrics: false,
    playCount: 0,
    source: source === 'gaana' ? 'Gaana' : 'Saavn',
    libraryRef: snapshot.ref,
    librarySnapshot: snapshot
  };
}

async function resolvePlayable(snapshot: SongSnapshot): Promise<LibrarySong | null> {
  const parsed = parseSongRef(snapshot.ref);
  const id = toAllegraId(snapshot.ref);
  if (id || parsed?.source === 'gaana') {
    const catalogId = parsed?.source === 'gaana' ? snapshot.ref : id;
    const songs = await fetchSongsByIds(catalogId ? [catalogId] : []);
    const exact = songs.find((song) => fromAllegraSong(song) === snapshot.ref);
    if (exact) return { ...exact, libraryRef: snapshot.ref, librarySnapshot: snapshot };
  }
  const { results } = await searchSongs(`${snapshot.title} ${snapshot.artist}`);
  const match = exactSaavnMatch(snapshot, results);
  return match ? { ...match, libraryRef: snapshot.ref, librarySnapshot: snapshot } : null;
}

function browserDeviceId(accountId: string): string {
  const params = new URLSearchParams(window.location.search);
  const harnessId = process.env.NODE_ENV === 'development' ? params.get('connectDevice') : null;
  const storage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value)
  };
  return deviceIdForAccount(accountId, storage, () => crypto.randomUUID(), harnessId);
}

function browserDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'Device';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

function audioSnapshot(audio: AudioPlayerState): PlayerSnapshot {
  const song = audio.currentSong ? snapshotFromSong(audio.currentSong) ?? undefined : undefined;
  const queue = audio.queue
    .filter((item) => item.id !== audio.currentSong?.id)
    .map(snapshotFromSong)
    .filter((item): item is SongSnapshot => item !== null)
    .slice(0, 50);
  return {
    ...(song ? { song } : {}),
    queue,
    isPlaying: audio.isPlaying,
    positionSec: audio.audioRef.current?.currentTime ?? audio.currentTime,
    volume: audio.volume,
    shuffle: audio.shuffle,
    repeat: audio.repeat
  };
}

function waitForMetadata(audio: HTMLAudioElement): Promise<boolean> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('error', onError);
      resolve(ready);
    };
    const onReady = (): void => done(true);
    const onError = (): void => done(false);
    const timeout = window.setTimeout(() => done(false), 12_000);
    audio.addEventListener('loadedmetadata', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
  });
}

export interface WebConnectState {
  readonly session: ConnectSession | null;
  readonly view: ReturnType<ConnectSession['view']> | null;
  readonly deviceId: string | null;
  readonly connected: boolean;
  readonly transferTo: (deviceId: string) => Promise<boolean>;
  readonly playRemote: (song: UnifiedSong, queue: readonly UnifiedSong[]) => boolean;
}

export function useConnect(audio: AudioPlayerState): WebConnectState {
  const convex = useConvexAppClient();
  const signIn = useSignIn();
  const authToken = useAuthToken();
  // The subject is used only to scope a local device ID; Convex still derives
  // authorization server-side. The auth hook's default is null without a provider.
  const accountId = accountIdFromToken(authToken);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const listenersRef = useRef(new Set<(snapshot: PlayerSnapshot) => void>());
  const sessionRef = useRef<ConnectSession | null>(null);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [view, setView] = useState<ReturnType<ConnectSession['view']> | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const player = useMemo<PlayerPort>(() => ({
    getSnapshot: () => audioSnapshot(audioRef.current),
    onChange(listener) {
      listenersRef.current.add(listener);
      listener(audioSnapshot(audioRef.current));
      return () => listenersRef.current.delete(listener);
    },
    async play() {
      await audioRef.current.requestPlayback(true);
      return audioRef.current.audioRef.current?.paused ? 'needs_gesture' : 'ok';
    },
    async pause() { await audioRef.current.requestPlayback(false); },
    async seek(sec) { await audioRef.current.seek(sec); },
    async setVolume(volume) { audioRef.current.setVolume(volume); },
    async load(song, queue, options) {
      let current: LibrarySong | null;
      try { current = await resolvePlayable(song); } catch { return 'not_found'; }
      if (!current?.streamUrl) return 'not_found';
      const resolvedQueue = await Promise.all(queue.slice(0, 49).map((item) => resolvePlayable(item).catch(() => null)));
      const nextQueue = [current, ...resolvedQueue.filter((item): item is LibrarySong => Boolean(item?.streamUrl))];
      const target = audioRef.current;
      target.loadForConnect(current, nextQueue, false);
      const element = target.audioRef.current;
      if (!element || !(await waitForMetadata(element))) return 'not_found';
      await target.seek(options.positionSec);
      if (!options.play) {
        await target.requestPlayback(false);
        return 'ok';
      }
      await target.requestPlayback(true);
      return element.paused ? 'needs_gesture' : 'ok';
    },
    async next() { audioRef.current.skipNext(); },
    async previous() { audioRef.current.skipPrevious(); },
    async setShuffle(on) {
      if (audioRef.current.shuffle !== on) audioRef.current.toggleShuffle();
    },
    async setRepeat(mode) {
      for (let count = 0; count < 3 && audioRef.current.repeat !== mode; count += 1) audioRef.current.cycleRepeat();
    },
    async addToQueue(song) {
      const playable = await resolvePlayable(song);
      if (playable) audioRef.current.appendQueue([playable]);
    }
  }), []);

  useEffect(() => {
    const next = audioSnapshot(audio);
    for (const listener of listenersRef.current) listener(next);
  }, [audio.currentSong, audio.queue, audio.isPlaying, audio.currentTime, audio.volume, audio.shuffle, audio.repeat]);

  useEffect(() => {
    if (!convex || !signIn.signedIn || !signIn.available || typeof accountId !== 'string' || !accountId) {
      setSession(null);
      setView(null);
      setDeviceId(null);
      return undefined;
    }
    const localDeviceId = browserDeviceId(accountId);
    const transport = new ConvexConnectTransport(convex);
    const created = createConnectSession({
      transport,
      player,
      device: { deviceId: localDeviceId, name: browserDeviceName(), kind: 'web', appVersion: 'web-connect-1', canPlay: true },
      clock: systemClock
    });
    sessionRef.current = created;
    setDeviceId(localDeviceId);
    setSession(created);
    const stopView = created.subscribe(setView);
    const updateVisibility = (): void => created.setVisible(document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      stopView();
      created.dispose();
      if (sessionRef.current === created) sessionRef.current = null;
      setSession(null);
      setView(null);
    };
  }, [accountId, convex, player, signIn.available, signIn.signedIn]);

  const transferTo = useCallback(async (targetDeviceId: string): Promise<boolean> => {
    const result = await sessionRef.current?.transferTo(targetDeviceId);
    return result?.ok ?? false;
  }, []);

  const playRemote = useCallback((song: UnifiedSong, queue: readonly UnifiedSong[]): boolean => {
    const current = sessionRef.current;
    const currentView = current?.view();
    const snapshot = snapshotFromSong(song);
    if (!current || !currentView?.activeDeviceId || currentView.isThisDeviceActive || !snapshot) return false;
    const queueSnapshots = queue
      .filter((item) => item.id !== song.id)
      .map(snapshotFromSong)
      .filter((item): item is SongSnapshot => item !== null)
      .slice(0, 50);
    current.control({ kind: 'play_song', song: snapshot, queue: queueSnapshots });
    return true;
  }, []);

  return { session, view, deviceId, connected: Boolean(convex && signIn.signedIn), transferTo, playRemote };
}

export function snapshotToDisplaySong(snapshot: SongSnapshot): LibrarySong {
  return songFromSnapshot(snapshot);
}

export function snapshotForSong(song: UnifiedSong): SongSnapshot | null {
  return snapshotFromSong(song);
}

export async function resolveSnapshotForPlayback(snapshot: SongSnapshot): Promise<LibrarySong | null> {
  return resolvePlayable(snapshot);
}
