/**
 * Wraps a skip button so a tap skips on Android's main thread (android/.../views/NativeSkipView.kt), the way the
 * dynamic island and the notification do: the engine moves to the next song even while JavaScript is busy drawing.
 * The button keeps its look and press animation (the child); the screen follows when JavaScript hears about it.
 *
 * On only with the native queue on Android, and never in a LuvLink room this phone owns (its skips go through the
 * room). While it is on, the child's own press handler must not skip as well: ask `useNativeSkip()`.
 */
import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { usePlayerStore, usesNativeQueue } from '../store/playerStore';
import { useLuvLinkStore } from '../store/luvLinkStore';

interface NativeSkipViewProps {
  direction: 1 | -1;
  onSkip: (event: { nativeEvent: { direction: number; moved: boolean } }) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const loadView = (): React.ComponentType<NativeSkipViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeSkipViewProps>('NativeSkip');
  } catch {
    return null;
  }
};

const NativeSkipView = loadView();

/** Whether skip buttons skip natively right now. */
export const useNativeSkip = (): boolean => {
  const inRoom = useLuvLinkStore(s => s.ownedRoomId !== null);
  return NativeSkipView !== null && !inRoom && usesNativeQueue();
};

interface NativeSkipProps {
  direction: 1 | -1;
  /** From `useNativeSkip()`, read once by the parent so it and its press handler agree. */
  enabled: boolean;
  /** The child's hitSlop: the native touch area grows by it without moving the layout. */
  slop?: number;
  children: React.ReactNode;
}

const onSkip: NativeSkipViewProps['onSkip'] = ({ nativeEvent }) => {
  usePlayerStore.getState().adoptNativeSkip(nativeEvent.direction > 0 ? 1 : -1, nativeEvent.moved);
};

export const NativeSkip: React.FC<NativeSkipProps> = ({ direction, enabled, slop = 0, children }) => {
  if (!enabled || !NativeSkipView) return <>{children}</>;
  return (
    <NativeSkipView direction={direction} onSkip={onSkip} style={slop > 0 ? { margin: -slop, padding: slop } : undefined}>
      {children}
    </NativeSkipView>
  );
};
