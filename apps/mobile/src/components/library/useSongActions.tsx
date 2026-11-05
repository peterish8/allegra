/**
 * Everything you can do to a library song from a long press: change or
 * remove its cover, swap the audio version, edit its title / artist, find
 * lyrics, share the file, hide it or delete it.
 *
 * Moved out of the old Home screen so the Library (the Downloads layout) has
 * the same powers. Call `open(song)` from a row's long press and render
 * `element` once in the screen.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useState } from 'react';
import { Signal } from '../../constants/allegraTheme';
import { CoverArtSearchScreen } from '../../screens/CoverArtSearchScreen';
import { canQueueNext, queueNext } from '../../services/player/queueNext';
import { useArtHistoryStore } from '../../store/artHistoryStore';
import { useLyricsScanQueueStore } from '../../store/lyricsScanQueueStore';
import { useSongsStore } from '../../store/songsStore';
import { Song } from '../../types/song';
import { ConfirmSheet } from '../../ui';
import * as Haptics from '../../utils/haptics';
import { songCanUpgradeToSyncedLyrics } from '../../utils/lyricsState';
import LibraryBottomSheet from '../LibraryBottomSheet';
import LibraryEditModal from '../LibraryEditModal';
import { SongVersionSearchModal } from '../SongVersionSearchModal';
import { Toast } from '../Toast';

export interface SongActionExtras {
  /** Opened from a playlist: offer "Remove from this playlist". */
  onRemoveFromPlaylist?: () => void;
}

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

export const useSongActions = () => {
  const updateSong = useSongsStore(s => s.updateSong);
  const fetchSongs = useSongsStore(s => s.fetchSongs);
  const deleteSong = useSongsStore(s => s.deleteSong);
  const hideSong = useSongsStore(s => s.hideSong);
  const recentArts = useArtHistoryStore(s => s.recentArts);
  const addRecentArt = useArtHistoryStore(s => s.addRecentArt);
  const addToScanQueue = useLyricsScanQueueStore(s => s.addToQueue);

  const [song, setSong] = useState<Song | null>(null);
  const [sheet, setSheet] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [coverSearch, setCoverSearch] = useState(false);
  const [versions, setVersions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [toast, setToast] = useState<ToastState>(null);
  const [extras, setExtras] = useState<SongActionExtras>({});

  /** The long press (TactileRow already ticked). `extras` adds what only the caller can do (remove from its playlist). */
  const open = useCallback((s: Song, more: SongActionExtras = {}) => {
    setSong(s);
    setExtras(more);
    setSheet(true);
  }, []);

  /** Queue a lyrics search (or a retry for synced lyrics) for a song. */
  const findLyrics = useCallback((s: Song) => {
    const existing = useLyricsScanQueueStore.getState().queue[s.id];
    const plain = (existing?.status === 'completed' && existing?.resultType === 'plain') || (!existing && songCanUpgradeToSyncedLyrics(s));
    if (existing && existing.status !== 'failed' && !plain) {
      setToast({ message: `Already searching for "${s.title}"`, type: 'info' });
      return;
    }
    addToScanQueue(s, plain);
    Haptics.success();
    setToast({ message: plain ? `Looking for synced lyrics: "${s.title}"` : `Searching lyrics for "${s.title}"`, type: 'success' });
  }, [addToScanQueue]);

  const setCover = useCallback(async (uri: string | undefined, message?: string) => {
    if (!song) return;
    try {
      await updateSong({ ...song, coverImageUri: uri, dateModified: new Date().toISOString() });
      if (uri) addRecentArt(uri);
      await fetchSongs();
      if (message) setToast({ message, type: 'success' });
    } catch {
      setToast({ message: 'Could not save the cover', type: 'error' });
    }
  }, [song, updateSong, addRecentArt, fetchSongs]);

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (!result.canceled && result.assets[0]?.uri) {
        setSheet(false);
        await setCover(result.assets[0].uri);
      }
    } catch {
      setToast({ message: 'Could not save the cover', type: 'error' });
    }
  }, [setCover]);

  const share = useCallback(async () => {
    if (!song?.audioUri) {
      setToast({ message: 'No audio file to share', type: 'error' });
      return;
    }
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setToast({ message: 'Sharing is not available on this device', type: 'error' });
        return;
      }
      setSheet(false);
      let uri = song.audioUri;
      if (uri.startsWith('content://')) {
        const temp = `${FileSystem.cacheDirectory}share_${Date.now()}.${uri.includes('m4a') ? 'm4a' : 'mp3'}`;
        await FileSystem.copyAsync({ from: uri, to: temp }).then(() => { uri = temp; }).catch(() => {});
      }
      await Sharing.shareAsync(uri, { dialogTitle: `Share "${song.title}"`, mimeType: 'audio/mpeg', UTI: 'public.audio' });
    } catch {
      setToast({ message: 'Could not share the song', type: 'error' });
    }
  }, [song]);

  const later = (fn: () => void) => { setSheet(false); setTimeout(fn, 300); };

  const element = (
    <>
      <LibraryBottomSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        selectedSong={song}
        onPlayNext={song && canQueueNext(song) ? () => {
          setSheet(false);
          if (queueNext(song)) {
            Haptics.success();
            setToast({ message: 'Playing next', type: 'success' });
          }
        } : undefined}
        onFindLyrics={() => { setSheet(false); if (song) findLyrics(song); }}
        onRemoveFromPlaylist={extras.onRemoveFromPlaylist ? () => { setSheet(false); extras.onRemoveFromPlaylist?.(); } : undefined}
        onShare={share}
        onOpenVersionSearch={() => later(() => setVersions(true))}
        onPickImage={pickImage}
        onOpenCoverSearch={() => { setSheet(false); setCoverSearch(true); }}
        recentArts={recentArts}
        onSelectRecentArt={uri => { setSheet(false); setCover(uri); }}
        onRemoveCover={() => { setSheet(false); setCover(undefined, 'Cover removed'); }}
        onHideSong={async () => {
          setSheet(false);
          if (!song) return;
          try {
            await hideSong(song.id, true);
            setToast({ message: 'Hidden from your library', type: 'success' });
          } catch {
            setToast({ message: 'Could not hide the song', type: 'error' });
          }
        }}
        onEditInfo={() => later(() => { setEditTitle(song?.title ?? ''); setEditArtist(song?.artist ?? ''); setEditing(true); })}
        onDelete={() => later(() => setConfirmDelete(true))}
      />
      <ConfirmSheet
        visible={confirmDelete}
        title={`Delete “${song?.title ?? ''}”?`}
        body="The file is removed from this phone. This can’t be undone."
        confirmLabel="Delete song"
        destructive
        onConfirm={async () => {
          if (!song) return;
          try {
            await deleteSong(song.id);
            setConfirmDelete(false);
            setToast({ message: 'Song deleted', type: 'success' });
          } catch {
            setToast({ message: 'Could not delete the song', type: 'error' });
          }
        }}
        onClose={() => setConfirmDelete(false)}
      />
      <SongVersionSearchModal
        visible={versions}
        targetSong={song}
        onClose={() => setVersions(false)}
        onSuccess={() => { fetchSongs(); setToast({ message: 'Song updated', type: 'success' }); }}
      />
      <CoverArtSearchScreen
        visible={coverSearch}
        initialQuery={song ? `${song.title} ${song.artist ?? ''}` : ''}
        onClose={() => setCoverSearch(false)}
        onSelect={uri => { setCoverSearch(false); setCover(uri, 'Cover updated'); }}
      />
      <LibraryEditModal
        visible={editing}
        onClose={() => setEditing(false)}
        title={editTitle}
        onTitleChange={setEditTitle}
        artist={editArtist}
        onArtistChange={setEditArtist}
        onSave={async () => {
          if (!song || !editTitle.trim()) return;
          try {
            await updateSong({ ...song, title: editTitle.trim(), artist: editArtist.trim(), dateModified: new Date().toISOString() });
            await fetchSongs();
            setEditing(false);
            setToast({ message: 'Song info updated', type: 'success' });
          } catch {
            setToast({ message: 'Could not update the song', type: 'error' });
          }
        }}
        primaryColor={Signal.wave}
      />
      {toast ? <Toast visible message={toast.message} type={toast.type} onDismiss={() => setToast(null)} /> : null}
    </>
  );

  return { open, findLyrics, element };
};
