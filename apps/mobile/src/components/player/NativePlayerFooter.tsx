/**
 * Now Playing's bottom row (queue · output / sleep timer · lyrics) drawn by a Kotlin view
 * (android/.../views/NativePlayerFooterView.kt). The view only reports which control was used; `NowPlayingControls`
 * runs the same handlers as for its React Native row, which stays as the fallback (`nativePlayerFooterAvailable()`).
 *
 * The view is 10 dp larger than the row on every side, so the buttons' hit slop lies inside its bounds.
 */
import React, { useCallback } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { footerActionOf, type FooterAction } from './nativeFooterProps';

interface NativePlayerFooterViewProps {
  hasTimer: boolean;
  sleepLabel: string;
  outputDevices: boolean;
  outputActive: boolean;
  showLyrics: boolean;
  lyricsLongPress: boolean;
  waveColor: string;
  reduceMotion: boolean;
  onAction: (event: { nativeEvent: { action: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativePlayerFooterViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativePlayerFooterViewProps>('NativePlayerFooter');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativePlayerFooterAvailable = (): boolean => NativeView !== null;

/** The row's height and the hit slop the view carries around it, in dp (FooterGeometry.ROW_H / SLOP). */
const ROW_H = 44;
const SLOP = 10;

interface NativePlayerFooterProps {
  hasTimer: boolean;
  sleepLabel: string;
  /** Connect's device picker replaces the phone's output switcher (the icon changes). */
  outputDevices: boolean;
  /** Playback is on another device: the device icon lights up. */
  outputActive: boolean;
  showLyrics: boolean;
  /** The lyrics button has a long press (the lyrics picker). */
  lyricsLongPress: boolean;
  waveColor: string;
  /** Reduce Motion: the press dims and never moves. */
  reduceMotion: boolean;
  onAction: (action: FooterAction) => void;
  style?: StyleProp<ViewStyle>;
}

const NativePlayerFooter: React.FC<NativePlayerFooterProps> = ({ onAction, style, ...rest }) => {
  const onEvent = useCallback((event: { nativeEvent: { action: string } }) => {
    const action = footerActionOf(event);
    if (action) onAction(action);
  }, [onAction]);
  if (!NativeView) return null;
  return <NativeView {...rest} style={[styles.view, style]} onAction={onEvent} />;
};

// The view is the row plus the buttons' hit slop on every side. The slop must lie inside the bounds of every parent
// (Android only hands a child the touches inside its parent), so the caller pads the parent by SLOP and pulls it back
// with an equal negative margin (`NATIVE_FOOTER_PARENT` in NowPlayingControls) and leaves SLOP of the row's own top margin.
const styles = StyleSheet.create({
  view: { height: ROW_H + 2 * SLOP, marginHorizontal: -SLOP },
});

export const NATIVE_FOOTER_SLOP = SLOP;

export default React.memo(NativePlayerFooter);
