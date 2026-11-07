/**
 * The mini player's background (1.41.3): opaque. The cover's "Glow animated" light (Echo's two drifting mini-player
 * glows, `player/GlowBackground`) at full strength on its own near-black base, a soft blurred copy of the cover for
 * texture, and a light scrim for the text. The page behind never shows through.
 *
 * The glow follows the visual budget (it rests while paused) and holds still on low-end phones and under Battery
 * Saver (`miniSurfacePlan`); a song with no cover gets the plain solid surface. Only the 48px cover bitmap is blurred.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ShellFrost } from '../constants/allegraTheme';
import { useBatterySaver } from '../utils/batterySaver';
import { useLowEndDevice } from '../utils/performanceTier';
import GlowBackground from './player/GlowBackground';
import { useGlowColors } from './player/useGlowColors';
import { miniSurfacePlan } from './miniPlayerSurface';

export const MiniPlayerGlow: React.FC<{ uri?: string; active: boolean }> = ({ uri, active }) => {
  const lowEnd = useLowEndDevice();
  const batterySaver = useBatterySaver();
  const plan = miniSurfacePlan({ uri, lowEnd, batterySaver });
  // No palette read at all for the solid surface: nothing would use it.
  const colors = useGlowColors(plan.kind === 'glow' ? uri : null);
  if (plan.kind === 'solid') return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.solid]} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <View style={[StyleSheet.absoluteFill, styles.glow]}>
        <GlowBackground colors={colors} variant="mini" active={active && plan.animate} />
      </View>
      <Image source={{ uri, width: 48, height: 48 }} blurRadius={40} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} style={[StyleSheet.absoluteFill, styles.cover]} />
      <View style={[StyleSheet.absoluteFill, styles.tint]} />
    </View>
  );
};

const styles = StyleSheet.create({
  solid: { backgroundColor: ShellFrost.solid },
  // Opaque from the first frame: the base shows before the glow's palette has been read.
  base: { overflow: 'hidden', backgroundColor: ShellFrost.miniBase },
  glow: { opacity: ShellFrost.miniGlowOpacity },
  cover: { opacity: ShellFrost.miniCoverOpacity },
  tint: { backgroundColor: ShellFrost.miniTint },
});
