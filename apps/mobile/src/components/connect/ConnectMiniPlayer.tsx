import React, { useCallback, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PillPlayer from '../PillPlayer';
import { useConnect } from '../../services/connect/ConnectProvider';
import { openPlayerSheet } from '../../navigation/playerSheet';
import { usePlayerStore } from '../../store/playerStore';
import { useSettingsStore } from '../../store/settingsStore';
import { positionSV, durationSV } from '../../playback/positionBus';
import { pillBarTop, PILL_STACK_GAP } from '../../navigation/tabs';
import { TAB_BAR_HEIGHT } from '../../constants/layout';

export const ConnectMiniPlayer: React.FC = () => {
  const connect = useConnect();
  const control = connect.control;
  const insets = useSafeAreaInsets();
  const navBarStyle = useSettingsStore(state => state.navBarStyle);
  const hideMiniPlayer = usePlayerStore(state => state.hideMiniPlayer);
  const hiddenOnlyBySheet = usePlayerStore(state =>
    state.miniPlayerHiddenSources.size === 1 && state.miniPlayerHiddenSources.has('NowPlaying'));
  const view = connect.view;
  const song = view?.song;

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
    <PillPlayer
      title={song.title}
      artist={song.artist}
      coverImageUri={song.artwork}
      playing={view.isPlaying}
      bottom={bottom}
      sheetUp={hiddenOnlyBySheet}
      onOpen={open}
      onTogglePlay={toggle}
      onNext={next}
      onPrevious={previous}
    />
  );
};

export default ConnectMiniPlayer;
