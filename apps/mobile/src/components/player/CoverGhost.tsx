/**
 * The cover on its way between the mini player and the player (Fluid player, 1.49.0). One picture, drawn above the
 * sheet, whose rectangle and corner radius follow the sheet's progress: it starts on the mini player's cover (measured
 * by the pill into `playerCoverFrom`) and ends on the player's cover (a card, or the hero), growing and moving as the
 * finger drags. It is only on screen between the ends: at 0 the mini cover is the cover, at 1 the player's own cover is,
 * and by then the player's contents have faded in under it (`playerContentOpacity`), so nothing doubles or jumps.
 *
 * The rectangle uses left, top, width and height (not only transform) so a non-square hero can be cropped, not stretched;
 * it is one small view for a short move, and it is the first thing to look at in a frame-rate check on a real phone.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { coverFrame, coverRadius, ghostVisible, type Rect } from '../../navigation/playerTransition';
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
    const shown = from.width > 0 && ghostVisible(p);
    const tail = fadeOut ? 1 - Math.min(1, Math.max(0, (p - 0.9) / 0.1)) : 1;
    return {
      opacity: shown ? tail : 0,
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      borderRadius: coverRadius(p, from.radius, toRadius),
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Artwork uri={uri} title={title} artist={artist} size={to.width} priority="high" quiet style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  ghost: { position: 'absolute', overflow: 'hidden' },
});

export default CoverGhost;
