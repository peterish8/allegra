import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { createConnectSession, createDevelopmentTrace, type DevelopmentTraceBuffer, type ConnectSession, type ConnectView, type RemoteCommand, type TransferResult } from '../../../../../packages/connect/src/index';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import { setPlaylistSelectionRouter, usePlayerStore } from '../../store/playerStore';
import { usePositionStore } from '../../store/positionStore';
import { useListenTogetherStore } from '../../store/listenTogetherStore';
import { positionSV } from '../../playback/positionBus';
import { useAccount, allegraConvex } from '../account/AccountProvider';
import { recordPlay, recordPlayStarted, refFor } from '../sync/LibrarySync';
import { createListenTracker, type HeardSong } from '../sync/listenTracker';
import { createMobilePlayerPort, snapshotOfSong } from './mobilePlayerPort';
import { createMobileConnectTransport } from './convexTransport';
import { setConnectPosition } from './remotePositionStore';

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
};

const ConnectContext = createContext<ConnectContextValue>(EMPTY_VIEW);
const deviceKey = (userId: string) => `allegra-connect-device:${userId}`;
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
  const roomActive = useListenTogetherStore(state => state.room !== null);
  const tokenRef = useRef<string | null>(account.token);
  tokenRef.current = account.token;
  const signedInRef = useRef(account.signedIn);
  signedInRef.current = account.signedIn;
  const sessionRef = useRef<ConnectSession | null>(null);
  const traceRef = useRef<DevelopmentTraceBuffer | undefined>(undefined);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [view, setView] = useState<ConnectView | null>(null);
  const [devicesVisible, setDevicesVisible] = useState(false);
  const [appForeground, setAppForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    let disposed = false;
    let stopView: (() => void) | undefined;
    let current: ConnectSession | undefined;
    let stopSelectionRouter: (() => void) | undefined;
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

    deviceIdFor(userId).then(id => {
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
          name: mobileDeviceName(),
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
      stopSelectionRouter = setPlaylistSelectionRouter(({ songs, startIndex }) => {
        if (roomActive) return false;
        const active = current?.view();
        const selected = songs[startIndex];
        const song = snapshotOfSong(selected);
        if (!current || !active?.activeDeviceId || active.isThisDeviceActive || !active.activeDeviceOnline || !song) return false;
        const queue = songs.slice(startIndex + 1).flatMap(item => {
          const snapshot = snapshotOfSong(item);
          return snapshot ? [snapshot] : [];
        }).slice(0, 50);
        current.control({ kind: 'play_song', song, queue });
        return true;
      });
      setDeviceId(id);
      setSession(current);
      stopView = current.subscribe(nextView => {
        setView(nextView);
        setConnectPosition(nextView.livePosition);
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
      artwork: song.artwork && /^https:\/\//i.test(song.artwork) ? song.artwork : '',
      duration: Math.max(0, song.duration ?? 0),
    });
    const tracker = createListenTracker((song, seconds, startedAt) => {
      if (!signedInRef.current) return;
      const started = startWrites.get(song.id);
      const resolve = started ?? refFor(song).then(ref => ref ? { ref, snapshot: snapshotFor(song, ref) } : null);
      resolve.then(value => {
        if (value) recordPlay(value.ref, seconds, value.snapshot, startedAt);
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
  const remotePlayback = Boolean(view?.activeDeviceId && view.activeDeviceId !== deviceId && view.activeDeviceOnline && view.song);

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
  }), [account.signedIn, deviceId, view, remotePlayback, devicesVisible, openDevices, closeDevices, control, transferTo]);

  return <ConnectContext.Provider value={value}>{children}</ConnectContext.Provider>;
};

export const useConnect = (): ConnectContextValue => useContext(ConnectContext);
