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
  createQueueStager,
  decidePlaybackRoute,
  ownerOfflineMessage,
  reportable,
  traceCatalogLookup,
  systemClock,
  upcomingOf,
  whenRouteReady,
  QUEUE_LIMIT,
  type ConnectSession,
  type ConnectTransport,
  type ConnectView,
  type DevelopmentTraceBuffer,
  type ConvexWireClient,
  type PlayerPort,
  type PlayerSnapshot,
  type QueueStager,
  type RemoteCommand
} from '../../../../packages/connect/src/index';
import { useConvexAppClient } from '../../app/ConvexSignInProvider';
import { useSignIn } from '../auth/SignInContext';
import type { AudioPlayerState } from './useAudioPlayer';
import { exactSaavnMatch, type LibrarySong } from '../lib/libraryRows';
import { snapshotFromSong, withFoundCover } from '../lib/connectSnapshot';
import { fetchSongsByIds, resolveApiUrl, searchSongs } from '../lib/api';
import { accountIdFromToken, deviceIdForAccount } from '../lib/connectDeviceId';
import { browserNameFrom } from '../lib/browserName';
import { onBeforeSignOut } from '../lib/signOutHooks';

function createWebConnectTransport(client: ConvexReactClient, trace?: DevelopmentTraceBuffer): ConnectTransport {
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
    // The sender may have had no cover to share: the catalog's goes with the song from here on.
    if (exact) return { ...exact, libraryRef: snapshot.ref, librarySnapshot: withFoundCover(snapshot, exact.artwork) };
  }
  const { results } = await traceCatalogLookup(trace, () => searchSongs(`${snapshot.title} ${snapshot.artist}`));
  const match = exactSaavnMatch(snapshot, results);
  return match ? { ...match, libraryRef: snapshot.ref, librarySnapshot: withFoundCover(snapshot, match.artwork) } : null;
}

/** How long a tab waits for the Connect lock before showing that another tab is playing. */
const OTHER_TAB_GRACE_MS = 400;

function browserDeviceId(accountId: string): string {
  const params = new URLSearchParams(window.location.search);
  const harnessId = process.env.NODE_ENV === 'development' ? params.get('connectDevice') : null;
  const storage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value)
  };
  return deviceIdForAccount(accountId, storage, () => crypto.randomUUID(), harnessId);
}

const DEVICE_NAME_KEY = 'allegra-connect-device-name';

/** The name the listener gave this browser, or one made from the browser and system. */
function browserDeviceName(): string {
  try {
    const chosen = window.localStorage.getItem(DEVICE_NAME_KEY)?.trim().slice(0, 80);
    if (chosen) return chosen;
  } catch { /* storage unavailable: the made-up name will do */ }
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'Device';
  return `${browserNameFrom(ua)} on ${os}`;
}

/** Half a second of silence as a WAV: something for the first tap to play (see the unlock effect). */
function silentClipUrl(): string {
  const samples = 4_000;
  const bytes = new Uint8Array(44 + samples).fill(128, 44);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true); view.setUint32(28, 8_000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, samples, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

const notFound = (): Error => Object.assign(new Error('That song could not be loaded.'), { data: { code: 'not_found' } });

function audioSnapshot(audio: AudioPlayerState): PlayerSnapshot {
  const song = audio.currentSong ? snapshotFromSong(audio.currentSong) ?? undefined : undefined;
  const queue = reportable(upcomingOf(audio), snapshotFromSong);
  return {
    ...(song ? { song } : {}),
    queue,
    isPlaying: audio.isPlaying,
    positionSec: audio.audioRef.current?.currentTime ?? audio.playhead.get(),
    volume: audio.volume,
    shuffle: audio.shuffle,
    repeat: audio.repeat
  };
}

/**
 * The player points the element at a new song in an effect, after React renders, so right after
 * `loadForConnect` the element can still hold the previous song: its metadata would pass for the
 * new one and a seek would land on the old track. Resolves once `src` is the new stream (the
 * effect's `load()` fires `loadstart`); an event, not a poll, since hidden tabs throttle timers.
 */
function waitForSource(audio: HTMLAudioElement, src: string): Promise<boolean> {
  if (audio.getAttribute('src') === src) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ready: boolean): void => {
      window.clearTimeout(timeout);
      audio.removeEventListener('loadstart', onStart);
      resolve(ready);
    };
    const onStart = (): void => { if (audio.getAttribute('src') === src) done(true); };
    const timeout = window.setTimeout(() => done(audio.getAttribute('src') === src), 5_000);
    audio.addEventListener('loadstart', onStart);
  });
}

function waitForMetadata(audio: HTMLAudioElement): Promise<boolean> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true);
  // A failed or emptied element sends no further events: start the load again.
  if (audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) audio.load();
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
  /**
   * Sends a picked song to the device that plays, when another one does. Resolves true when it
   * went there; false means play it in this browser. Waits briefly for a fresh Connect state first,
   * so a click just after the page opened does not take playback from the device really playing.
   */
  readonly playRemote: (song: UnifiedSong, queue: readonly UnifiedSong[]) => Promise<boolean>;
  /** Something the listener should be told about where playback went; null when there is none. */
  readonly notice: { readonly message: string; readonly at: number } | null;
  readonly dismissNotice: () => void;
  /** Counts the songs other devices have loaded into this browser (a transfer, or a pick sent here). */
  readonly connectLoads: number;
  /**
   * Queue a song on the device that plays. `local`: this browser plays, so the caller queues it
   * here. `unsupported`: another device plays and the song has no form it could find.
   */
  readonly queueRemote: (song: UnifiedSong, next: boolean) => 'sent' | 'local' | 'unsupported';
  /** Name this browser for the other devices' lists. Kept in this browser. */
  readonly rename: (name: string) => void;
}

type ConnectTabMessage =
  | { readonly type: 'view'; readonly deviceId: string; readonly view: ConnectView }
  | { readonly type: 'position'; readonly deviceId: string; readonly positionSec: number }
  | { readonly type: 'control'; readonly command: RemoteCommand }
  | { readonly type: 'rename'; readonly name: string }
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
    case 'queue_remove': return Number.isInteger(command.index) && typeof command.ref === 'string';
    case 'queue_move': return Number.isInteger(command.from) && Number.isInteger(command.to) && typeof command.ref === 'string';
    case 'queue_clear': return true;
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
  // One stager for the life of the hook: it only reads refs, so it never goes stale.
  const stagerRef = useRef<QueueStager<UnifiedSong> | null>(null);
  stagerRef.current ??= createQueueStager<UnifiedSong>({
    player: () => audioRef.current,
    snapshotOf: snapshotFromSong,
    lookup: (missing, isCurrent) => resolveQueueInOrder(missing, traceRef.current, isCurrent),
    onChange: () => {
      const next = snapshotRef.current();
      for (const listener of listenersRef.current) listener(next);
    }
  });
  const stager = stagerRef.current;
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [view, setView] = useState<ConnectView | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [tabStatus, setTabStatus] = useState<WebConnectState['tabStatus']>(null);
  const [livePosition, setLivePosition] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(false);
  const [notice, setNotice] = useState<WebConnectState['notice']>(null);
  const [connectLoads, setConnectLoads] = useState(0);
  const noticeSeenRef = useRef<number | undefined>(undefined);
  const deviceIdRef = useRef<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabStatusRef = useRef<WebConnectState['tabStatus']>(null);
  const pendingTransfersRef = useRef(new Map<string, { resolve: (result: { readonly ok: boolean; readonly error?: string }) => void; timer: number }>());

  const snapshotRef = useRef<() => PlayerSnapshot>(() => audioSnapshot(audioRef.current));
  snapshotRef.current = () => {
    const snapshot = audioSnapshot(audioRef.current);
    return snapshot.song ? { ...snapshot, queue: stager.report(snapshot.song, snapshot.queue) } : snapshot;
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
      const queueSnapshots = queue.slice(0, QUEUE_LIMIT);
      stager.expect(song.ref, queueSnapshots);
      let current: LibrarySong | null;
      try { current = await resolvePlayable(song, traceRef.current); } catch { current = null; }
      if (generation !== loadGenerationRef.current) return 'not_found';
      if (!current?.streamUrl) {
        // The song that was playing stays: the queue asked for with the new one does not apply to it.
        stager.reset();
        return 'not_found';
      }
      const target = audioRef.current;
      const sameSong = target.currentSong?.id === current.id;
      target.loadForConnect(current, [current], false);
      const element = target.audioRef.current;
      if (!element) return 'not_found';
      if (!sameSong && !(await waitForSource(element, resolveApiUrl(current.streamUrl)))) return 'not_found';
      if (generation !== loadGenerationRef.current) return 'not_found';
      if (!(await waitForMetadata(element))) return 'not_found';
      if (generation !== loadGenerationRef.current) return 'not_found';
      await target.seek(options.positionSec);
      void stager.stage(queueSnapshots);
      setConnectLoads((count) => count + 1);
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
      if (!snapshotRef.current().song) throw notFound();
      const lost = await stager.stage([...snapshotRef.current().queue, song]);
      if (lost.includes(song.ref)) throw notFound();
    },
    async setQueue(queue) { void stager.stage(queue); },
    dispose() {
      loadGenerationRef.current += 1;
      stager.reset();
    },
  }), [stager]);

  useEffect(() => {
    const publish = (): void => {
      const next = snapshotRef.current();
      for (const listener of listenersRef.current) listener(next);
    };
    publish();
    return audio.playhead.subscribe(publish);
  }, [audio.currentSong, audio.queue, audio.isPlaying, audio.playhead, audio.volume, audio.shuffle, audio.repeat]);

  useEffect(() => {
    if (!convex || !signIn.signedIn || !signIn.available || typeof accountId !== 'string' || !accountId) {
      setSession(null);
      setView(null);
      deviceIdRef.current = null;
      setDeviceId(null);
      setTabStatus(null);
      tabStatusRef.current = null;
      setLivePosition(0);
      return undefined;
    }
    const localDeviceId = browserDeviceId(accountId);
    deviceIdRef.current = localDeviceId;
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
    const lockAbort = new AbortController();
    const hold = new Promise<void>(resolve => { releaseHold = resolve; });
    const releaseSession = (): void => releaseHold?.();
    const setStatus = (next: WebConnectState['tabStatus']): void => {
      tabStatusRef.current = next;
      setTabStatus(next);
    };
    const updateView = (next: ConnectView): void => {
      setView(next);
      setLivePosition(next.livePosition);
      // A "play" that started here because the playing device went offline says so once.
      if (next.notice && next.notice.at !== noticeSeenRef.current) {
        noticeSeenRef.current = next.notice.at;
        setNotice({ message: ownerOfflineMessage(next.notice.deviceName), at: next.notice.at });
      }
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
      const transport = createWebConnectTransport(convex, trace);
      created = createConnectSession({
        transport,
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
      // A closing tab says so, or the other devices would offer it for another two and a half
      // minutes. `persisted` is a page kept for Back: it may return, so it stays connected.
      const onPageHide = (event: PageTransitionEvent): void => { if (!event.persisted) created?.dispose(); };
      window.addEventListener('pagehide', onPageHide);
      // Signing out ends the session that could say it: the goodbye goes first.
      const stopSignOutHook = onBeforeSignOut(() => created?.leave() ?? Promise.resolve());
      await hold;
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('pagehide', onPageHide);
      stopSignOutHook();
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
      else if (message.type === 'rename' && typeof message.name === 'string') created.rename(message.name);
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
      // Wait in line for the lock rather than asking `ifAvailable`. A re-run of this effect (a token
      // refresh, Strict Mode) requests it before the previous run has let go; with `ifAvailable`
      // the tab then took itself for a second tab and left Connect for good while its audio
      // kept playing, so nothing could control it or take playback from it. Queued, it leads as
      // soon as the lock frees, and a waiting tab takes over when the leading tab closes.
      const otherTabTimer = window.setTimeout(() => {
        if (!disposed && !leaderStarted) {
          setStatus('other-tab');
          setSession(null);
        }
      }, OTHER_TAB_GRACE_MS);
      void navigator.locks.request(lockName, { mode: 'exclusive', signal: lockAbort.signal }, async () => {
        window.clearTimeout(otherTabTimer);
        await startLeader();
      }).catch(() => {
        window.clearTimeout(otherTabTimer);
        // Aborted by cleanup, or locks unusable here: lead alone rather than not at all.
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
      lockAbort.abort();
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

  const playRemote = useCallback(async (song: UnifiedSong, queue: readonly UnifiedSong[]): Promise<boolean> => {
    const snapshot = snapshotFromSong(song);
    if (!snapshot) return false;
    // What follows the song in its list: the same songs this browser would play after it.
    const at = queue.findIndex((item) => item.id === song.id);
    const queueSnapshots = reportable(at >= 0 ? queue.slice(at + 1) : queue.filter((item) => item.id !== song.id), snapshotFromSong);
    const current = sessionRef.current;
    if (current) {
      const decide = (staleOk: boolean) => decidePlaybackRoute({ view: current.view(), deviceId: deviceIdRef.current, staleOk });
      let route = decide(false);
      // Just opened: the device list and state have not arrived, so nobody knows yet who plays.
      if (route.kind === 'wait') {
        await whenRouteReady(current, systemClock);
        route = decide(true);
      }
      if (route.kind === 'local_owner_offline') setNotice({ message: ownerOfflineMessage(route.deviceName), at: Date.now() });
      if (route.kind !== 'remote' || sessionRef.current !== current) return false;
      current.control({ kind: 'play_song', song: snapshot, queue: queueSnapshots });
      return true;
    }
    if (tabStatusRef.current !== 'other-tab' || !channelRef.current) return false;
    control({ kind: 'play_song', song: snapshot, queue: queueSnapshots });
    return true;
  }, [control]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const queueRemote = useCallback((song: UnifiedSong, next: boolean): 'sent' | 'local' | 'unsupported' => {
    const current = sessionRef.current;
    const currentView = current?.view() ?? view;
    const remote = current
      ? Boolean(currentView?.activeDeviceId && !currentView.isThisDeviceActive && currentView.activeDeviceOnline)
      : tabStatusRef.current === 'other-tab' && channelRef.current !== null;
    if (!remote) return 'local';
    const snapshot = snapshotFromSong(song);
    if (!snapshot) return 'unsupported';
    control({ kind: 'queue_add', song: snapshot, ...(next ? { next: true } : {}) });
    return 'sent';
  }, [control, view]);

  const rename = useCallback((name: string): void => {
    const next = name.trim().slice(0, 80);
    if (!next) return;
    try { window.localStorage.setItem(DEVICE_NAME_KEY, next); } catch { /* the name still applies until this tab closes */ }
    const current = sessionRef.current;
    if (current) current.rename(next);
    else if (tabStatusRef.current === 'other-tab') channelRef.current?.postMessage({ type: 'rename', name: next } satisfies ConnectTabMessage);
  }, []);

  // Safari lets an element start without a tap only once a tap has played it, and a transfer or
  // a remote "play" arrives with no tap. So the first tap in a tab with nothing loaded plays a
  // moment of silence. With a song loaded the element is left alone: its own play button
  // unlocks it, and a play here would read as this browser starting playback.
  useEffect(() => {
    if (!session) return undefined;
    let clip: string | null = null;
    const stop = (): void => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      if (clip) URL.revokeObjectURL(clip);
      clip = null;
    };
    function unlock(): void {
      const element = audioRef.current.audioRef.current;
      if (!element) return;
      if (element.played.length > 0) { stop(); return; }
      if (audioRef.current.currentSong || element.getAttribute('src')) return;
      clip ??= silentClipUrl();
      const url = clip;
      element.src = url;
      element.play().then(() => true, () => false).then((played) => {
        // A real song took the element meanwhile: it is not ours to touch.
        if (element.getAttribute('src') !== url) { if (played) stop(); return; }
        element.pause();
        element.removeAttribute('src');
        element.load();
        if (played) stop();
      }).catch(() => undefined);
    }
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return stop;
  }, [session]);

  return {
    session, view, deviceId, connected: Boolean(convex && signIn.signedIn), tabStatus, livePosition,
    control, transferTo, playRemote, queueRemote, rename, notice, dismissNotice, connectLoads
  };
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
