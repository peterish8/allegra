/**
 * The cover on its way between the mini player and the player (Fluid player, 1.49.0). One picture, drawn above the
 * sheet, whose rectangle and corner radius follow the sheet's progress: it starts on the mini player's cover (measured
 * by the pill into `playerCoverFrom`) and ends on the player's cover (a card, or the hero), growing and moving as the
 * finger drags. It is only on screen between the ends: at 0 the mini cover is the cover, at 1 the player's own cover is,
 * and by then the player's contents have faded in under it (`playerContentOpacity`), so nothing doubles or jumps.
 *
 * Fixed layout with a transformed clipping mask keeps the move on the UI thread. The image counter-scales inside
 * the mask so a rectangular destination crops instead of stretching the artwork.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { coverFrame, ghostVisible, type Rect } from '../../navigation/playerTransition';
import { playerCoverFrom } from '../../navigation/sheetProgress';
import Artwork from '../allegra/Artwork';

interface Props {
  progress: SharedValue<number>;
  /** Where the cover ends up in the player, in window coordinates. */
  to: Rect;
  toRadius: number;
  /** A hero is cut off at its bottom by the player's own dissolve, so the moving cover fades out over the last tenth. */
  fadeOut?: boolean;
  uri?: string | null;
  title: string;
  artist?: string;
}

export const CoverGhost: React.FC<Props> = ({ progress, to, toRadius, fadeOut = false, uri, title, artist }) => {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const from = playerCoverFrom.value;
    const frame = coverFrame(p, from, to);
    // The cover rides inside the rising surface: never above its top edge (the surface is linear in progress).
    const top = Math.max(frame.y, (from.y - 12) * (1 - p) + 10);
    const shown = from.width > 0 && ghostVisible(p);
    const tail = fadeOut ? 1 - Math.min(1, Math.max(0, (p - 0.9) / 0.1)) : 1;
    return {
      opacity: shown ? tail : 0,
      transform: [
        { translateX: frame.x + (frame.width - to.width) / 2 },
        { translateY: top + (frame.height - to.height) / 2 },
        { scaleX: frame.width / to.width },
        { scaleY: frame.height / to.height },
      ] as const,
    };
  });
  // Counter the mask's nonuniform scale: a hero crops the picture instead of stretching it.
  const pictureStyle = useAnimatedStyle(() => {
    const frame = coverFrame(progress.value, playerCoverFrom.value, to);
    const sx = Math.max(0.001, frame.width / to.width);
    const sy = Math.max(0.001, frame.height / to.height);
    const scale = Math.max(sx, sy);
    return { transform: [{ scaleX: scale / sx }, { scaleY: scale / sy }] as const };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, { width: to.width, height: to.height, borderRadius: toRadius }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, pictureStyle]}>
      <Artwork uri={uri} title={title} artist={artist} size={to.width} priority="high" quiet style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  ghost: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});

export default CoverGhost;
