import { ListPlus, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { UnifiedSong } from '@shared/types';

import { useFocusTrap } from '../hooks/useFocusTrap';
import { usePlaylistsContext } from '../hooks/usePlaylists';
import { savePlaylistWithSongs } from '../lib/savePlaylist';
import { TactileButton } from './ui';

interface SavePlaylistButtonProps {
  readonly songs: readonly UnifiedSong[];
  readonly defaultName: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Saves a complete ordered album or queue into the same persistent playlists as the library. */
export function SavePlaylistButton({ songs, defaultName, disabled = false, className = '' }: SavePlaylistButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const { create, addSongs, remove } = usePlaylistsContext();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  useFocusTrap(open, sheetRef);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved('');
    const result = await savePlaylistWithSongs(name, songs, { create, addSongs, remove });
    if (result.ok) {
      setSaved(`Saved ${songs.length} ${songs.length === 1 ? 'song' : 'songs'} to “${result.playlist.name}”.`);
      setOpen(false);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  return (
    <>
      <TactileButton
        variant="secondary"
        icon={ListPlus}
        className={className}
        disabled={disabled || songs.length === 0}
        onClick={() => { setName(defaultName); setError(''); setSaved(''); setOpen(true); }}
      >
        Save as playlist
      </TactileButton>
      {saved ? <span className="save-playlist-status" role="status">{saved}</span> : null}
      {open ? (
        <div className="sheet-backdrop" onClick={() => { if (!busy) setOpen(false); }}>
          <div ref={sheetRef} className="playlist-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
            <div className="playlist-sheet-head">
              <div>
                <h2 id={titleId}>Save as playlist</h2>
                <p>{songs.length} {songs.length === 1 ? 'song' : 'songs'} will be saved in order.</p>
              </div>
              <button ref={closeRef} type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
            </div>
            <form className="playlist-new" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor={`${titleId}-name`}>Playlist name</label>
              <input id={`${titleId}-name`} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Playlist name" autoComplete="off" />
              <TactileButton type="submit" variant="primary" icon={Plus} disabled={busy || !name.trim() || songs.length === 0}>{busy ? 'Saving…' : 'Save playlist'}</TactileButton>
            </form>
            {error ? <p className="playlist-error" role="alert">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
