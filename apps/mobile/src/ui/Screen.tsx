import React from 'react';
import { Image, StyleSheet, View, type ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Signal, Surface } from '../constants/allegraTheme';

/** One static cover glow, never a shader or a blur of a scrolling list. */
export const CoverGlow: React.FC<{ uri?: string }> = ({ uri }) => uri ? (
  <View pointerEvents="none" style={styles.glow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Image source={{ uri, width: 48, height: 48 }} resizeMethod="resize" blurRadius={36} style={styles.image} />
    <LinearGradient colors={['transparent', Surface.base]} style={StyleSheet.absoluteFill} />
  </View>
) : null;

/**
 * A page. `staticGlow={false}` for pages that draw their own scroll-linked HeaderGlow (Stream, Library) instead of
 * the fixed cover glow.
 */
export const Screen: React.FC<ViewProps & { coverUri?: string; staticGlow?: boolean }> = ({ coverUri, staticGlow = true, children, style, ...props }) => (
  <View {...props} style={[styles.screen, style]}>
    {staticGlow ? <CoverGlow uri={coverUri} /> : null}
    {children}
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bg },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 240, overflow: 'hidden' },
  image: { position: 'absolute', top: -80, left: -40, right: -40, height: 300, opacity: 0.35 },
});
