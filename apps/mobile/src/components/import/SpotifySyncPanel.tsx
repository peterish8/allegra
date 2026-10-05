import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import type { SpotifySourcePlaylist, SpotifyStatus, SpotifySyncStep } from '@shared/spotify';
import { connectSpotify, disconnectSpotify, fetchSpotifyPlaylists, fetchSpotifyStatus, setSpotifyDailySync, SpotifyApiError, syncSpotifyPlaylist } from '../../services/spotify/spotifyApi';
import { Glass, Signal } from '../../constants/allegraTheme';

const apiMessage = (error: unknown): string => error instanceof SpotifyApiError && error.status === 401
  ? 'Your Spotify connection needs attention. Reconnect to continue.'
  : error instanceof SpotifyApiError && error.status === 429
    ? `Spotify asked us to slow down. Try again${error.retryAfterSeconds === undefined ? ' in a moment' : ` in ${Math.ceil(error.retryAfterSeconds)} seconds`}.`
    : error instanceof Error ? error.message : 'Spotify could not be reached. Try again.';

export const SpotifySyncPanel: React.FC<{ readonly accountKey: string | null; readonly token: string | null }> = ({ accountKey, token }) => {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [sources, setSources] = useState<readonly SpotifySourcePlaylist[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [progress, setProgress] = useState<SpotifySyncStep | null>(null);
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
        setSelectedId((current) => result.playlists.some((playlist) => playlist.id === current)
          ? current : result.playlists.find((playlist) => next.playlists.some((tracked) => tracked.id === playlist.id))?.id ?? '');
      } else { setSources([]); setSelectedId(''); }
    } catch (error) { if (!signal.aborted && run === generation.current) { setMessage(apiMessage(error)); if (error instanceof SpotifyApiError && error.status === 401) setNeedsReconnect(true); } }
    finally {
      if (run === generation.current) setBusy(false);
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, [accountKey, token]);

  useFocusEffect(useCallback(() => {
    generation.current += 1; active.current?.abort(); active.current = null; statusRequest.current?.abort(); statusRequest.current = null;
    setStatus(null); setSources([]); setSelectedId(''); setProgress(null); setSyncing(false); setMessage(''); setNeedsReconnect(false);
    if (!accountKey || !token) return undefined;
    const controller = new AbortController();
    void refresh(controller);
    return () => { controller.abort(); generation.current += 1; active.current?.abort(); active.current = null; statusRequest.current?.abort(); statusRequest.current = null; };
  }, [accountKey, token, refresh]));

  const connect = async (): Promise<void> => {
    if (!token) return;
    const flowGeneration = generation.current;
    setBusy(true); setMessage('');
    try {
      const result = await connectSpotify(token);
      // The auth session closes the tab when the API redirects to lyricflow://open/import?spotify=…
      const session = await WebBrowser.openAuthSessionAsync(result.url, 'lyricflow://open/import');
      if (flowGeneration !== generation.current) return;
      void refresh(new AbortController()); // clears the message synchronously, so the outcome is set after
      const outcome = session.type === 'success' ? new URL(session.url).searchParams.get('spotify') : null;
      if (outcome === 'cancelled') setMessage('Spotify connection was cancelled.');
      else if (outcome === 'failed') setMessage('Spotify connection failed. Try connecting again.');
    }
    catch (error) { if (flowGeneration === generation.current) { setMessage(apiMessage(error)); if (error instanceof SpotifyApiError && error.status === 401) setNeedsReconnect(true); } }
    finally { if (flowGeneration === generation.current) setBusy(false); }
  };

  const sync = async (): Promise<void> => {
    if (!token || !selectedId || syncing) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    setSyncing(true); setMessage('');
    try {
      for (let step = 0; step < 100; step += 1) {
        const latest = await syncSpotifyPlaylist(token, selectedId, controller.signal);
        if (controller.signal.aborted) return;
        setProgress(latest);
        if (latest.complete) { setMessage('Transfer complete. Your library is up to date.'); await refresh(new AbortController()); return; }
      }
      setMessage('This transfer is still in progress. Continue to finish the remaining songs.');
    } catch (error) { if (!controller.signal.aborted) { setMessage(apiMessage(error)); if (error instanceof SpotifyApiError && error.status === 401) setNeedsReconnect(true); } }
    finally { if (active.current === controller) active.current = null; setSyncing(false); }
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
    Alert.alert('Disconnect Spotify?', 'Your Allegra playlists stay in your library. Scheduled transfers will stop.', [
      { text: 'Keep connected', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => {
        setBusy(true); setMessage('');
        void disconnectSpotify(token).then(() => {
          active.current?.abort(); setStatus((current) => current ? { ...current, connected: false, dailyEnabled: false, playlists: [] } : current);
          setSources([]); setSelectedId(''); setProgress(null); setMessage('Spotify is disconnected. Your Allegra playlists remain.');
        }).catch((error: unknown) => setMessage(apiMessage(error))).finally(() => setBusy(false));
      } }
    ]);
  };

  const action = (label: string, onPress: () => void, primary = false, disabled = false) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: primary ? Signal.wave : Glass.fillLight, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: primary ? Signal.waveInk : Signal.ink, textAlign: 'center', fontWeight: '700' }}>{label}</Text></Pressable>;

  // Round icon buttons; the words live in the accessibility label.
  const iconAction = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, primary = false, disabled = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} hitSlop={6} style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? Signal.wave : Glass.fillLight, opacity: disabled ? 0.45 : 1 }}><Ionicons name={icon} size={20} color={primary ? Signal.waveInk : Signal.ink} /></Pressable>;

  return <View style={{ backgroundColor: Glass.fill, borderColor: Glass.hairline, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 }}>
    <View><Text accessibilityRole="header" style={{ color: Signal.ink, fontSize: 18, fontWeight: '700' }}>Transfer from Spotify</Text><Text style={{ color: Signal.inkSoft, lineHeight: 20, marginTop: 5 }}>Connect with Spotify’s official authorization. Allegra matches playlist songs to its own catalog.</Text></View>
    {message ? <Text accessibilityRole="alert" style={{ color: Signal.accentBright }}>{message}</Text> : null}
    {needsReconnect ? action('Reconnect Spotify', () => void connect(), true, busy || syncing) : null}
    {!accountKey ? <Text style={{ color: Signal.inkMuted }}>Loading your account…</Text> : status?.configured === false ? <Text style={{ color: Signal.inkMuted }}>Spotify connection is not available yet. The export and CSV options remain below.</Text> : status?.connected ? <>
      <Text style={{ color: Signal.inkMuted }}>Choose a Spotify playlist</Text>
      <View style={{ gap: 7 }}>{sources.map((playlist) => <Pressable key={playlist.id} onPress={() => { setSelectedId(playlist.id); setProgress(null); }} accessibilityRole="radio" accessibilityState={{ checked: selectedId === playlist.id }} style={{ minHeight: 44, padding: 11, borderRadius: 12, backgroundColor: selectedId === playlist.id ? Glass.fillLight : 'transparent', borderWidth: 1, borderColor: selectedId === playlist.id ? Signal.wave : Glass.hairline }}><Text style={{ color: Signal.ink }}>{selectedId === playlist.id ? '● ' : '○ '}{playlist.name} · {playlist.total}</Text></Pressable>)}</View>
      {sources.length === 0 ? <Text style={{ color: Signal.inkMuted }}>No playlists are available for transfer.</Text> : null}
      {progress ? <Text accessibilityLiveRegion="polite" style={{ color: Signal.inkSoft }}>{progress.added} added · {progress.skipped} skipped · {progress.reviewNeeded} need review</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {syncing
          ? iconAction('pause', 'Pause sync', () => { active.current?.abort(); setMessage('Paused. Confirmed songs stay saved; continue when you are ready.'); })
          : iconAction('download-outline', progress && !progress.complete ? 'Continue sync' : 'Sync new songs into Allegra', () => void sync(), true, !selectedId || busy)}
        {iconAction('refresh', 'Refresh playlists', () => { void refresh(new AbortController()); }, false, busy || syncing)}
        {syncing || busy ? <ActivityIndicator color={Signal.inkSoft} /> : null}
      </View>
      <Pressable onPress={() => void daily(!status.dailyEnabled)} disabled={busy || syncing} accessibilityRole="switch" accessibilityState={{ checked: status.dailyEnabled, disabled: busy || syncing }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}><Text style={{ color: Signal.ink, fontSize: 18 }}>{status.dailyEnabled ? '☑' : '□'}</Text><Text style={{ color: Signal.inkSoft, flex: 1 }}>Check my synced playlists daily for new songs</Text></Pressable>
      <Text style={{ color: Signal.inkMuted, lineHeight: 19 }}>{status.playlists.length === 0 ? 'The daily check covers playlists you have synced once. Sync one to include it.' : `Daily check covers ${status.playlists.length} ${status.playlists.length === 1 ? 'playlist' : 'playlists'}: ${status.playlists.map((row) => row.name).join(', ')}.`}</Text>
      {action('Disconnect Spotify', disconnect, false, busy || syncing)}
    </> : status?.configured ? action(busy ? 'Opening Spotify…' : 'Connect Spotify', () => void connect(), true, busy) : null}
    {busy && !syncing ? <ActivityIndicator color={Signal.wave} /> : null}
  </View>;
};

export default SpotifySyncPanel;
