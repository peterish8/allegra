/** Android's complete Apple-style backdrop, drawn by NativeAppleBackdropView.kt. */
import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import { requireNativeView } from 'expo';
import type { AuraPalette } from '../allegra/palette';
import { backdropHeroHeight, nativeAppleBackdropPayload, type BackdropFrame, type NativeAppleBackdropPayload } from './nativeAppleBackdropProps';

interface NativeAppleBackdropViewProps extends NativeAppleBackdropPayload {
  shiftX?: number;
  pointerEvents?: 'none';
  style?: StyleProp<ViewStyle>;
}

export interface NativeAppleBackdropProps {
  uri?: string | null;
  frame?: BackdropFrame;
  veil?: boolean;
  palette: AuraPalette;
  showHero: boolean;
  shift?: SharedValue<number>;
}

const loadView = (): React.ComponentType<NativeAppleBackdropViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeAppleBackdropViewProps>('NativeAppleBackdrop');
  } catch {
    return null;
  }
};

const NativeView = loadView();
const AnimatedNativeView = NativeView ? Animated.createAnimatedComponent(NativeView) : null;

export const nativeAppleBackdropAvailable = (): boolean => AnimatedNativeView !== null;

const NativeAppleBackdrop: React.FC<NativeAppleBackdropProps> = ({ uri, palette, showHero, frame, veil = false, shift }) => {
  const win = useWindowDimensions();
  const resolvedFrame = frame ?? {
    width: win.width,
    height: Math.max(win.height, Dimensions.get('screen').height),
  };
  const animatedProps = useAnimatedProps(() => ({ shiftX: shift?.value ?? 0 }));
  if (!AnimatedNativeView) return null;
  const payload = nativeAppleBackdropPayload(uri, palette, resolvedFrame, showHero, veil);
  const height = veil ? backdropHeroHeight(resolvedFrame.width, resolvedFrame.height) : undefined;

  return (
    <AnimatedNativeView
      {...payload}
      animatedProps={animatedProps}
      pointerEvents="none"
      style={veil ? [styles.veil, { height }] : StyleSheet.absoluteFill}
    />
  );
};

const styles = StyleSheet.create({
  veil: { position: 'absolute', top: 0, left: 0, right: 0 },
});

export default React.memo(NativeAppleBackdrop);
