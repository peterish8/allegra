import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ShellFrost } from '../constants/allegraTheme';
import { useReduceTransparency } from '../hooks/useReduceTransparency';
import { useLowEndDevice } from '../utils/performanceTier';
import { useBatterySaver } from '../utils/batterySaver';
import { shellCoverFrame, shellIsSolid } from './shellMaterialMath';

/**
 * The shell's one frosted surface (Round 7 item 8). Only the cover bitmap is blurred, never the content scrolling
 * behind; that content shows faintly through the tint. `above` / `below`: how much of the shell lies above and below
 * this part (the mini player sits above the navigation bar), so both parts draw the same cover with no seam.
 */
export const ShellMaterial: React.FC<{ uri?: string; above?: number; below?: number }> = ({ uri, above = 0, below = 0 }) => {
  const lowEnd = useLowEndDevice();
  const reduceTransparency = useReduceTransparency();
  const batterySaver = useBatterySaver();
  const solid = shellIsSolid({ lowEnd, reduceTransparency, batterySaver, uri });
  if (solid) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.solid]} />;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
    <Image source={{ uri, width: 48, height: 48 }} blurRadius={30} contentFit="cover"
      style={[styles.cover, shellCoverFrame(above, below)]} />
    <View style={[StyleSheet.absoluteFill, styles.tint]} />
  </View>;
};

const styles = StyleSheet.create({
  solid: { backgroundColor: ShellFrost.solid },
  clip: { overflow: 'hidden' },
  cover: { position: 'absolute', left: 0, right: 0, opacity: ShellFrost.coverOpacity },
  tint: { backgroundColor: ShellFrost.tint },
});
