/**
 * The Apple + glow background behind the lyrics, drawn in Kotlin with the dynamic island's own light
 * (android/.../views/NativeFlowGlowView.kt): the cover's colours as one flowing liquid mesh. `GlowBackground` (Skia)
 * stays as the fallback for iOS and for builds without the view; ask `nativeFlowGlowAvailable()`.
 */
import React from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';

interface NativeFlowGlowViewProps {
  coverUri?: string | null;
  active: boolean;
  playing: boolean;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeFlowGlowViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeFlowGlowViewProps>('NativeFlowGlow');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeFlowGlowAvailable = (): boolean => NativeView !== null;

interface NativeFlowGlowProps {
  coverUri?: string | null;
  /** The surface is on screen: the flow runs only then. */
  active: boolean;
  /** The song plays: the light flows while it does and eases to a stop on pause. */
  playing: boolean;
}

const NativeFlowGlow: React.FC<NativeFlowGlowProps> = ({ coverUri, active, playing }) => {
  if (!NativeView) return null;
  return <NativeView coverUri={coverUri ?? null} active={active} playing={playing} style={StyleSheet.absoluteFill} />;
};

export default React.memo(NativeFlowGlow);
