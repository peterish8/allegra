import { ArrowUp, ChevronDown, Info, Shuffle, Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import type { UnifiedSong } from '@shared/types';

import { TactileButton } from '../ui';
import { DjSelect } from './DjSelect';

export interface MixablePlaylist {
  readonly id: string;
  readonly name: string;
  readonly songIds: readonly string[];
  readonly songs: readonly UnifiedSong[];
  /** Every song in the playlist has loaded. */
  readonly tracksReady: boolean;
}

export interface DjPlaylistMixProps {
  readonly playlists: readonly MixablePlaylist[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly working: boolean;
  readonly onRetry: () => void;
  readonly onOpenLibrary: () => void;
  /** Resolves true once the DJ took the request (the vibe field then clears). */
  readonly onMix: (sources: readonly { readonly name: string; readonly songs: readonly UnifiedSong[] }[], vibe: string) => Promise<boolean>;
}

const NONE = '';

/**
 * Two of the listener's playlists and a vibe, blended by the DJ into one set. Folded to a single
 * button; opened, one line: two searchable pickers, the vibe and the button. What it does is behind
 * the (i), not spelled out on the page: the wall of cards it replaced read as clutter (2026-10-12).
 */
export function DjPlaylistMix({ playlists, loading, error, working, onRetry, onOpenLibrary, onMix }: DjPlaylistMixProps) {
  // Folded to one button until it is wanted: the stage and the queue are the page (2026-10-12).
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const [first, setFirst] = useState<string>(NONE);
  const [second, setSecond] = useState<string>(NONE);
  const [vibe, setVibe] = useState('');

  // A playlist deleted elsewhere leaves its picker.
  useEffect(() => {
    const ids = new Set(playlists.map((playlist) => playlist.id));
    if (first !== NONE && !ids.has(first)) setFirst(NONE);
    if (second !== NONE && !ids.has(second)) setSecond(NONE);
  }, [playlists, first, second]);

  const usable = playlists.filter((playlist) => playlist.songIds.length > 0);
  const optionsFor = (other: string) => usable
    .filter((playlist) => playlist.id !== other)
    .map((playlist) => ({ value: playlist.id, label: playlist.name, note: `${playlist.songIds.length} ${playlist.songIds.length === 1 ? 'song' : 'songs'}` }));
  const picked = [first, second].map((id) => playlists.find((playlist) => playlist.id === id)).filter((playlist): playlist is MixablePlaylist => Boolean(playlist));
  const loadingTracks = picked.some((playlist) => !playlist.tracksReady);
  const ready = picked.length === 2 && !loadingTracks && picked.every((playlist) => playlist.songs.length > 0) && vibe.trim().length > 0 && !working;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    if (await onMix(picked.map(({ name, songs }) => ({ name, songs })), vibe.trim())) setVibe('');
  };

  return (
    <section className={`dj-playlists${open ? ' is-open' : ''}`} aria-labelledby="dj-playlists-title">
      <div className="dj-playlists-head">
        <div className="dj-playlists-heading">
          <h2 id="dj-playlists-title">
            <button type="button" className="dj-mix-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
              <Shuffle size={15} aria-hidden="true" />
              <span>Mix two playlists</span>
              <ChevronDown size={15} aria-hidden="true" className="dj-mix-toggle__chevron" />
            </button>
          </h2>
          {open ? <MixInfo /> : null}
        </div>
        {open ? <button type="button" className="dj-library-link" onClick={onOpenLibrary}>Your library <ArrowUp size={14} aria-hidden="true" /></button> : null}
      </div>

      {!open ? null : <div id={bodyId} className="dj-mix-body">{loading ? <p className="dj-playlists-message" role="status">Loading your playlists…</p> : error ? (
        <div className="dj-playlists-empty" role="alert"><p>{error}</p><button type="button" className="dj-library-link" onClick={onRetry}>Try again</button></div>
      ) : usable.length < 2 ? (
        <p className="dj-playlists-message">Save two playlists with songs in Your library and you can mix them here.</p>
      ) : (
        <form className="dj-mix" onSubmit={(event) => void submit(event)}>
          <DjSelect label="First playlist" value={first} options={optionsFor(second)} onChange={setFirst} placeholder="Choose a playlist" searchable searchPlaceholder="Search your playlists" />
          <DjSelect label="Second playlist" value={second} options={optionsFor(first)} onChange={setSecond} placeholder="Choose a playlist" searchable searchPlaceholder="Search your playlists" />
          <label className="dj-mix__vibe">
            <span>Vibe</span>
            <input value={vibe} maxLength={160} onChange={(event) => setVibe(event.target.value)} placeholder="Late-night, warm…" />
          </label>
          <TactileButton type="submit" variant="primary" icon={Sparkles} className="dj-mix__go" disabled={!ready}>
            {working ? 'Mixing…' : loadingTracks ? 'Loading songs…' : 'Mix'}
          </TactileButton>
        </form>
      )}</div>}
    </section>
  );
}

/** The (i): what mixing does, on demand. Escape or a tap outside closes it. */
function MixInfo() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="dj-mix-info" ref={rootRef}>
      <button ref={buttonRef} type="button" className="dj-mix-info__button" aria-label="What mixing two playlists does" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <Info size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} className="dj-mix-info__pop" role="note">
          <p>Pick two of your playlists and say the vibe you want, like “late-night drive”.</p>
          <p>Your DJ starts from songs in both and builds one set that moves between them, with a reason for each pick. Nothing is saved; keep the set with Save as playlist if you like it.</p>
        </div>
      ) : null}
    </div>
  );
}
