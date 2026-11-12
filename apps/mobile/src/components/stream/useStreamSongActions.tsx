/**
 * The long press on a catalog song (Stream shelves, search results, mixes): the one song actions sheet, the same
 * the mini player opens (owner, 2026-11-13: "combine … show it to this quick picks also"). Long press means
 * "actions" everywhere in the app (DESIGN.md §7a).
 *
 *   const actions = useStreamSongActions({ onDone: setToast });
 *   <ShelfRow onLongPress={song => actions.open(song)} />   …   {actions.element}
 */
import React, { useCallback, useState } from 'react';
import { MiniSongMenu } from '../player/MiniSongMenu';
import { StreamService } from '../../services/stream/StreamService';
import { toStreamSong } from '../../services/stream/streamSong';
import { usePlayerStore } from '../../store/playerStore';
import type { UnifiedSong } from '../../types/song';

export const useStreamSongActions = (_opts: { onDone?: (message: string) => void } = {}) => {
  const [song, setSong] = useState<UnifiedSong | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback((s: UnifiedSong) => {
    // Known to StreamService, so like, download and share work on its stream id like on the playing song.
    StreamService.register([s]);
    setSong(s);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const item = song ? toStreamSong(song) : null;
  const element = item && song ? (
    <MiniSongMenu key={item.id} song={item} catalog={song} visible={open} onClose={close}
      current={usePlayerStore.getState().currentSongId === item.id} />
  ) : null;

  return { open: show, element };
};
