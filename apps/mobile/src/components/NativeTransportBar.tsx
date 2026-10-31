import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import * as Haptics from '../utils/haptics';
import { usePlayerStore } from '../store/playerStore';

const tick = (medium: boolean) => {
  Haptics.impactAsync(medium ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

interface NativeTransportViewProps {
  playing: boolean;
  tint: string;
  nativeSkip: boolean;
  onPlayPause: () => void;
  onSkip: (event: { nativeEvent: { direction: number; moved: boolean } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeTransportViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeTransportViewProps>('NativeTransportBar');
  } catch {
    return null;
  }
};

const NativeTransportView = loadView();

interface NativeTransportBarProps {
  playing: boolean;
  nativeSkip: boolean;
  onTogglePlay: () => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Uses a transparent Kotlin canvas on Android; non-Android keeps the existing React Native controls. */
export const NativeTransportBar: React.FC<NativeTransportBarProps> = ({
  playing,
  nativeSkip,
  onTogglePlay,
  onSkipForward,
  onSkipBackward,
  style,
}) => {
  if (!NativeTransportView) return null;
  return (
    <NativeTransportView
      playing={playing}
      tint="#ffffff"
      nativeSkip={nativeSkip}
      onPlayPause={() => { tick(true); onTogglePlay(); }}
      onSkip={({ nativeEvent }) => {
        tick(false);
        if (nativeSkip) {
          usePlayerStore.getState().adoptNativeSkip(nativeEvent.direction > 0 ? 1 : -1, nativeEvent.moved);
        } else if (nativeEvent.direction > 0) {
          onSkipForward();
        } else {
          onSkipBackward();
        }
      }}
      style={style}
    />
  );
};

export const hasNativeTransportBar = NativeTransportView !== null;
