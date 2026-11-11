import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import {
  fetchQuickPicksPreview,
  fetchQuickPicksPreviewProfiles,
  type QuickPicksPreview,
  type QuickPicksPreviewModel,
  type QuickPicksPreviewProfile
} from '../lib/api';

/** A labelled public playlist used when the URL names none (Tamil Hip Hop from the JioSaavn benchmark). */
const DEFAULT_PROFILE = '1566837';

interface QuickPicksPreviewPageProps {
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly onPlay: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onToggle: () => void;
}

/**
 * Development-only side-by-side of today's Quick Picks and the LightFM blend for a public
 * benchmark playlist. Both columns come from the same candidate pool on the API.
 */
export function QuickPicksPreviewPage({ currentSongId, isPlaying, onPlay, onToggle }: QuickPicksPreviewPageProps) {
  const [profiles, setProfiles] = useState<QuickPicksPreviewProfile[]>([]);
  const [modelInfo, setModelInfo] = useState<QuickPicksPreviewModel | null>(null);
  const [selected, setSelected] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get('profile'); } catch { return null; }
  });
  const [preview, setPreview] = useState<QuickPicksPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchQuickPicksPreviewProfiles(controller.signal)
      .then((data) => {
        setProfiles(data.profiles);
        setModelInfo(data.model);
        setSelected((current) => current ?? (data.profiles.some((row) => row.id === DEFAULT_PROFILE) ? DEFAULT_PROFILE : data.profiles[0]?.id ?? null));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The preview is not available.');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('profile', selected);
      window.history.replaceState(window.history.state, '', url);
    } catch { /* the address bar just won't remember the profile */ }
    fetchQuickPicksPreview(selected, controller.signal)
      .then(setPreview)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setPreview(null);
        setError(reason instanceof Error ? reason.message : 'The preview could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  const ranks = useMemo(() => new Map(preview?.candidates.map((row) => [row.id, row]) ?? []), [preview]);
  /** Shelf position in the current column, so the arrows describe what the listener sees. */
  const currentPlace = useMemo(() => new Map(preview?.current.map((song, index) => [song.id, index]) ?? []), [preview]);
  const status = preview?.model ?? modelInfo;

  const play = (song: UnifiedSong, column: UnifiedSong[]): void => {
    if (song.id === currentSongId) onToggle();
    else onPlay(song, column);
  };

  const column = (title: string, note: string, songs: UnifiedSong[], lightfm: boolean) => (
    <section className="picks-preview__column" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <p>{note}</p>
      </header>
      <ol>
        {songs.map((song, index) => {
          const current = song.id === currentSongId;
          const row = ranks.get(song.id);
          const before = currentPlace.get(song.id);
          const move = before === undefined ? 0 : before - index;
          return (
            <li key={song.id} className={current ? 'is-current' : undefined}>
              <button type="button" onClick={() => play(song, songs)} aria-label={`${current && isPlaying ? 'Pause' : 'Play'} ${song.title}`}>
                <span className="picks-preview__rank">{index + 1}</span>
                {song.artwork ? <img src={song.artwork} alt="" loading="lazy" /> : <span className="picks-preview__art" aria-hidden="true" />}
                <span className="picks-preview__copy">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </span>
                {lightfm ? (
                  <span className="picks-preview__meta">
                    {before === undefined ? <em>new</em> : move > 0 ? <em>↑{move}</em> : move < 0 ? <em className="is-down">↓{-move}</em> : null}
                    <span>{row?.score == null ? 'no vector' : row.score.toFixed(2)}</span>
                  </span>
                ) : null}
                <span className="picks-preview__play" aria-hidden="true">{current && isPlaying ? <Pause size={15} /> : <Play size={15} />}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );

  return (
    <div className="picks-preview">
      <div className="picks-preview__intro">
        <span className="picks-preview__badge">Local preview · not live</span>
        <h1>Quick Picks: current vs LightFM</h1>
        <p>
          Each profile is a public JioSaavn playlist from the offline benchmark, not an Allegra account. Its visible tracks
          seed today&apos;s recommender. Both columns rank the same candidates with the same language filter, exclusions and
          two-per-artist cap.
        </p>
        <label className="picks-preview__select">
          <span>Playlist profile</span>
          <select value={selected ?? ''} onChange={(event) => setSelected(event.target.value)} disabled={profiles.length === 0}>
            {profiles.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title} · {row.language}{row.hasVector ? '' : ' · no vector'}
              </option>
            ))}
          </select>
        </label>
        {status ? (
          <p className="picks-preview__status" data-status={status.status}>
            {status.status === 'ready'
              ? `LightFM model seed ${status.seed ?? '?'}, snapshot ${status.collectedAt?.slice(0, 10) ?? 'unknown'}.`
              : status.status === 'no-profile-vector'
                ? 'This profile has no LightFM vector, so the right column falls back to the current order.'
                : `Model unavailable (${status.detail ?? 'unknown reason'}). The right column falls back to the current order.`}
            {preview ? ` ${preview.coverage.withVectors} of ${preview.coverage.candidates} candidates have vectors.` : ''}
          </p>
        ) : null}
      </div>
      {error ? <p className="picks-preview__error" role="alert">{error}</p> : null}
      {loading && !preview ? <p className="picks-preview__status">Asking the catalog for candidates…</p> : null}
      {preview ? (
        <>
          <div className="picks-preview__columns" aria-busy={loading}>
            {column('Current Quick Picks', preview.reasoning, preview.current, false)}
            {column('LightFM blend', 'Reciprocal-rank blend of today’s order and the playlist’s LightFM scores', preview.lightfm, true)}
          </div>
          <details className="picks-preview__pool">
            <summary>All {preview.candidates.length} candidates after exclusions</summary>
            <table>
              <thead><tr><th>Current</th><th>LightFM</th><th>Score</th><th>Song</th></tr></thead>
              <tbody>
                {preview.candidates.map((row) => (
                  <tr key={row.id}>
                    <td>{row.currentRank}</td>
                    <td>{row.lightfmRank}</td>
                    <td>{row.score == null ? '—' : row.score.toFixed(3)}</td>
                    <td>{row.title} · {row.artist}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : null}
    </div>
  );
}
