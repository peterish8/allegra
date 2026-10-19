import { Check, ListEnd, ListPlus, ListStart, Plus, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';

import type { UnifiedSong } from '@shared/types';

import { useFocusTrap } from '../hooks/useFocusTrap';
import { usePlaylistsContext } from '../hooks/usePlaylists';
import { useQueueActions } from '../hooks/useQueueActions';
import { motionTokens } from '../motion';
import { IconButton, TactileButton } from './ui';

/**
 * A button that opens a small sheet for one song: queue it (next, or at the end) on the device
 * that is playing, or save it into playlists. It is a centred sheet rather than a popover so no
 * list row or scroll container can clip it.
 */
export function PlaylistMenu({ song }: { readonly song: UnifiedSong }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { playlists, actionError, contains, create, toggleSong } = usePlaylistsContext();
  const queue = useQueueActions();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    // Capture phase, so Escape closes only this sheet and not the player behind it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Runs after the effect above, so the close-button autofocus already happened by
  // the time this checks for it; it only adds the Tab cycle and focus-restore-on-close.
  useFocusTrap(open, sheetRef);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const library = await create(name);
    if (library) {
      setName('');
      await toggleSong(library.id, song);
    }
    setBusy(false);
  };

  return (
    <>
      <IconButton icon={ListPlus} label={queue ? `Add ${song.title} to the queue or a playlist` : `Save ${song.title} to a playlist`} onClick={() => setOpen(true)} />
      {typeof document === 'undefined' ? null : createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              key="playlist-sheet-backdrop"
              className="sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: reduced ? motionTokens.duration.instant : motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
              transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base, ease: motionTokens.ease.decelerate }}
              onClick={() => setOpen(false)}
            >
          <motion.div
            ref={sheetRef}
            className="playlist-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced
              ? { opacity: 0, transition: { duration: motionTokens.duration.instant } }
              : { opacity: 0, y: 10, scale: 0.99, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
            transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base, ease: motionTokens.ease.decelerate }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="playlist-sheet-head">
              <div>
                <h2 id={titleId}>{queue ? 'Add to queue or playlist' : 'Save to playlist'}</h2>
                <p title={song.title}>{song.title}</p>
              </div>
              <button ref={closeRef} type="button" className="icon-button" aria-label="Close" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
            </div>
            {queue ? (
              <div className="playlist-queue-actions">
                <TactileButton icon={ListStart} onClick={() => { queue.add(song, true); setOpen(false); }}>Play next</TactileButton>
                <TactileButton icon={ListEnd} onClick={() => { queue.add(song, false); setOpen(false); }}>Add to queue</TactileButton>
              </div>
            ) : null}
            {playlists.length > 0 ? (
              <ul className="playlist-choices">
                {playlists.map((playlist) => {
                    const included = contains(playlist.id, song);
                  return (
                    <li key={playlist.id}>
                      <button type="button" role="checkbox" aria-checked={included} className={`playlist-choice ${included ? 'is-included' : ''}`} onClick={() => void toggleSong(playlist.id, song)}>
                        <span className="playlist-check" aria-hidden="true">{included ? <Check size={14} /> : null}</span>
                        <span className="playlist-choice-name">{playlist.name}</span>
                        <span className="playlist-choice-count">{playlist.songIds.length}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="playlist-empty">No playlists yet. Name your first one below.</p>}
            <form className="playlist-new" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor={`${titleId}-name`}>New playlist name</label>
              <input id={`${titleId}-name`} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="New playlist name" autoComplete="off" />
              <TactileButton type="submit" variant="primary" icon={Plus} disabled={busy || !name.trim()}>Create and add</TactileButton>
            </form>
            {actionError ? <p className="playlist-error" role="alert">{actionError}</p> : null}
          </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
