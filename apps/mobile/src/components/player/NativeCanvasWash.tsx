/**
 * The wash under Now Playing's controls while the animated canvas plays, in the video's own colours
 * (android/.../views/NativeCanvasWashView.kt). It reads them off the canvas's video surface a few times a second,
 * found by the native ID `CANVAS_VIDEO_NATIVE_ID`; there is no second decoder. Without the view (iOS, builds without
 * it) the still room of `AppleBackdrop` stays, as before.
 */
import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';

/** The canvas layer's wrapper carries this `nativeID`; the wash finds its video surface by it. */
export const CANVAS_VIDEO_NATIVE_ID = 'canvas-video-layer';

interface NativeCanvasWashViewProps {
  targetId: string;
  active: boolean;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeCanvasWashViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeCanvasWashViewProps>('NativeCanvasWash');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeCanvasWashAvailable = (): boolean => NativeView !== null;

interface NativeCanvasWashProps {
  /** The canvas is on screen and the song plays: only then is the video read. */
  active: boolean;
  style: StyleProp<ViewStyle>;
}

const NativeCanvasWash: React.FC<NativeCanvasWashProps> = ({ active, style }) => {
  if (!NativeView) return null;
  return <NativeView targetId={CANVAS_VIDEO_NATIVE_ID} active={active} style={style} />;
};

export default React.memo(NativeCanvasWash);
