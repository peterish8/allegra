/**
 * The long press on a catalog song (Stream shelves, search results): its actions sheet. Long press means
 * "actions" everywhere in the app (DESIGN.md §7a); it used to queue "Play next" silently here.
 *
 *   const actions = useStreamSongActions({ onDone: setToast });
 *   <ShelfRow onLongPress={song => actions.open(song)} />   …   {actions.element}
 */
import React, { useCallback, useState } from 'react';
import { navigationRef } from '../../utils/navigationService';
import { StreamService } from '../../services/stream/StreamService';
import type { UnifiedSong } from '../../types/song';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { useDownloadState } from '../../hooks/useDownloadState';
import { creditedArtists } from '@shared/identity';

const NO_SONG = { id: '', title: '' };
import { Haptics, identityMeta, Sheet, SheetDivider, SheetIdentity, SheetOption } from '../../ui';
import { formatTrackDuration } from './trackRowPayload';

export const useStreamSongActions = ({ onDone }: { onDone?: (message: string) => void } = {}) => {
  const [song, setSong] = useState<UnifiedSong | null>(null);
  const [open, setOpen] = useState(false);
  const addToDownloads = useDownloadQueueStore(s => s.addToQueue);

  const show = useCallback((s: UnifiedSong) => {
    setSong(s);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const element = (
    <StreamSongSheet
      song={song}
      visible={open}
      onClose={close}
      onPlayNext={s => { close(); StreamService.playNext(s); Haptics.success(); onDone?.('Playing next'); }}
      onSave={s => { close(); addToDownloads([s]); Haptics.success(); onDone?.(`Saving “${s.title}” to your library`); }}
      onArtist={name => {
        close();
        if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Artist', params: { name } } });
      }}
    />
  );

  return { open: show, element };
};

const StreamSongSheet: React.FC<{
  song: UnifiedSong | null;
  visible: boolean;
  onClose: () => void;
  onPlayNext: (song: UnifiedSong) => void;
  onSave: (song: UnifiedSong) => void;
  onArtist: (name: string) => void;
}> = ({ song, visible, onClose, onPlayNext, onSave, onArtist }) => {
  const download = useDownloadState(song ?? NO_SONG);
  if (!song) return null;
  const artist = creditedArtists(song.artist)[0];
  const saved = download.phase === 'saved';
  const saving = download.phase === 'queued' || download.phase === 'downloading';
  return (
    <Sheet visible={visible} onClose={onClose} tintUri={song.highResArt || song.thumbnail}>
      {/* Round 7 item 2: identity first, then the song's actions, then navigation. Tapping the row already plays it. */}
      <SheetIdentity title={song.title} meta={identityMeta('Song', song.artist, formatTrackDuration(song.duration))}
        artwork={{ uri: song.highResArt || song.thumbnail, title: song.title, artist: song.artist }} onClose={onClose} />
      <SheetOption label="Play next" icon="return-down-forward" onPress={() => onPlayNext(song)} />
      <SheetOption
        label={saved ? 'Saved to your library' : saving ? 'Saving to your library' : 'Save to library'}
        icon={saved ? 'checkmark-circle-outline' : 'arrow-down-circle-outline'}
        disabled={saved || saving}
        onPress={() => onSave(song)}
      />
      {artist ? <><SheetDivider /><SheetOption label={`Go to ${artist}`} icon="person-outline" chevron onPress={() => onArtist(artist)} /></> : null}
    </Sheet>
  );
};

