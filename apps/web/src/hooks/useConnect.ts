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
  createConvexTransport,
  createDevelopmentTrace,
  traceCatalogLookup,
  systemClock,
  type ConnectSession,
  type ConnectView,
  type DevelopmentTraceBuffer,
  type ConvexWireClient,
  type PlayerPort,
  type PlayerSnapshot,
  type RemoteCommand
} from '../../../../packages/connect/src/index';
import { useConvexAppClient } from '../../app/ConvexSignInProvider';
import { useSignIn } from '../auth/SignInContext';
import type { AudioPlayerState } from './useAudioPlayer';
import { exactSaavnMatch, type LibrarySong } from '../lib/libraryRows';
import { fetchSongsByIds, searchSongs } from '../lib/api';
import { accountIdFromToken, deviceIdForAccount } from '../lib/connectDeviceId';

function createWebConnectTransport(client: ConvexReactClient, trace?: DevelopmentTraceBuffer) {
  const binding: ConvexWireClient = {
    mutation(name, args) {
      const reference = makeFunctionReference<'mutation', Record<string, unknown>, unknown>(name);
      return client.mutation(reference, args);
    },
    watchQuery(name, args) {
      const reference = makeFunctionReference<'query', Record<string, unknown>, unknown>(name);
      const watch = client.watchQuery(reference, args);
      return {
        onUpdate: callback => watch.onUpdate(callback),
        current: () => watch.localQueryResult()
      };
    }
  };
  return createConvexTransport(binding, trace ? { trace } : undefined);
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

async function resolvePlayable(snapshot: SongSnapshot, trace?: DevelopmentTraceBuffer): Promise<LibrarySong | null> {
  const parsed = parseSongRef(snapshot.ref);
  const id = toAllegraId(snapshot.ref);
  if (id || parsed?.source === 'gaana') {
    const catalogId = parsed?.source === 'gaana' ? snapshot.ref : id;
    const songs = await traceCatalogLookup(trace, () => fetchSongsByIds(catalogId ? [catalogId] : []));
    const exact = songs.find((song) => fromAllegraSong(song) === snapshot.ref);
    if (exact) return { ...exact, libraryRef: snapshot.ref, librarySnapshot: snapshot };
  }
  const { results } = await traceCatalogLookup(trace, () => searchSongs(`${snapshot.title} ${snapshot.artist}`));
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

async function resolveQueueInOrder(
  queue: readonly SongSnapshot[],
  trace: DevelopmentTraceBuffer | undefined,
  isCurrent: () => boolean
): Promise<LibrarySong[]> {
  const results: (LibrarySong | null)[] = new Array(queue.length).fill(null);
  const lookups = new Map<string, Promise<LibrarySong | null>>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length && isCurrent()) {
      const index = cursor++;
      const snapshot = queue[index];
      let lookup = lookups.get(snapshot.ref);
      if (!lookup) {
        lookup = resolvePlayable(snapshot, trace).catch(() => null);
        lookups.set(snapshot.ref, lookup);
      }
      results[index] = await lookup;
    }
  };
  await Promise.all([worker(), worker()]);
  return results.filter((song): song is LibrarySong => Boolean(song?.streamUrl));
}

export interface WebConnectState {
  readonly session: ConnectSession | null;
  readonly view: ConnectView | null;
  readonly deviceId: string | null;
  readonly connected: boolean;
  readonly tabStatus: 'starting' | 'leader' | 'other-tab' | null;
  readonly livePosition: number;
  readonly control: (command: RemoteCommand) => void;
  /** `error` is listener copy for a failed move. */
  readonly transferTo: (deviceId: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly playRemote: (song: UnifiedSong, queue: readonly UnifiedSong[]) => boolean;
}

type ConnectTabMessage =
  | { readonly type: 'view'; readonly deviceId: string; readonly view: ConnectView }
  | { readonly type: 'position'; readonly deviceId: string; readonly positionSec: number }
  | { readonly type: 'control'; readonly command: RemoteCommand }
  | { readonly type: 'transfer'; readonly requestId: string; readonly targetDeviceId: string }
  | { readonly type: 'transfer-result'; readonly requestId: string; readonly ok: boolean; readonly error?: string };

function isRemoteCommand(value: unknown): value is RemoteCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Record<string, unknown>;
  switch (command.kind) {
    case 'play': case 'pause': case 'next': case 'prev':
      return true;
    case 'seek': return typeof command.sec === 'number' && Number.isFinite(command.sec);
    case 'volume': return typeof command.v === 'number' && Number.isFinite(command.v);
    case 'shuffle': return typeof command.on === 'boolean';
    case 'repeat': return command.mode === 'off' || command.mode === 'all' || command.mode === 'one';
    case 'play_song': return Boolean(command.song && typeof command.song === 'object') && (command.queue === undefined || Array.isArray(command.queue));
    case 'queue_add': return Boolean(command.song && typeof command.song === 'object');
    case 'take_over': return Boolean(command.state && typeof command.state === 'object');
    default: return false;
  }
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
  const traceRef = useRef<DevelopmentTraceBuffer | undefined>(undefined);
  const loadGenerationRef = useRef(0);
  const reportedQueueRef = useRef<{ readonly currentRef: string; readonly queue: readonly SongSnapshot[] } | null>(null);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [view, setView] = useState<ConnectView | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [tabStatus, setTabStatus] = useState<WebConnectState['tabStatus']>(null);
  const [livePosition, setLivePosition] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabStatusRef = useRef<WebConnectState['tabStatus']>(null);
  const pendingTransfersRef = useRef(new Map<string, { resolve: (result: { readonly ok: boolean; readonly error?: string }) => void; timer: number }>());

  const snapshotRef = useRef<() => PlayerSnapshot>(() => audioSnapshot(audioRef.current));
  snapshotRef.current = () => {
    const snapshot = audioSnapshot(audioRef.current);
    const intent = reportedQueueRef.current;
    if (!intent || !snapshot.song) return snapshot;
    if (snapshot.song.ref === intent.currentRef) return { ...snapshot, queue: [...intent.queue] };
    const index = intent.queue.findIndex(item => item.ref === snapshot.song?.ref);
    return index >= 0 ? { ...snapshot, queue: intent.queue.slice(index + 1) } : snapshot;
  };

  const player = useMemo<PlayerPort>(() => ({
    getSnapshot: () => snapshotRef.current(),
    onChange(listener) {
      listenersRef.current.add(listener);
      listener(snapshotRef.current());
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
      const generation = ++loadGenerationRef.current;
      const queueSnapshots = queue.slice(0, 50);
      reportedQueueRef.current = { currentRef: song.ref, queue: queueSnapshots };
      let current: LibrarySong | null;
      try { current = await resolvePlayable(song, traceRef.current); } catch { return 'not_found'; }
      if (generation !== loadGenerationRef.current) return 'not_found';
      if (!current?.streamUrl) return 'not_found';
      const target = audioRef.current;
      target.loadForConnect(current, [current], false);
      const element = target.audioRef.current;
      if (!element || !(await waitForMetadata(element))) return 'not_found';
      if (generation !== loadGenerationRef.current) return 'not_found';
      await target.seek(options.positionSec);
      void resolveQueueInOrder(queueSnapshots, traceRef.current, () => generation === loadGenerationRef.current)
        .then(resolved => {
          if (generation !== loadGenerationRef.current) return;
          const currentRef = snapshotFromSong(audioRef.current.currentSong ?? current);
          if (currentRef?.ref !== song.ref) return;
          audioRef.current.appendQueue(resolved);
        });
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
      loadGenerationRef.current += 1;
      if (reportedQueueRef.current) reportedQueueRef.current = {
        ...reportedQueueRef.current,
        queue: [...reportedQueueRef.current.queue, song].slice(0, 50)
      };
      const playable = await resolvePlayable(song, traceRef.current);
      if (playable) audioRef.current.appendQueue([playable]);
    },
    dispose() {
      loadGenerationRef.current += 1;
      reportedQueueRef.current = null;
    },
  }), []);

  useEffect(() => {
    const next = snapshotRef.current();
    for (const listener of listenersRef.current) listener(next);
  }, [audio.currentSong, audio.queue, audio.isPlaying, audio.currentTime, audio.volume, audio.shuffle, audio.repeat]);

  useEffect(() => {
    if (!convex || !signIn.signedIn || !signIn.available || typeof accountId !== 'string' || !accountId) {
      setSession(null);
      setView(null);
      setDeviceId(null);
      setTabStatus(null);
      tabStatusRef.current = null;
      setLivePosition(0);
      return undefined;
    }
    const localDeviceId = browserDeviceId(accountId);
    setDeviceId(localDeviceId);
    const harness = process.env.NODE_ENV === 'development' && new URLSearchParams(window.location.search).has('connectDevice');
    const canElect = !harness && 'locks' in navigator && typeof navigator.locks?.request === 'function';
    const channel = canElect && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(`allegra-connect:${encodeURIComponent(accountId)}`)
      : null;
    channelRef.current = channel;
    let disposed = false;
    let stopView: (() => void) | undefined;
    let created: ConnectSession | null = null;
    let trace: DevelopmentTraceBuffer | undefined;
    let leaderStarted = false;
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>(resolve => { releaseHold = resolve; });
    const releaseSession = (): void => releaseHold?.();
    const setStatus = (next: WebConnectState['tabStatus']): void => {
      tabStatusRef.current = next;
      setTabStatus(next);
    };
    const updateView = (next: ConnectView): void => {
      setView(next);
      setLivePosition(next.livePosition);
      channel?.postMessage({ type: 'view', deviceId: localDeviceId, view: next } satisfies ConnectTabMessage);
    };
    const startLeader = async (): Promise<void> => {
      if (disposed || leaderStarted) return;
      leaderStarted = true;
      trace = process.env.NODE_ENV === 'development'
        ? createDevelopmentTrace({
            development: true,
            enabled: new URLSearchParams(window.location.search).get('connectTrace') === '1',
            monotonicNow: () => performance.now()
          })
        : undefined;
      traceRef.current = trace;
      if (trace) (window as Window & { allegraConnectTrace?: DevelopmentTraceBuffer }).allegraConnectTrace = trace;
      created = createConnectSession({
        transport: createWebConnectTransport(convex, trace),
        player,
        device: { deviceId: localDeviceId, name: browserDeviceName(), kind: 'web', appVersion: 'web-connect-1', canPlay: true },
        clock: systemClock,
        ...(trace ? { trace } : {})
      });
      sessionRef.current = created;
      setStatus('leader');
      setSession(created);
      stopView = created.subscribe(updateView);
      const updateVisibility = (): void => {
        const visible = document.visibilityState === 'visible';
        setDocumentVisible(visible);
        created?.setVisible(visible);
      };
      updateVisibility();
      document.addEventListener('visibilitychange', updateVisibility);
      await hold;
      document.removeEventListener('visibilitychange', updateVisibility);
      stopView?.();
      created.dispose();
      trace?.dispose();
      if (traceRef.current === trace) traceRef.current = undefined;
      const debugWindow = window as Window & { allegraConnectTrace?: DevelopmentTraceBuffer };
      if (debugWindow.allegraConnectTrace === trace) delete debugWindow.allegraConnectTrace;
      if (sessionRef.current === created) sessionRef.current = null;
      setSession(null);
      setView(null);
      setLivePosition(0);
    };

    const onMessage = (event: MessageEvent<ConnectTabMessage>): void => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'view' && message.deviceId === localDeviceId && !leaderStarted) {
        setView(message.view);
        setLivePosition(message.view.livePosition);
        return;
      }
      if (message.type === 'position' && message.deviceId === localDeviceId && !leaderStarted && Number.isFinite(message.positionSec)) {
        setLivePosition(message.positionSec);
        return;
      }
      if (!leaderStarted || !created) {
        if (message.type === 'transfer-result') {
          const pending = pendingTransfersRef.current.get(message.requestId);
          if (pending) {
            window.clearTimeout(pending.timer);
            pending.resolve({ ok: message.ok, ...(typeof message.error === 'string' ? { error: message.error } : {}) });
            pendingTransfersRef.current.delete(message.requestId);
          }
        }
        return;
      }
      if (message.type === 'control' && isRemoteCommand(message.command)) created.control(message.command);
      else if (message.type === 'transfer' && typeof message.targetDeviceId === 'string') {
        void created.transferTo(message.targetDeviceId).then(result => {
          channel?.postMessage({ type: 'transfer-result', requestId: message.requestId, ok: result.ok, ...(!result.ok && result.error ? { error: result.error } : {}) } satisfies ConnectTabMessage);
        }).catch(() => channel?.postMessage({ type: 'transfer-result', requestId: message.requestId, ok: false } satisfies ConnectTabMessage));
      }
    };
    channel?.addEventListener('message', onMessage);
    if (canElect) {
      setStatus('starting');
      const lockName = `allegra-connect:${encodeURIComponent(accountId)}`;
      void navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) {
          setStatus('other-tab');
          setSession(null);
          return;
        }
        await startLeader();
      }).catch(() => {
        if (!disposed && !leaderStarted) {
          setStatus('leader');
          void startLeader();
        }
      });
    } else {
      setStatus('leader');
      void startLeader();
    }
    return () => {
      disposed = true;
      releaseSession?.();
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
      for (const pending of pendingTransfersRef.current.values()) {
        window.clearTimeout(pending.timer);
        pending.resolve({ ok: false });
      }
      pendingTransfersRef.current.clear();
      if (!leaderStarted) {
        stopView?.();
        created?.dispose();
        trace?.dispose();
        if (sessionRef.current === created) sessionRef.current = null;
      }
      setStatus(null);
      setSession(null);
      setView(null);
      setLivePosition(0);
    };
  }, [accountId, convex, player, signIn.available, signIn.signedIn]);

  useEffect(() => {
    const current = sessionRef.current;
    if (!current || !documentVisible || !view?.isPlaying) return undefined;
    const isRemote = !view.isThisDeviceActive && view.activeDeviceOnline;
    const shouldBroadcastForTab = tabStatus === 'leader' && channelRef.current !== null;
    if (!isRemote && !shouldBroadcastForTab) return undefined;
    const timer = window.setInterval(() => {
      const positionSec = current.livePosition();
      setLivePosition(positionSec);
      if (shouldBroadcastForTab) {
        channelRef.current?.postMessage({ type: 'position', deviceId: deviceId ?? '', positionSec } satisfies ConnectTabMessage);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deviceId, documentVisible, session, tabStatus, view?.activeDeviceOnline, view?.isPlaying, view?.isThisDeviceActive]);

  const control = useCallback((command: RemoteCommand): void => {
    const current = sessionRef.current;
    if (current) current.control(command);
    else if (tabStatusRef.current === 'other-tab') channelRef.current?.postMessage({ type: 'control', command } satisfies ConnectTabMessage);
  }, []);

  const transferTo = useCallback(async (targetDeviceId: string): Promise<{ readonly ok: boolean; readonly error?: string }> => {
    const current = sessionRef.current;
    if (current) {
      const result = await current.transferTo(targetDeviceId);
      return result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) };
    }
    if (tabStatusRef.current !== 'other-tab' || !channelRef.current) return { ok: false };
    const requestId = crypto.randomUUID();
    return new Promise(resolve => {
      const timer = window.setTimeout(() => {
        pendingTransfersRef.current.delete(requestId);
        resolve({ ok: false });
      }, 65_000);
      pendingTransfersRef.current.set(requestId, { resolve, timer });
      channelRef.current?.postMessage({ type: 'transfer', requestId, targetDeviceId } satisfies ConnectTabMessage);
    });
  }, []);

  const playRemote = useCallback((song: UnifiedSong, queue: readonly UnifiedSong[]): boolean => {
    const current = sessionRef.current;
    const currentView = current?.view() ?? view;
    const snapshot = snapshotFromSong(song);
    if (!snapshot) return false;
    const queueSnapshots = queue
      .filter((item) => item.id !== song.id)
      .map(snapshotFromSong)
      .filter((item): item is SongSnapshot => item !== null)
      .slice(0, 50);
    if (current) {
      if (!currentView?.activeDeviceId || currentView.isThisDeviceActive || !currentView.activeDeviceOnline) return false;
      current.control({ kind: 'play_song', song: snapshot, queue: queueSnapshots });
      return true;
    }
    if (tabStatusRef.current !== 'other-tab' || !channelRef.current) return false;
    control({ kind: 'play_song', song: snapshot, queue: queueSnapshots });
    return true;
  }, [control, view]);

  return { session, view, deviceId, connected: Boolean(convex && signIn.signedIn), tabStatus, livePosition, control, transferTo, playRemote };
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
