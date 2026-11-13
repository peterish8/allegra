/**
 * Wraps the mini player's cover and title so a sideways swipe skips on Android's main thread
 * (android/.../views/NativeSwipeSkipView.kt), the way the island does: the content follows the finger, lifting decides
 * with the same rule as playback/miniSwipe.ts, and the queue engine moves to the next song even while JavaScript is
 * busy. Off unless Settings → Playback → "Native mini player swipes" is on; the JavaScript swipe is the fallback
 * (iOS, a build without the view, a LuvLink room this phone owns, remote playback).
 *
 * While it is on, the JavaScript swipe must not skip as well: ask `useNativeSwipeSkip()`.
 */
import React from 'react';
import { I18nManager, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { useReducedMotion } from 'react-native-reanimated';
import { usePlayerStore, usesNativeQueue } from '../store/playerStore';
import { useLuvLinkStore } from '../store/luvLinkStore';
import { useSettingsStore } from '../store/settingsStore';

interface NativeSwipeSkipViewProps {
  enabled: boolean;
  rtl: boolean;
  reduceMotion: boolean;
  songKey: string;
  onSkip: (event: { nativeEvent: { direction: number; moved: boolean } }) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const loadView = (): React.ComponentType<NativeSwipeSkipViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeSwipeSkipViewProps>('NativeSwipeSkip');
  } catch {
    return null;
  }
};

const NativeSwipeSkipView = loadView();

/** Whether the mini player's swipe skips natively right now. */
export const useNativeSwipeSkip = (remote: boolean): boolean => {
  const setting = useSettingsStore(s => s.nativeMiniSwipe);
  const inRoom = useLuvLinkStore(s => s.ownedRoomId !== null);
  return NativeSwipeSkipView !== null && setting && !remote && !inRoom && usesNativeQueue();
};

const onSkip: NativeSwipeSkipViewProps['onSkip'] = ({ nativeEvent }) => {
  usePlayerStore.getState().adoptNativeSkip(nativeEvent.direction > 0 ? 1 : -1, nativeEvent.moved);
};

interface Props {
  /** From `useNativeSwipeSkip()`, read once by the parent so it and its JavaScript swipe agree. */
  enabled: boolean;
  /** Changes when the new song's text has been drawn: the content slides back in then. */
  songKey: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const NativeSwipeSkip: React.FC<Props> = ({ enabled, songKey, style, children }) => {
  const reduceMotion = useReducedMotion();
  if (!enabled || !NativeSwipeSkipView) return <>{children}</>;
  return (
    <NativeSwipeSkipView enabled rtl={I18nManager.isRTL} reduceMotion={!!reduceMotion} songKey={songKey} onSkip={onSkip} style={style}>
      {children}
    </NativeSwipeSkipView>
  );
};
