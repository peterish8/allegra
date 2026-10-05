/**
 * Spotify transfer on the phone: Liked Songs first, then every playlist with its cover. Tick as many
 * as you like (or all of them) and one Transfer runs them in turn, each row showing its own progress
 * and ending on a check. Liked Songs land in Allegra likes; a playlist becomes its own playlist.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { SPOTIFY_LIKED_ID, type SpotifySourcePlaylist, type SpotifyStatus, type SpotifySyncStep } from '@shared/spotify';
import { connectSpotify, disconnectSpotify, fetchSpotifyPlaylists, fetchSpotifyStatus, setSpotifyDailySync, SpotifyApiError, syncSpotifyPlaylist } from '../../services/spotify/spotifyApi';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { Glass, Motion, Radius, Signal, Space } from '../../constants/allegraTheme';
import { Artwork } from '../allegra/Artwork';
import { RiseIn, Tactile } from '../allegra/motion';

const apiMessage = (error: unknown): string => error instanceof SpotifyApiError && error.status === 401
  ? 'Your Spotify connection needs attention. Reconnect to continue.'
  : error instanceof SpotifyApiError && error.status === 429
    ? `Spotify asked us to slow down. Try again${error.retryAfterSeconds === undefined ? ' in a moment' : ` in ${Math.ceil(error.retryAfterSeconds)} seconds`}.`
    : error instanceof Error ? error.message : 'Spotify could not be reached. Try again.';

/** One row's part in the current run. */
type RowRun = { readonly state: 'waiting' } | { readonly state: 'syncing' | 'done'; readonly step: SpotifySyncStep | null } | { readonly state: 'failed'; readonly message: string };

const COVER = 52;
const MAX_STEPS = 100;

const songCount = (total: number): string => `${total} ${total === 1 ? 'song' : 'songs'}`;
const ago = (at: number): string => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

/** A ticked row fills with the action colour and the check springs in; Reduce Motion fades it. */
const Check: React.FC<{ on: boolean }> = ({ on }) => {
  const reduce = useReducedMotion();
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => { t.value = reduce ? withTiming(on ? 1 : 0, { duration: Motion.duration.fast }) : withSpring(on ? 1 : 0, Motion.spring.tactile); }, [on, reduce, t]);
  const fill = useAnimatedStyle(() => ({ opacity: t.value, transform: reduce ? [] : [{ scale: 0.6 + 0.4 * t.value }] }));
  return (
    <View style={styles.check}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.checkFill, fill]}>
        <Ionicons name="checkmark" size={16} color={Signal.waveInk} />
      </Animated.View>
    </View>
  );
};

/** A thin bar that grows from the left by translating a full-width fill (transform only). */
const Progress: React.FC<{ value: number }> = ({ value }) => {
  const [width, setWidth] = useState(0);
  const t = useSharedValue(value);
  useEffect(() => { t.value = withTiming(value, { duration: Motion.duration.slow, easing: Motion.ease.decelerate }); }, [t, value]);
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: -(1 - Math.min(1, Math.max(0, t.value))) * width }] }));
  return (
    <View style={styles.track} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Animated.View style={[styles.trackFill, fill]} />
    </View>
  );
};

/** Spotify's Liked Songs tile, in Allegra's own warm-to-blue, with the heart. */
const LikedCover: React.FC = () => (
  <LinearGradient colors={[Signal.accentDeep, Signal.accent, Signal.vibeBlue]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.cover}>
    <Ionicons name="heart" size={22} color={Signal.ink} />
  </LinearGradient>
);

const SourceRow: React.FC<{
  readonly playlist: SpotifySourcePlaylist;
  readonly index: number;
  readonly selected: boolean;
  readonly run: RowRun | undefined;
  readonly lastSyncedAt: number | null;
  readonly locked: boolean;
  readonly onToggle: () => void;
  readonly onReconnect: () => void;
}> = ({ playlist, index, selected, run, lastSyncedAt, locked, onToggle, onReconnect }) => {
  const liked = playlist.kind === 'liked';
  const reconnect = liked && playlist.needsReconnect === true;
  const processed = run && 'step' in run && run.step ? run.step.added + run.step.skipped + run.step.reviewNeeded : 0;
  const meta = reconnect ? 'Reconnect Spotify to include these'
    : run?.state === 'waiting' ? 'Up next'
    : run?.state === 'syncing' ? `Matching · ${run.step?.added ?? 0} added`
    : run?.state === 'done' ? `${run.step?.added ?? 0} added${run.step?.reviewNeeded ? ` · ${run.step.reviewNeeded} not exact, skipped` : ''}`
    : run?.state === 'failed' ? run.message
    : `${songCount(playlist.total)}${lastSyncedAt ? ` · synced ${ago(lastSyncedAt)}` : liked ? ' · saved as likes' : ''}`;
  return (
    <RiseIn index={index}>
      <Tactile
        onPress={reconnect ? onReconnect : onToggle}
        disabled={locked}
        pressScale={0.98}
        haptic="select"
        accessibilityRole={reconnect ? 'button' : 'checkbox'}
        accessibilityState={reconnect ? { disabled: locked } : { checked: selected, disabled: locked }}
        accessibilityLabel={`${playlist.name}, ${reconnect ? 'reconnect Spotify to include' : songCount(playlist.total)}`}
        style={[styles.row, selected && styles.rowOn]}
      >
        {liked ? <LikedCover /> : <Artwork uri={playlist.imageUrl ?? null} title={playlist.name} size={COVER} style={styles.cover} />}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{playlist.name}</Text>
          <Text style={[styles.rowMeta, run?.state === 'failed' && styles.rowMetaError]} numberOfLines={1}>{meta}</Text>
          {run?.state === 'syncing' && playlist.total > 0 ? <Progress value={processed / playlist.total} /> : null}
        </View>
        {reconnect ? <Ionicons name="refresh" size={20} color={Signal.inkSoft} />
          : run?.state === 'syncing' ? <ActivityIndicator color={Signal.wave} />
          : run?.state === 'done' ? <Ionicons name="checkmark-circle" size={26} color={Signal.wave} />
          : <Check on={selected} />}
      </Tactile>
    </RiseIn>
  );
};

export const SpotifySyncPanel: React.FC<{ readonly accountKey: string | null; readonly token: string | null }> = ({ accountKey, token }) => {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [sources, setSources] = useState<readonly SpotifySourcePlaylist[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [runs, setRuns] = useState<ReadonlyMap<string, RowRun>>(new Map());
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const active = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async (controller: AbortController) => {
    if (!accountKey || !token) return;
    statusRequest.current?.abort();
    statusRequest.current = controller;
    const { signal } = controller;
    const run = ++generation.current;
    setBusy(true); setMessage('');
    try {
      const next = await fetchSpotifyStatus(token, signal);
      if (signal.aborted || run !== generation.current) return;
      setStatus(next);
      if (next.connected) {
        const result = await fetchSpotifyPlaylists(token, signal);
        if (signal.aborted || run !== generation.current) return;
        setSources(result.playlists);
        const available = new Set(result.playlists.filter((row) => !row.needsReconnect).map((row) => row.id));
        // Keep what is still ticked; on first load, tick what was transferred before so a re-run picks up new songs.
        setSelected((current) => {
          const kept = [...current].filter((id) => available.has(id));
          return new Set(kept.length > 0 ? kept : next.playlists.map((tracked) => tracked.id).filter((id) => available.has(id)));
        });
      } else { setSources([]); setSelected(new Set()); }
    } catch (error) { if (!signal.aborted && run === generation.current) { setMessage(apiMessage(error)); if (error instanceof SpotifyApiError && error.status === 401) setNeedsReconnect(true); } }
    finally {
      if (run === generation.current) setBusy(false);
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, [accountKey, token]);

  useFocusEffect(useCallback(() => {
    generation.current += 1; active.current?.abort(); active.current = null; statusRequest.current?.abort(); statusRequest.current = null;
    setStatus(null); setSources([]); setSelected(new Set()); setRuns(new Map()); setSyncing(false); setMessage(''); setNeedsReconnect(false);
    if (!accountKey || !token) return undefined;
    const controller = new AbortController();
    void refresh(controller);
    return () => { controller.abort(); generation.current += 1; active.current?.abort(); active.current = null; statusRequest.current?.abort(); statusRequest.current = null; };
  }, [accountKey, token, refresh]));

  const connect = async (): Promise<void> => {
    if (!token || syncing) return;
    const flowGeneration = generation.current;
    setBusy(true); setMessage('');
    try {
      const result = await connectSpotify(token);
      // The auth session closes the tab when the API redirects to lyricflow://open/import?spotify=…
      const session = await WebBrowser.openAuthSessionAsync(result.url, 'lyricflow://open/import');
      if (flowGeneration !== generation.current) return;
      setNeedsReconnect(false);
      void refresh(new AbortController()); // clears the message synchronously, so the outcome is set after
      const outcome = session.type === 'success' ? new URL(session.url).searchParams.get('spotify') : null;
      if (outcome === 'cancelled') setMessage('Spotify connection was cancelled.');
      else if (outcome === 'failed') setMessage('Spotify connection failed. Try connecting again.');
    }
    catch (error) { if (flowGeneration === generation.current) { setMessage(apiMessage(error)); if (error instanceof SpotifyApiError && error.status === 401) setNeedsReconnect(true); } }
    finally { if (flowGeneration === generation.current) setBusy(false); }
  };

  const selectable = useMemo(() => sources.filter((row) => !row.needsReconnect), [sources]);
  const allOn = selectable.length > 0 && selectable.every((row) => selected.has(row.id));
  const queue = useMemo(() => sources.filter((row) => selected.has(row.id)), [sources, selected]);
  const songTotal = queue.reduce((sum, row) => sum + row.total, 0);

  const toggle = (id: string): void => {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setRuns((current) => { if (!current.has(id)) return current; const next = new Map(current); next.delete(id); return next; });
  };
  const toggleAll = (): void => { setSelected(allOn ? new Set() : new Set(selectable.map((row) => row.id))); setRuns(new Map()); };

  /** Every ticked source in list order, one bounded step at a time. A failed source is marked and the run moves on. */
  const transfer = async (): Promise<void> => {
    if (!token || syncing || queue.length === 0) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    const order = queue.map((row) => row.id);
    const set = (id: string, run: RowRun): void => setRuns((current) => new Map(current).set(id, run));
    setRuns(new Map(order.map((id) => [id, { state: 'waiting' } as const])));
    setSyncing(true); setMessage('');
    let added = 0; let notExact = 0; let finished = 0; let likedDone = false;
    try {
      for (const id of order) {
        let latest: SpotifySyncStep | null = null;
        set(id, { state: 'syncing', step: null });
        try {
          for (let step = 0; step < MAX_STEPS; step += 1) {
            latest = await syncSpotifyPlaylist(token, id, controller.signal);
            if (controller.signal.aborted) return;
            set(id, { state: latest.complete ? 'done' : 'syncing', step: latest });
            if (latest.complete) break;
          }
          if (!latest?.complete) { set(id, { state: 'failed', message: 'Still going. Transfer again to finish it.' }); continue; }
          added += latest.added; notExact += latest.reviewNeeded; finished += 1;
          if (id === SPOTIFY_LIKED_ID) likedDone = true;
        } catch (error) {
          if (controller.signal.aborted) return;
          // Authorization and rate limits stop the whole run; anything else stays on its own row.
          if (error instanceof SpotifyApiError && (error.status === 401 || error.status === 429)) { setMessage(apiMessage(error)); if (error.status === 401) setNeedsReconnect(true); set(id, { state: 'failed', message: 'Stopped here' }); return; }
          set(id, { state: 'failed', message: apiMessage(error) });
        }
      }
      setMessage(finished === 0 ? 'Nothing transferred. Check the rows above and try again.'
        : `${added} ${added === 1 ? 'song' : 'songs'} added from ${finished} ${finished === 1 ? 'source' : 'sources'}.${notExact ? ` ${notExact} had no exact match and were left out; the next transfer tries them again.` : ''}`);
      if (likedDone || added > 0) useOnlineLibraryStore.getState().load().catch(() => undefined);
      const statusNow = await fetchSpotifyStatus(token, controller.signal).catch(() => null);
      if (statusNow && !controller.signal.aborted) setStatus(statusNow);
    } finally {
      if (active.current === controller) active.current = null;
      setSyncing(false);
    }
  };

  const pause = (): void => {
    active.current?.abort();
    setRuns((current) => new Map([...current].filter(([, run]) => run.state === 'done' || run.state === 'failed')));
    setMessage('Paused. Songs already added stay saved; transfer again to carry on.');
  };

  const daily = async (enabled: boolean): Promise<void> => {
    if (!token || !status) return;
    setBusy(true); setMessage('');
    try { const result = await setSpotifyDailySync(token, enabled); setStatus({ ...status, dailyEnabled: result.dailyEnabled }); }
    catch (error) { setMessage(apiMessage(error)); if (error instanceof SpotifyApiError && error.status === 401) setNeedsReconnect(true); }
    finally { setBusy(false); }
  };

  const disconnect = (): void => {
    if (!token) return;
    Alert.alert('Disconnect Spotify?', 'Your Allegra playlists and likes stay. Scheduled transfers will stop.', [
      { text: 'Keep connected', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => {
        setBusy(true); setMessage('');
        void disconnectSpotify(token).then(() => {
          active.current?.abort(); setStatus((current) => current ? { ...current, connected: false, dailyEnabled: false, playlists: [] } : current);
          setSources([]); setSelected(new Set()); setRuns(new Map()); setMessage('Spotify is disconnected. Your Allegra playlists remain.');
        }).catch((error: unknown) => setMessage(apiMessage(error))).finally(() => setBusy(false));
      } }
    ]);
  };

  const tracked = useMemo(() => new Map(status?.playlists.map((row) => [row.id, row.lastSyncedAt]) ?? []), [status]);
  const doneCount = [...runs.values()].filter((run) => run.state === 'done').length;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.brand}><Ionicons name="musical-notes" size={18} color={Signal.waveInk} /></View>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={styles.title}>Spotify</Text>
          <Text style={styles.sub}>{status?.connected ? 'Pick what to bring. Songs are matched to Allegra’s catalog.' : 'Bring your Liked Songs and playlists over in one go.'}</Text>
        </View>
        {status?.connected ? (
          <Tactile onPress={() => void refresh(new AbortController())} disabled={busy || syncing} hitSlop={6} accessibilityRole="button" accessibilityLabel="Refresh playlists" style={[styles.iconButton, (busy || syncing) && styles.dim]}>
            {busy && !syncing ? <ActivityIndicator size="small" color={Signal.inkSoft} /> : <Ionicons name="refresh" size={18} color={Signal.ink} />}
          </Tactile>
        ) : null}
      </View>

      {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {needsReconnect && status?.connected ? <Tactile onPress={() => void connect()} disabled={busy || syncing} accessibilityRole="button" style={[styles.primary, styles.wide]}><Ionicons name="link" size={18} color={Signal.waveInk} /><Text style={styles.primaryText}>Reconnect Spotify</Text></Tactile> : null}

      {!accountKey ? <Text style={styles.sub}>Loading your account…</Text>
        : status?.configured === false ? <Text style={styles.sub}>Spotify connection is not available yet. The export and CSV options remain below.</Text>
        : status?.connected ? (
          <>
            <View style={styles.listHead}>
              <Text style={styles.listLabel}>{selected.size > 0 ? `${selected.size} selected · ${songCount(songTotal)}` : `${sources.length} on Spotify`}</Text>
              <Tactile onPress={toggleAll} disabled={syncing || selectable.length === 0} pressScale={0.96} haptic="select" accessibilityRole="checkbox" accessibilityState={{ checked: allOn, disabled: syncing }} accessibilityLabel="Select all" style={[styles.allChip, allOn && styles.allChipOn]}>
                <Ionicons name={allOn ? 'checkmark-done' : 'checkmark-done-outline'} size={16} color={allOn ? Signal.waveInk : Signal.ink} />
                <Text style={[styles.allText, allOn && styles.allTextOn]}>All</Text>
              </Tactile>
            </View>

            <View style={styles.list}>
              {sources.map((playlist, index) => (
                <SourceRow
                  key={playlist.id}
                  playlist={playlist}
                  index={index}
                  selected={selected.has(playlist.id)}
                  run={runs.get(playlist.id)}
                  lastSyncedAt={tracked.get(playlist.id) ?? null}
                  locked={syncing || busy}
                  onToggle={() => toggle(playlist.id)}
                  onReconnect={() => void connect()}
                />
              ))}
              {sources.length === 0 && !busy ? <Text style={styles.sub}>Nothing on Spotify to transfer yet.</Text> : null}
            </View>

            <View style={styles.dock}>
              {syncing ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dockTitle} accessibilityLiveRegion="polite">Transferring {Math.min(doneCount + 1, queue.length)} of {queue.length}</Text>
                    <Progress value={queue.length ? doneCount / queue.length : 0} />
                  </View>
                  <Tactile onPress={pause} accessibilityRole="button" accessibilityLabel="Pause transfer" style={styles.iconButton}><Ionicons name="pause" size={18} color={Signal.ink} /></Tactile>
                </>
              ) : (
                <Tactile onPress={() => void transfer()} disabled={queue.length === 0 || busy} wrapperStyle={{ flex: 1 }} accessibilityRole="button" style={[styles.primary, (queue.length === 0 || busy) && styles.dim]}>
                  <Ionicons name="arrow-down-circle" size={20} color={Signal.waveInk} />
                  <Text style={styles.primaryText}>{queue.length === 0 ? 'Choose what to transfer' : `Transfer ${queue.length === 1 ? queue[0]!.name : `${queue.length} sources`}`}</Text>
                </Tactile>
              )}
            </View>

            <View style={styles.setting}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Check daily for new songs</Text>
                <Text style={styles.sub}>{status.playlists.length === 0 ? 'Covers whatever you have transferred once.' : `Covers ${status.playlists.length} ${status.playlists.length === 1 ? 'source' : 'sources'} you transferred.`}</Text>
              </View>
              <Switch value={status.dailyEnabled} disabled={busy || syncing} onValueChange={(value) => void daily(value)} trackColor={{ false: Glass.fillPressed, true: Signal.wave }} thumbColor={Signal.ink} accessibilityLabel="Check daily for new songs" />
            </View>
            <Pressable onPress={disconnect} disabled={busy || syncing} accessibilityRole="button" hitSlop={8} style={styles.disconnect}><Text style={styles.disconnectText}>Disconnect Spotify</Text></Pressable>
          </>
        ) : status?.configured ? (
          <Tactile onPress={() => void connect()} disabled={busy} accessibilityRole="button" style={[styles.primary, styles.wide, busy && styles.dim]}>
            {busy ? <ActivityIndicator color={Signal.waveInk} /> : <Ionicons name="link" size={18} color={Signal.waveInk} />}
            <Text style={styles.primaryText}>{busy ? 'Opening Spotify…' : 'Connect Spotify'}</Text>
          </Tactile>
        ) : <ActivityIndicator color={Signal.wave} />}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: { backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.panel, padding: Space.md, gap: Space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  brand: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  title: { color: Signal.ink, fontSize: 20, fontWeight: '800' },
  sub: { color: Signal.inkMuted, fontSize: 13, lineHeight: 18 },
  message: { color: Signal.accentBright, fontSize: 13, lineHeight: 18 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  dim: { opacity: 0.45 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.xs },
  listLabel: { color: Signal.inkSoft, fontSize: 13, fontWeight: '600' },
  allChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  allChipOn: { backgroundColor: Signal.wave, borderColor: Signal.wave },
  allText: { color: Signal.ink, fontSize: 13, fontWeight: '700' },
  allTextOn: { color: Signal.waveInk },
  list: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 68, paddingVertical: 8, paddingHorizontal: 8, borderRadius: Radius.well, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  rowOn: { backgroundColor: Glass.fillLight, borderColor: Glass.hairlineStrong },
  cover: { width: COVER, height: COVER, borderRadius: Radius.thumb, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { color: Signal.ink, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: Signal.inkMuted, fontSize: 12 },
  rowMetaError: { color: Signal.accentBright },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: Glass.hairlineStrong, overflow: 'hidden' },
  checkFill: { alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  track: { height: 3, borderRadius: 2, marginTop: 4, overflow: 'hidden', backgroundColor: Glass.fillPressed },
  trackFill: { ...StyleSheet.absoluteFillObject, backgroundColor: Signal.wave, borderRadius: 2 },
  dock: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.xs },
  dockTitle: { color: Signal.ink, fontSize: 14, fontWeight: '700' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: 52, paddingHorizontal: Space.md, borderRadius: Radius.pill, backgroundColor: Signal.wave },
  primaryText: { color: Signal.waveInk, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  wide: { alignSelf: 'stretch' },
  setting: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingTop: Space.sm, marginTop: Space.xs },
  settingTitle: { color: Signal.ink, fontSize: 14, fontWeight: '600' },
  disconnect: { alignSelf: 'center', paddingVertical: Space.xs },
  disconnectText: { color: Signal.inkMuted, fontSize: 13, fontWeight: '600' },
});

export default SpotifySyncPanel;
