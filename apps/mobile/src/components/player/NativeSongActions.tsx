/**
 * The round glass buttons at the end of Now Playing's title row (fullscreen lyrics · song options · like) drawn by a
 * Kotlin view (android/.../views/NativeSongActionsView.kt). The view only reports which button was used;
 * `NowPlayingControls` runs the same handlers as for its React Native buttons, which stay as the fallback
 * (`nativeSongActionsAvailable()`), and for Connect's remote player.
 *
 * The view is `slop` dp larger than the cluster on every side (the buttons' hit slop lies inside its bounds); the
 * negative margins keep the layout around it unchanged. Android hands a child only the touches inside every parent's
 * bounds, so the caller makes sure the parents reach `slop` beyond the cluster (see `NowPlayingControls`).
 */
import React, { useCallback } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import {
  SONG_ACTION_SIZE,
  songActionCount,
  songActionOf,
  songActionsWidth,
  type SongAction,
} from './nativeSongActionsProps';

interface NativeSongActionsViewProps {
  fullscreen: 'none' | 'enter' | 'exit';
  hasMore: boolean;
  liked: boolean;
  saving: boolean;
  slop: number;
  likeLabel: string;
  reduceMotion: boolean;
  onAction: (event: { nativeEvent: { action: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeSongActionsViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeSongActionsViewProps>('NativeSongActions');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeSongActionsAvailable = (): boolean => NativeView !== null;

interface NativeSongActionsProps {
  /** The fullscreen button: opens the lyrics-only view ('enter'), leaves it ('exit'), or is not shown ('none'). */
  fullscreen: 'none' | 'enter' | 'exit';
  hasMore: boolean;
  liked: boolean;
  /** A streamed song is saving into Liked songs: the heart breathes. */
  saving: boolean;
  likeLabel: string;
  /** `hitSlop` of the buttons in dp (8 in the title row, 6 in the fullscreen header). */
  slop: number;
  reduceMotion: boolean;
  onAction: (action: SongAction) => void;
}

const NativeSongActions: React.FC<NativeSongActionsProps> = ({ onAction, slop, ...rest }) => {
  const onEvent = useCallback((event: { nativeEvent: { action: string } }) => {
    const action = songActionOf(event);
    if (action) onAction(action);
  }, [onAction]);
  if (!NativeView) return null;
  const count = songActionCount(rest.fullscreen !== 'none', rest.hasMore);
  return (
    <NativeView
      {...rest}
      slop={slop}
      style={[styles.view, { width: songActionsWidth(count) + 2 * slop, height: SONG_ACTION_SIZE + 2 * slop, margin: -slop }]}
      onAction={onEvent}
    />
  );
};

const styles = StyleSheet.create({
  view: { flexGrow: 0, flexShrink: 0 },
});

export default React.memo(NativeSongActions);
