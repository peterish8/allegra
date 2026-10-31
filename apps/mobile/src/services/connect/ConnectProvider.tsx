import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import {
  createConnectSession,
  createDevelopmentTrace,
  decidePlaybackRoute,
  isControllingAnotherDevice,
  ownerOfflineMessage,
  type DevelopmentTraceBuffer,
  type ConnectSession,
  type ConnectView,
  type RemoteCommand,
  type TransferResult,
} from '../../../../../packages/connect/src/index';
import { shareableArtwork } from '@shared/artwork';
import { listenVerdict } from '@shared/listenSignal';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import { setPlaylistSelectionRouter, usePlayerStore } from '../../store/playerStore';
import { usePositionStore } from '../../store/positionStore';
import { useLuvLinkStore } from '../../store/luvLinkStore';
import { positionSV } from '../../playback/positionBus';
import { useAccount, allegraConvex } from '../account/AccountProvider';
import { runWhenIdle } from '../bootPhases';
import { recordPlay, recordPlayStarted, refFor } from '../sync/LibrarySync';
import { backfillCatalogLinks, setCatalogBackfillToken } from '../sync/catalogBackfill';
import { createListenTracker, type HeardSong } from '../sync/listenTracker';
import { setStreamQueueRouter, StreamService } from '../stream/StreamService';
import { routeOwnedLuvLinkCatalogPick } from '../luvLink/client';
import { toStreamSong } from '../stream/streamSong';
import { onBeforeSignOut } from '../account/signOutHooks';
import { createMobilePlayerPort, knownRefOf, snapshotOfSong, snapshotWithRef } from './mobilePlayerPort';
import { createMobileConnectTransport } from './convexTransport';
import { setConnectPosition } from './remotePositionStore';
import { createPickRouter, type PendingPick, type Pick } from './pickRouter';
import { bindPlaybackIntents } from './playbackIntents';
import { setSnapshotCoverToken } from './useSnapshotCover';

/** A song only this phone has, picked while another device plays: the listener decides where it plays. */
export interface ConnectChoice {
  readonly pick: Pick;
  readonly title: string;
  readonly deviceName: string;
}

/** A short message about where playback went. `at` is new for every message. */
export interface ConnectToast {
  readonly message: string;
  readonly at: number;
}

/** The older-download catalog lookup runs once per app run, after Connect first reaches the server. */
let catalogBackfillStarted = false;

const leftOutMessage = (count: number): string =>
  count === 1
    ? '1 song that is only on this phone was left out.'
    : `${count} songs that are only on this phone were left out.`;

interface ConnectContextValue {
  readonly signedIn: boolean;
  readonly deviceId: string | null;
  readonly view: ConnectView | null;
  readonly remotePlayback: boolean;
  readonly devicesVisible: boolean;
  readonly openDevices: () => void;
  readonly closeDevices: () => void;
  readonly control: (command: RemoteCommand) => void;
  readonly transferTo: (deviceId: string) => Promise<TransferResult>;
  /** Name this phone for the other devices' lists. Kept on this phone. */
  readonly rename: (name: string) => void;
  /** A song picked here is being looked up for the device that plays. */
  readonly pendingPick: PendingPick | null;
  /** A song only this phone has waits for the listener to say where it plays. */
  readonly choice: ConnectChoice | null;
  /** `playHere`: play it on this phone (the other device stops); otherwise drop the pick. */
  readonly resolveChoice: (playHere: boolean) => void;
  readonly toast: ConnectToast | null;
  readonly dismissToast: () => void;
}

const EMPTY_VIEW: ConnectContextValue = {
  signedIn: false,
  deviceId: null,
  view: null,
  remotePlayback: false,
  devicesVisible: false,
  openDevices: () => undefined,
  closeDevices: () => undefined,
  control: () => undefined,
  transferTo: async () => ({ ok: false, reason: 'offline' }),
  rename: () => undefined,
  pendingPick: null,
  choice: null,
  resolveChoice: () => undefined,
  toast: null,
  dismissToast: () => undefined,
};

const ConnectContext = createContext<ConnectContextValue>(EMPTY_VIEW);
const deviceKey = (userId: string) => `allegra-connect-device:${userId}`;
const DEVICE_NAME_KEY = 'allegra-connect-device-name';
const deviceIdRequests = new Map<string, Promise<string>>();

async function deviceIdFor(userId: string): Promise<string> {
  const key = deviceKey(userId);
  const pending = deviceIdRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    const stored = await AsyncStorage.getItem(key);
    if (stored) return stored;
    const created = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(key, created);
    return created;
  })();
  deviceIdRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (deviceIdRequests.get(key) === request) deviceIdRequests.delete(key);
  }
}

function mobileDeviceName(): string {
  const model = Platform.OS === 'android' ? Platform.constants.Model?.trim() : '';
  return model || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
}

export const ConnectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const account = useAccount();
  const roomActive = useLuvLinkStore(state => state.room !== null || state.ownedRoomId !== null);
  const tokenRef = useRef<string | null>(account.token);
  tokenRef.current = account.token;
  // A cover another device could not send is looked up in the account catalog with this token.
  useEffect(() => setSnapshotCoverToken(() => tokenRef.current), []);
  const signedInRef = useRef(account.signedIn);
  signedInRef.current = account.signedIn;
  const sessionRef = useRef<ConnectSession | null>(null);
  const traceRef = useRef<DevelopmentTraceBuffer | undefined>(undefined);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [view, setView] = useState<ConnectView | null>(null);
  const [devicesVisible, setDevicesVisible] = useState(false);
  const [appForeground, setAppForeground] = useState(AppState.currentState === 'active');
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);
  const [choice, setChoice] = useState<ConnectChoice | null>(null);
  const [toast, setToast] = useState<ConnectToast | null>(null);
  /** The session's last notice already shown, so each one is shown once. */
  const noticeSeenRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let stopView: (() => void) | undefined;
    let current: ConnectSession | undefined;
    let stopSelectionRouter: (() => void) | undefined;
    let stopIntents: (() => void) | undefined;
    let disposeRouter: (() => void) | undefined;
    let stopQueueRouter: (() => void) | undefined;
    let stopSignOutHook: (() => void) | undefined;
    let trace: DevelopmentTraceBuffer | undefined;
    const userId = account.profile?.userId;
    if (!account.signedIn || !userId) {
      setSession(null);
      setDeviceId(null);
      setView(null);
      sessionRef.current?.dispose();
      sessionRef.current = null;
      return undefined;
    }

    Promise.all([deviceIdFor(userId), AsyncStorage.getItem(DEVICE_NAME_KEY).catch(() => null)]).then(([id, chosenName]) => {
      if (disposed) return;
      const kind = Platform.OS === 'ios' ? 'ios' : 'android';
      trace = __DEV__ ? createDevelopmentTrace({
        development: true,
        enabled: process.env.EXPO_PUBLIC_CONNECT_TRACE === '1',
        monotonicNow: () => performance.now(),
      }) : undefined;
      traceRef.current = trace;
      if (trace) (globalThis as typeof globalThis & { allegraConnectTrace?: DevelopmentTraceBuffer }).allegraConnectTrace = trace;
      current = createConnectSession({
        transport: createMobileConnectTransport(allegraConvex, trace),
        player: createMobilePlayerPort(() => tokenRef.current, trace),
        device: {
          deviceId: id,
          name: chosenName?.trim().slice(0, 80) || mobileDeviceName(),
          kind,
          appVersion: Constants.expoConfig?.version ?? '1.0.0',
          // A room owns playback while joined. The phone stays visible, but
          // another device cannot take control and interrupt the room.
          canPlay: !roomActive,
        },
        clock: {
          now: () => Date.now(),
          monotonicNow: () => performance.now(),
          setTimeout: (callback, delay) => setTimeout(callback, delay),
          clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
          setInterval: (callback, delay) => setInterval(callback, delay),
          clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        },
        ...(trace ? { trace } : {}),
      });
      sessionRef.current = current;
      const live = current;
      const heldLocally = (): boolean => roomActive;
      // A song picked here plays where the music is: on the device that plays when another one
      // does (looked up first when this phone cannot name it yet), asking before it moves here.
      const router = createPickRouter({
        connect: () => (disposed ? null : { session: live, deviceId: id }),
        heldLocally,
        knownRef: knownRefOf,
        findRef: song => refFor(song),
        snapshotFor: snapshotWithRef,
        playHere: pick => usePlayerStore.getState().setPlaylistQueue(pick.playlistId, [...pick.songs], pick.startIndex, true, { here: true }),
        onPending: next => { if (!disposed) setPendingPick(next); },
        onOwnerOffline: name => { if (!disposed) setToast({ message: ownerOfflineMessage(name), at: Date.now() }); },
        onOnlyHere: (pick, name) => {
          if (disposed) return;
          const song = pick.songs[pick.startIndex];
          if (song) setChoice({ pick, title: song.title, deviceName: name });
        },
        onLeftOut: count => { if (!disposed) setToast({ message: leftOutMessage(count), at: Date.now() }); },
        timers: {
          setTimeout: (callback, delay) => setTimeout(callback, delay),
          clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      });
      disposeRouter = () => router.dispose();
      stopSelectionRouter = setPlaylistSelectionRouter(pick => {
        return router.route(pick);
      });
      stopIntents = bindPlaybackIntents({ session: live, deviceId: id, heldLocally, routePick: pick => router.route(pick) });
      // Play next, and the rest of an album arriving behind its first song, go where the music is.
      stopQueueRouter = setStreamQueueRouter((songs, next) => {
        if (useLuvLinkStore.getState().ownedRoomId) {
          const selected = songs[0];
          if (selected) void routeOwnedLuvLinkCatalogPick(selected, next).catch(error => useLuvLinkStore.getState().announce(error instanceof Error ? error.message : 'Could not add this pick to LuvLink.'));
          return true;
        }
        const route = decidePlaybackRoute({ view: live.view(), deviceId: id, heldLocally: heldLocally(), staleOk: true });
        if (route.kind !== 'remote') return false;
        const [song, ...more] = songs.flatMap(item => snapshotOfSong(toStreamSong(item)) ?? []).slice(0, 50);
        if (song) live.control({ kind: 'queue_add', song, ...(more.length ? { more } : {}), ...(next ? { next: true } : {}) });
        return true;
      });
      // Signing out ends the session that could say this phone is leaving: the goodbye goes first.
      stopSignOutHook = onBeforeSignOut(() => current?.leave() ?? Promise.resolve());
      setDeviceId(id);
      setSession(current);
      stopView = current.subscribe(nextView => {
        setView(nextView);
        setConnectPosition(nextView.livePosition);
        // A remote "play" that started here because the playing device went offline says so once.
        const notice = nextView.notice;
        if (notice && notice.at !== noticeSeenRef.current) {
          noticeSeenRef.current = notice.at;
          setToast({ message: ownerOfflineMessage(notice.deviceName), at: notice.at });
        }
        // Once Connect has heard from the server (so the phone is online), older downloads learn
        // their catalog song and its cover, a few at a time: a pick of one then goes to the other
        // device at once and shows its cover there (sync/catalogBackfill). Once per app run.
        if (nextView.ready && !catalogBackfillStarted) {
          catalogBackfillStarted = true;
          setCatalogBackfillToken(() => tokenRef.current);
          runWhenIdle('connect catalog links', () => backfillCatalogLinks(), 8_000);
        }
      });
      current.setVisible(AppState.currentState === 'active');
    }).catch(() => {
      if (!disposed) {
        setSession(null);
        setView(null);
      }
    });

    return () => {
      disposed = true;
      stopSelectionRouter?.();
      stopIntents?.();
      disposeRouter?.();
      setPendingPick(null);
      setChoice(null);
      stopQueueRouter?.();
      stopSignOutHook?.();
      stopView?.();
      current?.dispose();
      trace?.dispose();
      if (traceRef.current === trace) traceRef.current = undefined;
      const debugGlobal = globalThis as typeof globalThis & { allegraConnectTrace?: DevelopmentTraceBuffer };
      if (debugGlobal.allegraConnectTrace === trace) delete debugGlobal.allegraConnectTrace;
      if (sessionRef.current === current) sessionRef.current = null;
    };
  }, [account.profile?.userId, account.signedIn, roomActive]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppForeground(state === 'active');
      sessionRef.current?.setVisible(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  // A remote player's position is anchored on the server. Refresh the view
  // once a second while it plays so the scrubber and lyrics stay in step.
  useEffect(() => {
    if (!session || !appForeground || !view?.isPlaying || view.isThisDeviceActive || !view.activeDeviceOnline) return undefined;
    const timer = setInterval(() => {
      try {
        traceRef.current?.record({ event: 'renderer.tick', operation: 'renderer_timer', count: 1 });
      } catch { /* Diagnostics cannot interrupt the remote view. */ }
      const positionSec = session.livePosition();
      setConnectPosition(positionSec);
      positionSV.value = positionSec;
    }, 1000);
    return () => clearInterval(timer);
  }, [appForeground, session, view?.isPlaying, view?.isThisDeviceActive, view?.activeDeviceOnline]);

  // Count heard audio, not wall time: the tracker only accepts plausible
  // forward position ticks, publishes history at five seconds, then teaches taste on finish.
  useEffect(() => {
    const startWrites = new Map<string, Promise<{ ref: SongRef; snapshot: SongSnapshot } | null>>();
    const snapshotFor = (song: HeardSong, ref: SongRef): SongSnapshot => ({
      ref,
      title: song.title,
      artist: song.artist ?? '',
      ...(song.album ? { album: song.album } : {}),
      // A download's cover file stays here; the catalog's cover goes into the account's history.
      artwork: shareableArtwork(song.artwork, song.coverRemoteUri),
      duration: Math.max(0, song.duration ?? 0),
    });
    const tracker = createListenTracker((song, seconds, startedAt, ending) => {
      if (!signedInRef.current) return;
      const started = startWrites.get(song.id);
      const resolve = started ?? refFor(song).then(ref => ref ? { ref, snapshot: snapshotFor(song, ref) } : null);
      resolve.then(value => {
        if (value) recordPlay(value.ref, seconds, value.snapshot, startedAt, ending);
      }).catch(() => undefined).finally(() => {
        if (started && startWrites.get(song.id) === started) startWrites.delete(song.id);
      });
    }, (song, startedAt) => {
      if (!signedInRef.current) return;
      const write = refFor(song).then(async ref => {
        if (!ref) return null;
        const snapshot = snapshotFor(song, ref);
        await recordPlayStarted(ref, snapshot, startedAt);
        return { ref, snapshot };
      }).catch(() => null);
      startWrites.set(song.id, write);
    }, (song, ending) => {
      // A playing search radio reacts at once, signed in or not.
      StreamService.radioOutcome(song.id, listenVerdict({ ...ending, durationSec: song.duration }));
    });
    const observe = (): void => {
      const player = usePlayerStore.getState();
      const position = positionSV.value;
      tracker.observe({
        song: player.currentSong ? {
          id: player.currentSong.id,
          title: player.currentSong.title,
          artist: player.currentSong.artist,
          album: player.currentSong.album,
          artwork: player.currentSong.coverImageUri,
          coverRemoteUri: player.currentSong.coverRemoteUri,
          duration: player.currentSong.duration,
          originId: player.currentSong.originId,
        } : null,
        positionSec: Number.isFinite(position) ? position : usePositionStore.getState().position,
        isPlaying: player.isPlaying,
        at: Date.now(),
      });
    };
    const stopPlayer = usePlayerStore.subscribe(observe);
    const stopPosition = usePositionStore.subscribe(observe);
    observe();
    return () => {
      stopPlayer();
      stopPosition();
      tracker.finish();
    };
  }, []);

  const openDevices = useCallback(() => setDevicesVisible(true), []);
  const closeDevices = useCallback(() => setDevicesVisible(false), []);
  const control = useCallback((command: RemoteCommand) => sessionRef.current?.control(command), []);
  const transferTo = useCallback((target: string) => sessionRef.current?.transferTo(target) ?? Promise.resolve({ ok: false as const, reason: 'offline' as const }), []);
  const rename = useCallback((name: string) => {
    const next = name.trim().slice(0, 80);
    if (!next) return;
    AsyncStorage.setItem(DEVICE_NAME_KEY, next).catch(() => undefined);
    sessionRef.current?.rename(next);
  }, []);
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const resolveChoice = useCallback((playHere: boolean) => {
    const current = choiceRef.current;
    setChoice(null);
    // "Play on this phone" is the listener choosing this device: the song plays here and the
    // device that was playing stops, as a pick in the device list would make it.
    if (current && playHere) {
      const { pick } = current;
      usePlayerStore.getState().setPlaylistQueue(pick.playlistId, [...pick.songs], pick.startIndex, true, { here: true });
    }
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  // The remote player shows once there is something to show of what the other device plays.
  const remotePlayback = isControllingAnotherDevice(view, deviceId) && Boolean(view?.song);

  const value = useMemo<ConnectContextValue>(() => ({
    signedIn: account.signedIn,
    deviceId,
    view,
    remotePlayback,
    devicesVisible,
    openDevices,
    closeDevices,
    control,
    transferTo,
    rename,
    pendingPick,
    choice,
    resolveChoice,
    toast,
    dismissToast,
  }), [account.signedIn, deviceId, view, remotePlayback, devicesVisible, openDevices, closeDevices, control, transferTo, rename, pendingPick, choice, resolveChoice, toast, dismissToast]);

  return <ConnectContext.Provider value={value}>{children}</ConnectContext.Provider>;
};

export const useConnect = (): ConnectContextValue => useContext(ConnectContext);
