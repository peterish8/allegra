import React, { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_HEIGHT } from '../../constants/layout';
import { openPlayerSheet } from '../../navigation/playerSheet';
import { PILL_STACK_GAP, pillBarTop } from '../../navigation/tabs';
import { durationSV, positionSV } from '../../playback/positionBus';
import { useConnect } from '../../services/connect/ConnectProvider';
import { useSnapshotCover } from '../../services/connect/useSnapshotCover';
import { usePlayerStore } from '../../store/playerStore';
import { useSettingsStore } from '../../store/settingsStore';
import PillPlayer from '../PillPlayer';
import { MiniSongMenu } from '../player/MiniSongMenu';
import { toStreamSong } from '../../services/stream/streamSong';
import { parseSongRef } from '@shared/songRef';

export const ConnectMiniPlayer: React.FC = () => {
  const connect = useConnect();
  const [menuOpen, setMenuOpen] = useState(false);
  const control = connect.control;
  const insets = useSafeAreaInsets();
  const navBarStyle = useSettingsStore(state => state.navBarStyle);
  const hideMiniPlayer = usePlayerStore(state => state.hideMiniPlayer);
  const hiddenOnlyBySheet = usePlayerStore(state =>
    state.miniPlayerHiddenSources.size === 1 && state.miniPlayerHiddenSources.has('NowPlaying'));
  const view = connect.view;
  const song = view?.song;
  const cover = useSnapshotCover(song);
  // A song picked here is being looked up for the device that plays: show it on its way.
  const pending = connect.pendingPick;

  useEffect(() => {
    if (!connect.remotePlayback || !view?.song) return;
    positionSV.value = view.livePosition;
    durationSV.value = view.song.duration;
  }, [connect.remotePlayback, view?.song, view?.livePosition]);

  const open = useCallback(() => {
    if (song) openPlayerSheet(song.ref);
  }, [song]);
  const toggle = useCallback(() => {
    control({ kind: view?.isPlaying ? 'pause' : 'play' });
  }, [control, view?.isPlaying]);
  const next = useCallback(() => control({ kind: 'next' }), [control]);
  const previous = useCallback(() => control({ kind: 'prev' }), [control]);

  const pillNav = navBarStyle === 'modern-pill';
  const bottom = pillNav ? pillBarTop(insets.bottom) + PILL_STACK_GAP : TAB_BAR_HEIGHT + insets.bottom;
  if (!connect.remotePlayback || !song || (hideMiniPlayer && !(pillNav && hiddenOnlyBySheet))) return null;

  return (
    <>
    <PillPlayer
      remote
      title={pending ? pending.title : song.title}
      artist={pending ? `Sending to ${pending.deviceName}…` : song.artist}
      coverImageUri={pending ? undefined : cover || undefined}
      playing={view.isPlaying}
      bottom={bottom}
      sheetUp={hiddenOnlyBySheet}
      onOpen={open}
      onTogglePlay={toggle}
      onNext={next}
      onPrevious={previous}
      onMore={() => setMenuOpen(true)}
    />
    <MiniSongMenu key={song.ref} remote={song} visible={menuOpen} onClose={() => setMenuOpen(false)} song={toStreamSong({
      id: parseSongRef(song.ref)?.id ?? song.ref,
      source: parseSongRef(song.ref)?.source === 'gaana' ? 'Gaana' : 'Saavn',
      downloadUrl: '',
      title: song.title, artist: song.artist, highResArt: cover || '', duration: song.duration,
    })} />
    </>
  );
};

export default ConnectMiniPlayer;
