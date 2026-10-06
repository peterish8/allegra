'use client';

/**
 * Spotify transfer: Liked Songs first, then every playlist with its cover. Tick as many as you like
 * (or all of them) and one Transfer runs them in turn; each row shows its own progress and ends on a
 * check. Liked Songs land in Allegra likes, a playlist becomes its own playlist. Shown on Import and
 * on Blends; connecting from either brings you back to the page you started on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDownToLine, Check, CheckCheck, Link2, Pause, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { ApiError, connectSpotify, disconnectSpotify, fetchSpotifyPlaylists, fetchSpotifyStatus, setSpotifyDailySync, syncSpotifyPlaylist } from '../../lib/api';
import { SPOTIFY_LIKED_ID, type SpotifySourcePlaylist, type SpotifyStatus, type SpotifySyncStep } from '@shared/spotify';
import { useCoverFlight } from '../../hooks/useCoverFlight';
import { useThrottled } from '../../hooks/useThrottled';
import { crateIds, spotifyTickerText } from '@shared/importCrate';
import { announceLibraryArrival } from '../../lib/libraryArrival';
import { paths } from '../../lib/routes';
import { LIVE_SUMMARY_MS, motionTokens, swapVariants, TICKER_PER_SECOND } from '../../motion';
import { ProgressBar } from '../ui';
import { ArrivalCount } from './ArrivalCount';
import { SourceCover, SpotifyCrate } from './SpotifyCrate';

const RETURN_KEY = 'allegra:spotify-return';
const MAX_STEPS = 100;

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
const songCount = (total: number): string => `${total} ${total === 1 ? 'song' : 'songs'}`;
const ago = (at: number): string => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

/** The arrival's Open Library takes focus, so the keyboard lands on what comes next. */
const focusOnMount = (node: HTMLAnchorElement | null): void => { node?.focus({ preventScroll: true }); };

type RowRun = { readonly state: 'waiting' } | { readonly state: 'syncing' | 'done'; readonly step: SpotifySyncStep | null } | { readonly state: 'failed'; readonly message: string };

export function SpotifySyncPanel({ accountKey }: { readonly accountKey: string | null }) {
  const reduced = useReducedMotion() ?? false;
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [sources, setSources] = useState<readonly SpotifySourcePlaylist[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [runs, setRuns] = useState<ReadonlyMap<string, RowRun>>(new Map());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  /** A transfer where every source finished: the songs' arrival replaces the status line. */
  const [arrival, setArrival] = useState<{ readonly added: number; readonly notExact: number } | null>(null);
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
      if (signal.aborted || current !== generation.current) return;
      setStatus(next);
      if (next.connected) {
        const playlists = readPlaylists(await fetchSpotifyPlaylists(signal));
        if (signal.aborted || current !== generation.current) return;
        setSources(playlists);
        const available = new Set(playlists.filter((row) => !row.needsReconnect).map((row) => row.id));
        // Keep what is still ticked; on first load, tick what was transferred before so a re-run picks up new songs.
        setSelected((ticked) => {
          const kept = [...ticked].filter((id) => available.has(id));
          return new Set(kept.length > 0 ? kept : next.playlists.map((tracked) => tracked.id).filter((id) => available.has(id)));
        });
      } else { setSources([]); setSelected(new Set()); }
    } catch (error) {
      if (!signal.aborted && current === generation.current) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); }
    } finally {
      if (current === generation.current) setLoading(false);
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, [accountKey]);

  useEffect(() => {
    generation.current += 1; run.current?.abort(); run.current = null; statusRequest.current?.abort(); statusRequest.current = null;
    setStatus(null); setSources([]); setSelected(new Set()); setRuns(new Map()); setSyncing(false); setMessage(''); setArrival(null); setNeedsReconnect(false);
    if (!accountKey) return;
    const controller = new AbortController();
    void refresh(controller);
    const onVisible = (): void => { if (document.visibilityState === 'visible' && !run.current) void refresh(new AbortController()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', onVisible); generation.current += 1; run.current?.abort(); statusRequest.current?.abort(); statusRequest.current = null; };
  }, [accountKey, refresh]);

  // The OAuth callback lands on /import with ?spotify=connected|cancelled|failed. If the connect began on another page
  // (Blends), go back there with the same result; otherwise say so once and drop it from the URL.
  // Declared after the account effect: its refresh clears the message synchronously.
  useEffect(() => {
    if (!accountKey) return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get('spotify');
    if (!result) return;
    let origin: string | null = null;
    try { origin = window.sessionStorage.getItem(RETURN_KEY); window.sessionStorage.removeItem(RETURN_KEY); } catch { /* storage blocked: stay here */ }
    if (origin && origin.startsWith('/') && !origin.startsWith('//') && origin !== url.pathname) {
      window.location.replace(`${origin}?spotify=${encodeURIComponent(result)}`);
      return;
    }
    setMessage(result === 'connected' ? 'Spotify is connected. Pick what to bring over.' : result === 'cancelled' ? 'Spotify connection was cancelled.' : 'Spotify connection failed. Try connecting again.');
    url.searchParams.delete('spotify');
    window.history.replaceState(window.history.state, '', url);
  }, [accountKey]);

  const connect = async (): Promise<void> => {
    if (syncing) return;
    setLoading(true); setMessage('');
    try {
      const result: unknown = await connectSpotify('web');
      if (typeof result !== 'object' || result === null || typeof (result as { url?: unknown }).url !== 'string' || !/^https:\/\/accounts\.spotify\.com\//i.test((result as { url: string }).url)) throw new Error('Spotify connect returned an invalid authorization URL.');
      try { window.sessionStorage.setItem(RETURN_KEY, window.location.pathname); } catch { /* the callback page still works */ }
      window.location.assign((result as { url: string }).url);
    }
    catch (error) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); setLoading(false); }
  };

  const selectable = useMemo(() => sources.filter((row) => !row.needsReconnect), [sources]);
  const allOn = selectable.length > 0 && selectable.every((row) => selected.has(row.id));
  const queue = useMemo(() => sources.filter((row) => selected.has(row.id)), [sources, selected]);
  const songTotal = queue.reduce((sum, row) => sum + row.total, 0);
  const tracked = useMemo(() => new Map(status?.playlists.map((row) => [row.id, row.lastSyncedAt]) ?? []), [status]);
  const doneCount = [...runs.values()].filter((row) => row.state === 'done').length;
  const byId = useMemo(() => new Map(sources.map((row) => [row.id, row])), [sources]);
  const finished = useMemo(() => new Set([...runs].filter(([, row]) => row.state === 'done').map(([id]) => id)), [runs]);
  const queueIds = useMemo(() => queue.map((row) => row.id), [queue]);
  const crate = useMemo(() => crateIds(selected, queueIds, finished, syncing), [selected, queueIds, finished, syncing]);
  const runningId = syncing ? [...runs].find(([, row]) => row.state === 'syncing')?.[0] ?? null : null;
  const running = runningId ? runs.get(runningId) : undefined;
  const processed = [...runs.values()].reduce((sum, row) => sum + ('step' in row && row.step ? row.step.added + row.step.skipped + row.step.reviewNeeded : 0), 0);
  // What is happening, as it happens: the visual ticker at most TICKER_PER_SECOND, screen readers every LIVE_SUMMARY_MS.
  const ticker = useThrottled(runningId && running && 'step' in running ? spotifyTickerText(byId.get(runningId)?.name ?? '', running.step) : '', 1000 / TICKER_PER_SECOND);
  const summary = useThrottled(syncing ? `Transferring ${Math.min(doneCount + 1, queue.length)} of ${queue.length}. Matched ${processed} of ${songTotal} songs.` : '', LIVE_SUMMARY_MS);
  const slot = useRef<HTMLSpanElement>(null);
  const fly = useCoverFlight(!reduced);

  /** The tapped row's cover flies into the crate, or back out of it to the row. */
  const flyCover = (id: string, event: MouseEvent<HTMLButtonElement>): void => {
    const cover = event.currentTarget.querySelector('.spotify-source__cover');
    const target = slot.current;
    if (!cover || !target) return;
    const row = cover.getBoundingClientRect();
    const crateRect = target.getBoundingClientRect();
    if (selected.has(id)) fly(id, cover, crateRect, row);
    else fly(id, cover, row, crateRect);
  };

  const toggle = (id: string): void => {
    setArrival(null);
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setRuns((current) => { if (!current.has(id)) return current; const next = new Map(current); next.delete(id); return next; });
  };
  const toggleAll = (): void => { setArrival(null); setSelected(allOn ? new Set() : new Set(selectable.map((row) => row.id))); setRuns(new Map()); };

  /** Every ticked source in list order, one bounded step at a time. A failed source is marked and the run moves on. */
  const transfer = async (): Promise<void> => {
    if (syncing || queue.length === 0) return;
    const controller = new AbortController(); run.current?.abort(); run.current = controller;
    const order = queue.map((row) => row.id);
    const set = (id: string, next: RowRun): void => setRuns((current) => new Map(current).set(id, next));
    setRuns(new Map(order.map((id) => [id, { state: 'waiting' } as const])));
    setSyncing(true); setMessage(''); setArrival(null);
    let added = 0; let notExact = 0; let finished = 0;
    try {
      for (const id of order) {
        let latest: SpotifySyncStep | null = null;
        set(id, { state: 'syncing', step: null });
        try {
          for (let step = 0; step < MAX_STEPS; step += 1) {
            const response: unknown = await syncSpotifyPlaylist(id, controller.signal);
            if (!isSyncStep(response)) throw new Error('Spotify returned an invalid sync progress response.');
            latest = response;
            if (controller.signal.aborted) return;
            set(id, { state: latest.complete ? 'done' : 'syncing', step: latest });
            if (latest.complete) break;
          }
          if (!latest?.complete) { set(id, { state: 'failed', message: 'Still going. Transfer again to finish it.' }); continue; }
          added += latest.added; notExact += latest.reviewNeeded; finished += 1;
        } catch (error) {
          if (controller.signal.aborted) return;
          // Authorization and rate limits stop the whole run; anything else stays on its own row.
          if (error instanceof ApiError && (error.status === 401 || error.status === 429)) { setMessage(errorText(error)); if (error.status === 401) setNeedsReconnect(true); set(id, { state: 'failed', message: 'Stopped here' }); return; }
          set(id, { state: 'failed', message: errorText(error) });
        }
      }
      if (finished === order.length && added > 0) {
        setArrival({ added, notExact });
        announceLibraryArrival();
      } else setMessage(finished === 0 ? 'Nothing transferred. Check the rows above and try again.'
        : `${added} ${added === 1 ? 'song' : 'songs'} added from ${finished} ${finished === 1 ? 'source' : 'sources'}.${notExact ? ` ${notExact} had no exact match and were left out; the next transfer tries them again.` : ''}`);
      const next = await fetchSpotifyStatus(controller.signal).then(readStatus).catch(() => null);
      if (next && !controller.signal.aborted) setStatus(next);
    } finally {
      if (run.current === controller) run.current = null;
      setSyncing(false);
    }
  };

  const pause = (): void => {
    run.current?.abort();
    setRuns((current) => new Map([...current].filter(([, row]) => row.state === 'done' || row.state === 'failed')));
    setMessage('Paused. Songs already added stay saved; transfer again to carry on.');
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
    if (!window.confirm('Disconnect Spotify? Your Allegra playlists and likes stay.')) return;
    setLoading(true); setMessage('');
    try {
      const result: unknown = await disconnectSpotify();
      if (typeof result !== 'object' || result === null || (result as { disconnected?: unknown }).disconnected !== true) throw new Error('Spotify did not confirm disconnecting.');
      run.current?.abort(); setStatus((current) => current ? { ...current, connected: false, dailyEnabled: false, playlists: [] } : current); setSources([]); setSelected(new Set()); setRuns(new Map()); setArrival(null); setMessage('Spotify is disconnected. Your Allegra playlists remain.');
    }
    catch (error) { setMessage(errorText(error)); if (error instanceof ApiError && error.status === 401) setNeedsReconnect(true); }
    finally { setLoading(false); }
  };

  const enter = (index: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base, ease: motionTokens.ease.decelerate, delay: reduced ? 0 : Math.min(index, 10) * motionTokens.stagger }
  });

  return <section className="import-panel spotify-sync" aria-labelledby="spotify-sync-title">
    <header className="spotify-sync__head">
      <div>
        <h2 id="spotify-sync-title" className="import-card__title">Spotify</h2>
        <p className="import-note">{status?.connected ? 'Pick what to bring. Songs are matched to Allegra’s catalog.' : 'Bring your Liked Songs and playlists over in one go, with Spotify’s official sign-in.'}</p>
      </div>
      {status?.connected ? <button className="spotify-icon-btn" type="button" aria-label="Refresh playlists" title="Refresh playlists" onClick={() => void refresh(new AbortController())} disabled={loading || syncing}><RotateCw size={17} aria-hidden="true" className={loading && !syncing ? 'is-spinning' : undefined} /></button> : null}
    </header>
    {message ? <p role="status" aria-live="polite" className="import-note spotify-sync__message">{message}</p> : null}
    {arrival ? (
      <div className="import-arrival">
        <ArrivalCount value={arrival.added} noun={`${arrival.added === 1 ? 'song' : 'songs'} now in Allegra`} />
        {arrival.notExact ? <p className="import-note">{arrival.notExact} had no exact match and were left out; the next transfer tries them again.</p> : null}
        <Link className="import-link" href={paths.library} ref={focusOnMount}>Open Library</Link>
      </div>
    ) : null}
    {needsReconnect && status?.connected ? <button className="import-spotify-primary" type="button" onClick={() => void connect()} disabled={loading || syncing}><Link2 size={16} aria-hidden="true" /> Reconnect Spotify</button> : null}
    {!accountKey ? <p role="status" className="import-note">Sign in to connect Spotify.</p>
      : status?.configured === false ? <p role="status" className="import-note">Spotify connection is not available yet. You can still import a Spotify export or CSV on the Import page.</p>
      : status?.connected ? <>
        <div className="spotify-sync__bar">
          <span className="spotify-sync__count">{selected.size > 0 ? `${selected.size} selected · ${songCount(songTotal)}` : `${sources.length} on Spotify`}</span>
          <button type="button" className={`spotify-sync__all${allOn ? ' is-on' : ''}`} aria-pressed={allOn} onClick={toggleAll} disabled={syncing || selectable.length === 0}>
            <CheckCheck size={15} aria-hidden="true" /> {allOn ? 'Clear' : 'Select all'}
          </button>
        </div>
        <ul className="spotify-sync__list" aria-label="Spotify sources">
          {sources.map((playlist, index) => {
            const liked = playlist.kind === 'liked' || playlist.id === SPOTIFY_LIKED_ID;
            const reconnect = liked && playlist.needsReconnect === true;
            const on = selected.has(playlist.id);
            const state = runs.get(playlist.id);
            const processed = state && 'step' in state && state.step ? state.step.added + state.step.skipped + state.step.reviewNeeded : 0;
            const fraction = playlist.total > 0 ? Math.min(1, processed / playlist.total) : 0;
            const last = tracked.get(playlist.id) ?? null;
            const meta = reconnect ? 'Reconnect Spotify to include these'
              : state?.state === 'waiting' ? 'Up next'
              : state?.state === 'syncing' ? `Matching · ${state.step?.added ?? 0} added`
              : state?.state === 'done' ? `${state.step?.added ?? 0} added${state.step?.reviewNeeded ? ` · ${state.step.reviewNeeded} not exact, skipped` : ''}`
              : state?.state === 'failed' ? state.message
              : `${songCount(playlist.total)}${last ? ` · synced ${ago(last)}` : liked ? ' · saved as likes' : ''}`;
            return (
              <motion.li key={playlist.id} {...enter(index)}>
                <button
                  type="button"
                  className={`spotify-source${on ? ' is-on' : ''}${state?.state === 'done' ? ' is-done' : ''}`}
                  role={reconnect ? undefined : 'checkbox'}
                  aria-checked={reconnect ? undefined : on}
                  disabled={syncing || loading}
                  onClick={reconnect ? () => void connect() : (event) => { flyCover(playlist.id, event); toggle(playlist.id); }}
                >
                  <SourceCover playlist={playlist} size={52} />
                  <span className="spotify-source__text">
                    <span className="spotify-source__name">{playlist.name}</span>
                    <span className={`spotify-source__meta${state?.state === 'failed' ? ' is-error' : ''}`}>{meta}</span>
                    {state?.state === 'syncing' && playlist.total > 0 ? <ProgressBar className="is-thin" value={fraction} max={1} label={`${playlist.name} progress`} quiet /> : null}
                  </span>
                  <span className="spotify-source__mark" aria-hidden="true">
                    {reconnect ? <RotateCw size={18} /> : state?.state === 'syncing' ? <RotateCw size={18} className="is-spinning" /> : <Check size={16} strokeWidth={3} />}
                  </span>
                </button>
              </motion.li>
            );
          })}
          {sources.length === 0 && !loading ? <li className="import-note">Nothing on Spotify to transfer yet.</li> : null}
        </ul>
        <div className="spotify-sync__dock">
          <SpotifyCrate sources={byId} ids={crate} liftId={runningId} transferring={syncing} reduced={reduced} slotRef={slot} />
          {syncing ? <>
            <div className="spotify-sync__run">
              <strong aria-hidden="true">Transferring {Math.min(doneCount + 1, queue.length)} of {queue.length}</strong>
              <span className="spotify-sync__ticker" aria-hidden="true">
                <AnimatePresence mode="popLayout" initial={false}>
                  {ticker ? <motion.span key={ticker} variants={reduced ? undefined : swapVariants} initial={reduced ? { opacity: 0 } : 'hidden'} animate={reduced ? { opacity: 1 } : 'visible'} exit={reduced ? { opacity: 0 } : 'exit'}>{ticker}</motion.span> : null}
                </AnimatePresence>
              </span>
              <ProgressBar className="is-thin" value={doneCount} max={queue.length} label="Transfer progress" quiet />
              <span className="sr-only" aria-live="polite">{summary}</span>
            </div>
            <button className="spotify-icon-btn" type="button" aria-label="Pause transfer" title="Pause transfer" onClick={pause}><Pause size={18} aria-hidden="true" /></button>
          </> : <button className="import-spotify-primary spotify-sync__go" type="button" onClick={() => void transfer()} disabled={queue.length === 0 || loading}>
            <ArrowDownToLine size={18} aria-hidden="true" />
            {queue.length === 0 ? 'Choose what to transfer' : `Transfer ${queue.length === 1 ? queue[0]?.name ?? '' : `${queue.length} sources`}`}
          </button>}
        </div>
        <label className="spotify-sync__toggle"><input type="checkbox" role="switch" checked={status.dailyEnabled} disabled={loading || syncing} onChange={(event) => void daily(event.target.checked)} /> <span>Check daily for new songs<small>{status.playlists.length === 0 ? 'Covers whatever you have transferred once.' : `Covers ${status.playlists.length} ${status.playlists.length === 1 ? 'source' : 'sources'} you transferred.`}</small></span></label>
        <button className="import-spotify-link" type="button" onClick={() => void disconnect()} disabled={loading || syncing}>Disconnect Spotify</button>
      </> : status?.configured ? <button className="import-spotify-primary" type="button" onClick={() => void connect()} disabled={loading}><Link2 size={16} aria-hidden="true" /> {loading ? 'Opening Spotify…' : 'Connect Spotify'}</button> : <p className="import-note" role="status">Loading Spotify…</p>}
  </section>;
}
