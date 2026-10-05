'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Pause, RotateCw } from 'lucide-react';
import { ApiError, connectSpotify, disconnectSpotify, fetchSpotifyPlaylists, fetchSpotifyStatus, setSpotifyDailySync, syncSpotifyPlaylist } from '../../lib/api';
import type { SpotifySourcePlaylist, SpotifyStatus, SpotifySyncStep } from '@shared/spotify';

const errorText = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 401) return 'Your Spotify connection needs attention. Reconnect to continue.';
  if (error instanceof ApiError && error.status === 429) return `Spotify asked us to slow down. Try again${error.retryAfterSeconds === undefined ? ' in a moment' : ` in ${Math.ceil(error.retryAfterSeconds)} seconds`}.`;
  return error instanceof Error ? error.message : 'Spotify could not be reached. Try again.';
};
const isSyncStep = (value: unknown): value is SpotifySyncStep => typeof value === 'object' && value !== null
  && typeof (value as SpotifySyncStep).complete === 'boolean'
  && Number.isInteger((value as SpotifySyncStep).added) && Number.isInteger((value as SpotifySyncStep).skipped)
  && Number.isInteger((value as SpotifySyncStep).reviewNeeded) && typeof (value as SpotifySyncStep).libraryId === 'string';
const readStatus = (value: unknown): SpotifyStatus => {
  if (typeof value !== 'object' || value === null) throw new Error('Spotify returned an invalid status response.');
  const status = value as SpotifyStatus;
  if (typeof status.configured !== 'boolean' || typeof status.connected !== 'boolean' || typeof status.dailyEnabled !== 'boolean' || !Array.isArray(status.playlists)) throw new Error('Spotify returned an invalid status response.');
  return status;
};
const readPlaylists = (value: unknown): readonly SpotifySourcePlaylist[] => {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { playlists?: unknown }).playlists)) throw new Error('Spotify returned an invalid playlist list.');
  const rows = (value as { playlists: unknown[] }).playlists;
  if (!rows.every((row) => typeof row === 'object' && row !== null && typeof (row as SpotifySourcePlaylist).id === 'string' && typeof (row as SpotifySourcePlaylist).name === 'string' && typeof (row as SpotifySourcePlaylist).snapshotId === 'string' && Number.isInteger((row as SpotifySourcePlaylist).total))) throw new Error('Spotify returned an invalid playlist list.');
  return rows as SpotifySourcePlaylist[];
};

export function SpotifySyncPanel({ accountKey }: { readonly accountKey: string | null }) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [sources, setSources] = useState<readonly SpotifySourcePlaylist[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [progress, setProgress] = useState<SpotifySyncStep | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const run = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async (controller: AbortController) => {
    if (!accountKey) return;
    statusRequest.current?.abort();
    statusRequest.current = controller;
    const { signal } = controller;
    const current = ++generation.current;
    setLoading(true); setMessage('');
    try {
      const next = readStatus(await fetchSpotifyStatus(signal));
      if (signal?.aborted || current !== generation.current) return;
      setStatus(next);
      if (next.connected) {
        const playlists = readPlaylists(await fetchSpotifyPlaylists(signal));
        if (signal?.aborted || current !== generation.current) return;
        setSources(playlists);
        const resumable = [...next.playlists].filter((tracked) => playlists.some((playlist) => playlist.id === tracked.id))
          .sort((a, b) => Number(b.syncing) - Number(a.syncing) || (b.lastSyncedAt ?? 0) - (a.lastSyncedAt ?? 0))[0]?.id ?? '';
        setSelectedId((selected) => playlists.some((playlist) => playlist.id === selected)
          ? selected : resumable);
      } else { setSources([]); setSelectedId(''); }
    } catch (error) {
      if (!signal?.aborted && current === generation.current) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); }
    } finally {
      if (current === generation.current) setLoading(false);
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, [accountKey]);

  useEffect(() => {
    generation.current += 1; run.current?.abort(); run.current = null; statusRequest.current?.abort(); statusRequest.current = null;
    setStatus(null); setSources([]); setSelectedId(''); setProgress(null); setSyncing(false); setMessage(''); setNeedsReconnect(false);
    if (!accountKey) return;
    const controller = new AbortController();
    void refresh(controller);
    const onVisible = (): void => { if (document.visibilityState === 'visible') void refresh(new AbortController()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', onVisible); generation.current += 1; run.current?.abort(); statusRequest.current?.abort(); statusRequest.current = null; };
  }, [accountKey, refresh]);

  // The OAuth callback lands back here with ?spotify=connected|cancelled|failed; say so once, then drop it from the URL.
  // Declared after the account effect: its refresh clears the message synchronously.
  useEffect(() => {
    if (!accountKey) return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get('spotify');
    if (!result) return;
    setMessage(result === 'connected' ? 'Spotify is connected. Choose a playlist to transfer.' : result === 'cancelled' ? 'Spotify connection was cancelled.' : 'Spotify connection failed. Try connecting again.');
    url.searchParams.delete('spotify');
    window.history.replaceState(window.history.state, '', url);
  }, [accountKey]);

  const connect = async (): Promise<void> => {
    setLoading(true); setMessage('');
    try {
      const result: unknown = await connectSpotify('web');
      if (typeof result !== 'object' || result === null || typeof (result as { url?: unknown }).url !== 'string' || !/^https:\/\/accounts\.spotify\.com\//i.test((result as { url: string }).url)) throw new Error('Spotify connect returned an invalid authorization URL.');
      window.location.assign((result as { url: string }).url);
    }
    catch (error) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); setLoading(false); }
  };

  const sync = async (): Promise<void> => {
    if (!selectedId || syncing) return;
    const controller = new AbortController(); run.current?.abort(); run.current = controller;
    setSyncing(true); setMessage('');
    try {
      let latest: SpotifySyncStep | null = null;
      for (let step = 0; step < 100; step += 1) {
        const response: unknown = await syncSpotifyPlaylist(selectedId, controller.signal);
        if (!isSyncStep(response)) throw new Error('Spotify returned an invalid sync progress response.');
        latest = response;
        if (controller.signal.aborted) return;
        setProgress(latest);
        if (latest.complete) { setMessage('Transfer complete. Your library is up to date.'); await refresh(new AbortController()); return; }
      }
      setMessage('This transfer is still in progress. Continue to finish the remaining songs.');
    } catch (error) { if (!controller.signal.aborted) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); } }
    finally { if (run.current === controller) run.current = null; setSyncing(false); }
  };

  const daily = async (enabled: boolean): Promise<void> => {
    if (!status) return;
    setLoading(true); setMessage('');
    try {
      const result: unknown = await setSpotifyDailySync(enabled);
      if (typeof result !== 'object' || result === null || (result as { dailyEnabled?: unknown }).dailyEnabled !== enabled) throw new Error('Spotify did not confirm the daily transfer setting.');
      setStatus({ ...status, dailyEnabled: enabled });
    }
    catch (error) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); }
    finally { setLoading(false); }
  };

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('Disconnect Spotify? Existing Allegra playlists will stay in your library.')) return;
    setLoading(true); setMessage('');
    try {
      const result: unknown = await disconnectSpotify();
      if (typeof result !== 'object' || result === null || (result as { disconnected?: unknown }).disconnected !== true) throw new Error('Spotify did not confirm disconnecting.');
      run.current?.abort(); setStatus((current) => current ? { ...current, connected: false, dailyEnabled: false, playlists: [] } : current); setSources([]); setSelectedId(''); setProgress(null); setMessage('Spotify is disconnected. Your Allegra playlists remain.');
    }
    catch (error) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); }
    finally { setLoading(false); }
  };

  const syncLabel = progress && !progress.complete ? 'Continue sync' : 'Sync new songs into Allegra';
  const lastSynced = status?.playlists.find((row) => row.id === selectedId)?.lastSyncedAt ?? null;

  return <section className="import-panel spotify-sync" aria-labelledby="spotify-sync-title">
    <div><h2 id="spotify-sync-title" className="import-card__title">Transfer from Spotify</h2><p className="import-note">Connect with Spotify’s official authorization. Allegra transfers playlist metadata and matches songs to its own catalog.</p></div>
    {message ? <p role="status" aria-live="polite" className="import-note">{message}</p> : null}
    {needsReconnect ? <button className="import-spotify-primary" type="button" onClick={() => void connect()} disabled={loading}>Reconnect Spotify</button> : null}
    {!accountKey ? <p role="status" className="import-note">Loading your account…</p> : status?.configured === false ? <p role="status" className="import-note">Spotify connection is not available yet. You can still import a Spotify export or CSV below.</p> : status?.connected ? <>
      <label className="spotify-sync__label" htmlFor="spotify-playlist">Spotify playlist</label>
      <select id="spotify-playlist" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setProgress(null); }} disabled={loading || syncing || sources.length === 0}>
        <option value="">{sources.length ? 'Choose a playlist' : 'No playlists available'}</option>
        {sources.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.total}</option>)}
      </select>
      {lastSynced ? <p className="import-note">Last synced {new Date(lastSynced).toLocaleString()}</p> : null}
      {progress ? <p className="import-note" aria-live="polite">{progress.added} added · {progress.skipped} skipped · {progress.reviewNeeded} need review</p> : null}
      <div className="import-actions">
        {syncing
          ? <button className="spotify-icon-btn" type="button" aria-label="Pause sync" title="Pause sync" onClick={() => { run.current?.abort(); setMessage('Paused. Confirmed songs stay saved; continue when you are ready.'); }}><Pause size={18} aria-hidden="true" /></button>
          : <button className="spotify-icon-btn is-primary" type="button" aria-label={syncLabel} title={syncLabel} onClick={() => void sync()} disabled={!selectedId || loading}><ArrowDownToLine size={18} aria-hidden="true" /></button>}
        <button className="spotify-icon-btn" type="button" aria-label="Refresh playlists" title="Refresh playlists" onClick={() => void refresh(new AbortController())} disabled={loading || syncing}><RotateCw size={17} aria-hidden="true" className={loading ? 'is-spinning' : undefined} /></button>
        {syncing ? <span className="import-note" role="status">Syncing…</span> : null}
      </div>
      <label className="spotify-sync__toggle"><input type="checkbox" checked={status.dailyEnabled} disabled={loading} onChange={(event) => void daily(event.target.checked)} /> Check my synced playlists daily for new songs</label>
      <p className="import-note">{status.playlists.length === 0
        ? 'The daily check covers playlists you have synced once. Sync one to include it.'
        : `Daily check covers ${status.playlists.length} ${status.playlists.length === 1 ? 'playlist' : 'playlists'}: ${status.playlists.map((row) => row.name).join(', ')}.`}</p>
      <button className="import-spotify-link" type="button" onClick={() => void disconnect()} disabled={loading || syncing}>Disconnect Spotify</button>
    </> : status?.configured ? <button className="import-spotify-primary" type="button" onClick={() => void connect()} disabled={loading}>{loading ? 'Opening Spotify…' : 'Connect Spotify'}</button> : null}
  </section>;
}
