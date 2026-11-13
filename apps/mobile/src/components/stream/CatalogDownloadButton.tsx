/**
 * The Download control on a catalog album or mix page (artist albums, Made for you, search, Now Playing's album link).
 * It stands for the whole list and tells the truth from the same queue the song rows read:
 *
 *   idle         arrow, tap to save every song
 *   partial      arrow, tap to save the songs that are still missing
 *   queued       a clock while the songs wait for a slot
 *   downloading  a ring that fills with the album's real progress
 *   paused       the ring stays where it stopped
 *   saved        a tick, only once every song is on the phone
 *   failed       retry, which restarts only the failed songs
 *
 * Only pages for catalog lists mount it. A user's own playlist never does (it has its own download), and nothing here
 * downloads from a partial list: the button waits until the album has fully loaded.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { Signal } from '../../constants/allegraTheme';
import { startCatalogAlbumDownload } from '../../services/stream/albumDownload';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { useQueueShape } from '../../store/downloadQueueSelectors';
import { useSongsStore } from '../../store/songsStore';
import type { UnifiedSong } from '../../types/song';
import { IconButton } from '../../ui';
import { albumDownloadState, albumPercent, type AlbumDownloadPhase, type AlbumDownloadState } from '../../utils/catalogAlbumDownload';
import { libraryKeys } from '../../utils/downloadState';
import * as Haptics from '../../utils/haptics';

const SIZE = 24;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
/** The ring's empty track: the quiet ink at low opacity. */
const TRACK_OPACITY = 0.4;

/** Live state of an album's download. Re-renders only when the queue's shape or the whole percent moves. */
export function useAlbumDownload(songs: readonly UnifiedSong[], ready: boolean): AlbumDownloadState {
  const shape = useQueueShape();
  const library = useSongsStore(s => s.songs);
  const percent = useDownloadQueueStore(s => albumPercent(songs, s.queue, libraryKeys(library)));
  return useMemo(
    () => albumDownloadState(songs, useDownloadQueueStore.getState().queue, libraryKeys(library), ready),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [songs, library, ready, shape, percent],
  );
}

export const albumDownloadLabel = (state: AlbumDownloadState): string => {
  const pct = Math.round(state.progress * 100);
  const songsWord = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;
  const labels: Record<AlbumDownloadPhase, string> = {
    unavailable: 'Download album, available once the songs have loaded',
    idle: 'Download album',
    partial: `Download the ${songsWord(state.missing.length)} not saved yet`,
    queued: 'Album waiting to download',
    downloading: `Downloading album, ${pct} percent`,
    paused: `Album download paused, ${pct} percent`,
    saved: 'Album downloaded',
    failed: `${songsWord(state.failed.length)} failed to download, retry`,
  };
  return labels[state.phase];
};

const Glyph: React.FC<{ state: AlbumDownloadState }> = ({ state }) => {
  switch (state.phase) {
    case 'queued':
      return <Ionicons name="time-outline" size={SIZE} color={Signal.wave} />;
    case 'downloading':
    case 'paused':
      return (
        <Svg width={SIZE} height={SIZE} style={styles.ring}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={Signal.inkFaint} strokeOpacity={TRACK_OPACITY} strokeWidth={STROKE} fill="none" />
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={Signal.wave} strokeWidth={STROKE} strokeLinecap="round" fill="none"
            strokeDasharray={C} strokeDashoffset={C * (1 - state.progress)} />
        </Svg>
      );
    case 'saved':
      return <Ionicons name="checkmark-circle" size={SIZE} color={Signal.wave} />;
    case 'failed':
      return <Ionicons name="refresh" size={SIZE} color={Signal.wave} />;
    default:
      return <Ionicons name="arrow-down-circle-outline" size={SIZE} color={Signal.wave} />;
  }
};

export const CatalogDownloadButton: React.FC<{ songs: readonly UnifiedSong[]; ready: boolean }> = ({ songs, ready }) => {
  const state = useAlbumDownload(songs, ready);
  const press = () => {
    if (state.phase === 'idle' || state.phase === 'partial' || state.phase === 'failed') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      startCatalogAlbumDownload(songs, ready);
    } else {
      Haptics.selectionAsync().catch(() => {});
    }
  };
  return (
    <IconButton icon="arrow-down-circle-outline" label={albumDownloadLabel(state)} onPress={press} disabled={state.phase === 'unavailable'}>
      <View style={styles.box}><Glyph state={state} /></View>
    </IconButton>
  );
};

const styles = StyleSheet.create({
  box: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  // Start the ring at 12 o'clock.
  ring: { transform: [{ rotate: '-90deg' }] },
});

export default CatalogDownloadButton;
