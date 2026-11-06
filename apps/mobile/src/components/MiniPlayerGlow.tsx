/**
 * The mini player's background (1.41.0): the cover's "Glow animated" light (Echo's two drifting mini-player glows,
 * `player/GlowBackground`), under a heavily blurred copy of the cover and a frosted dark tint, so it reads soft and
 * subtle. Only the cover bitmap is blurred; nothing behind the player is. The glow follows the visual budget (it
 * rests while paused, on low-end phones and under Battery Saver) and goes opaque under Reduce Transparency, Battery
 * Saver, on low-end phones or with no cover, like the rest of the shell.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ShellFrost } from '../constants/allegraTheme';
import { useReduceTransparency } from '../hooks/useReduceTransparency';
import { useBatterySaver } from '../utils/batterySaver';
import { useLowEndDevice } from '../utils/performanceTier';
import GlowBackground from './player/GlowBackground';
import { useGlowColors } from './player/useGlowColors';
import { shellIsSolid } from './shellMaterialMath';

export const MiniPlayerGlow: React.FC<{ uri?: string; active: boolean }> = ({ uri, active }) => {
  const lowEnd = useLowEndDevice();
  const reduceTransparency = useReduceTransparency();
  const batterySaver = useBatterySaver();
  const solid = shellIsSolid({ lowEnd, reduceTransparency, batterySaver, uri });
  // No palette read at all when the opaque fallback shows: nothing would use it.
  const colors = useGlowColors(solid ? null : uri);
  if (solid) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.solid]} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <View style={[StyleSheet.absoluteFill, styles.glow]}>
        <GlowBackground colors={colors} variant="mini" active={active} />
      </View>
      <Image source={{ uri, width: 48, height: 48 }} blurRadius={40} contentFit="cover" style={[StyleSheet.absoluteFill, styles.cover]} />
      <View style={[StyleSheet.absoluteFill, styles.tint]} />
    </View>
  );
};

const styles = StyleSheet.create({
  solid: { backgroundColor: ShellFrost.solid },
  clip: { overflow: 'hidden' },
  glow: { opacity: ShellFrost.miniGlowOpacity },
  cover: { opacity: ShellFrost.miniCoverOpacity },
  tint: { backgroundColor: ShellFrost.miniTint },
});
