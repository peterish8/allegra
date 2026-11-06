/**
 * The header glow of Stream and Library: two soft, cover-tinted light pools over the top fifth of the page that drift
 * very slowly, leave with the header as the page scrolls and come back with it.
 *
 * Presentation only: the screen binding (hooks/useHeaderGlow) supplies the colours, the scroll offset and the drift
 * phase, and decides when the drift runs. Only transform and opacity animate, on the UI thread; nothing is blurred
 * and no layout changes while it moves. With no colours (nothing playing) it draws nothing: the page stays near-black.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Motion } from '../constants/allegraTheme';
import { GlowFrame, glowScroll } from './headerGlowMath';

export interface GlowColors { primary: string; secondary: string }

export interface HeaderGlowProps {
  colors: GlowColors | null;
  frame: GlowFrame;
  /** The page's scroll offset, in points. */
  scrollY: SharedValue<number>;
  /** 0..1, the drift's phase; held still by the binding when the glow should rest. */
  drift: SharedValue<number>;
  /** How strong the light is: lighter for reduced transparency. */
  strength?: number;
}

const Pools: React.FC<{ colors: GlowColors; id: string }> = ({ colors, id }) => (
  <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
    <Defs>
      <RadialGradient id={`${id}a`} cx="50%" cy="50%" rx="50%" ry="50%">
        <Stop offset="0" stopColor={colors.primary} stopOpacity="0.55" />
        <Stop offset="0.55" stopColor={colors.primary} stopOpacity="0.18" />
        <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
      </RadialGradient>
      <RadialGradient id={`${id}b`} cx="50%" cy="50%" rx="50%" ry="50%">
        <Stop offset="0" stopColor={colors.secondary} stopOpacity="0.45" />
        <Stop offset="0.6" stopColor={colors.secondary} stopOpacity="0.12" />
        <Stop offset="1" stopColor={colors.secondary} stopOpacity="0" />
      </RadialGradient>
    </Defs>
    <Ellipse cx="22" cy="18" rx="62" ry="58" fill={`url(#${id}a)`} />
    <Ellipse cx="84" cy="10" rx="52" ry="50" fill={`url(#${id}b)`} />
  </Svg>
);

export const HeaderGlow: React.FC<HeaderGlowProps> = ({ colors, frame, scrollY, drift, strength = 1 }) => {
  // A new cover fades its light in over the old one instead of switching colours in a frame.
  const key = colors ? `${colors.primary}|${colors.secondary}` : '';
  const [layers, setLayers] = useState<{ key: string; colors: GlowColors }[]>(() => (colors ? [{ key, colors }] : []));
  const incoming = useSharedValue(1);
  useEffect(() => {
    if (!colors) { setLayers([]); return; }
    setLayers(prev => (prev.length && prev[prev.length - 1].key === key ? prev : [...prev.slice(-1), { key, colors }]));
    incoming.value = 0;
    incoming.value = withTiming(1, { duration: Motion.duration.slow, easing: Motion.ease.standard });
    const done = setTimeout(() => setLayers(prev => prev.slice(-1)), Motion.duration.slow + 50);
    return () => clearTimeout(done);
    // `colors` is described fully by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const travel = useAnimatedStyle(() => {
    const { translateY, opacity } = glowScroll(scrollY.value, frame);
    return { opacity: opacity * strength, transform: [{ translateY }] };
  }, [frame, strength]);
  // A slow sway: a few points sideways and a breath of scale. Phase 0 is the resting frame.
  const sway = useAnimatedStyle(() => {
    const p = drift.value;
    return { transform: [{ translateX: (p - 0.5) * 24 }, { scale: 1 + p * 0.06 }] as const };
  });
  const fadeIn = useAnimatedStyle(() => ({ opacity: incoming.value }));

  if (layers.length === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.layer, { height: frame.extent }, travel]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.wide, sway]}>
        {layers.map((layer, i) => {
          const top = i === layers.length - 1;
          return (
            <Animated.View key={layer.key} style={[StyleSheet.absoluteFill, top && layers.length > 1 ? fadeIn : null]}>
              <Pools colors={layer.colors} id={`glow${i}`} />
            </Animated.View>
          );
        })}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  // A little wider than the screen, so the sway never shows an edge.
  wide: { left: -16, right: -16 },
});
