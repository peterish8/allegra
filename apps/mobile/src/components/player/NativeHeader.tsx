/**
 * Now Playing's header (the grabber and the "Listening together" / "Playing on" chips) drawn by a Kotlin view
 * (android/.../views/NativeHeaderView.kt). `NowPlayingHeader` keeps the container (its safe-area padding, its fade and
 * its pointer events) and its React Native grabber and chips as the fallback (`nativeHeaderAvailable()`); the view only
 * reports which control was used and `NowPlayingHeader` runs the same handlers.
 */
import React, { useCallback } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { HEADER_SLOP_V, headerActionOf, headerChipCount, headerHeight, headerPlayingKind, type HeaderAction } from './nativeHeaderProps';

interface NativeHeaderViewProps {
  /** Listeners in the room; -1 for no chip. */
  together: number;
  /** The playing device's name; '' for no chip. */
  playingOn: string;
  playingKind: 'web' | 'phone';
  waveColor: string;
  onAction: (event: { nativeEvent: { action: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeHeaderViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeHeaderViewProps>('NativeHeader');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeHeaderAvailable = (): boolean => NativeView !== null;

interface NativeHeaderProps {
  /** Listeners in the LuvLink room, or null when not in one. */
  together: number | null;
  playingOn: { readonly name: string; readonly kind: 'web' | 'android' | 'ios' } | null;
  waveColor: string;
  onAction: (action: HeaderAction) => void;
}

const NativeHeader: React.FC<NativeHeaderProps> = ({ together, playingOn, waveColor, onAction }) => {
  const onEvent = useCallback((event: { nativeEvent: { action: string } }) => {
    const action = headerActionOf(event);
    if (action) onAction(action);
  }, [onAction]);
  if (!NativeView) return null;
  return (
    <NativeView
      style={[styles.view, { height: headerHeight(headerChipCount(together, playingOn?.name)) }]}
      together={together ?? -1}
      playingOn={playingOn?.name ?? ''}
      playingKind={headerPlayingKind(playingOn?.kind)}
      waveColor={waveColor}
      onAction={onEvent}
    />
  );
};

const styles = StyleSheet.create({
  // The view reaches the grabber's hit slop above the stack, so Android delivers touches there to it.
  view: { alignSelf: 'stretch', marginTop: -HEADER_SLOP_V },
});

export default React.memo(NativeHeader);
