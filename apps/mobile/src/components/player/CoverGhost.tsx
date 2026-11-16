/**
 * The cover on its way between the mini player and the player (1.49.0). One picture, drawn above the
 * sheet, whose rectangle follows the sheet's progress: it starts on the mini player's cover (measured by the pill
 * into `playerCoverFrom`, carried up as the pill rides the sheet's edge) and ends on the player's cover (a card, the
 * hero, or the lyrics thumbnail), growing and moving as the finger drags. It is only on screen between the ends: at 0
 * the mini cover is the thumbnail (the pill hides its own cover exactly while this one shows, `thumbnailOwner`), at
 * 1 the player's own cover is.
 *
 * Whether it flies is decided on the UI thread (`playerCoverHandoff`, usable geometry), never by reading a shared
 * value during render: a missing or late measurement just means the sheet moves without it.
 *
 * Fixed layout with transformed clipping masks keeps the move on the UI thread (transform and opacity only). The
 * picture is a square cover cropped to each frame (`coverPictureScale`), so a tall hero crops like the real one and
 * the mini end shows the whole square cover. Two clips carry the corners (`ghostClipOpacity`): one laid out at the
 * mini cover's size with its radius, exact at the mini player, and one at the destination with the player's radius,
 * exact in the player.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { coverFrame, coverPictureScale, ghostClipOpacity, ghostVisible, isUsableRect, riddenCoverRect, type Rect } from '../../navigation/playerTransition';
import { playerCoverFrom, playerCoverHandoff } from '../../navigation/sheetProgress';
import { Radius } from '../../constants/allegraTheme';
import { MINI_COVER_SIZE } from '../../navigation/v6Shell';
import Artwork from '../allegra/Artwork';

interface Props {
  progress: SharedValue<number>;
  /** Where the cover ends up in the player, in window coordinates. */
  to: Rect;
  toRadius: number;
  /** The pill's resting top (the sheet's `restY`): the mini cover rides up with the sheet's edge from there. */
  restY: number;
  /** A hero is cut off at its bottom by the player's own dissolve, so the moving cover fades out over the last tenth. */
  fadeOut?: boolean;
  uri?: string | null;
  title: string;
  artist?: string;
}

/** The mini cover's laid-out size: the clip that carries its corners is scaled from this. */
const MINI_LAYOUT: Rect = { x: 0, y: 0, width: MINI_COVER_SIZE, height: MINI_COVER_SIZE };

export const CoverGhost: React.FC<Props> = ({ progress, to, toRadius, restY, fadeOut = false, uri, title, artist }) => {
  // This overlay's own place in the window, so the measured mini cover and the destination share one space.
  const origin = useSharedValue({ x: 0, y: 0 });
  const rootRef = React.useRef<View>(null);
  const measureOrigin = () => rootRef.current?.measureInWindow((x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) origin.value = { x, y };
  });

  const frameAt = (p: number): Rect => {
    'worklet';
    const from = riddenCoverRect(playerCoverFrom.value, p, restY, false);
    const f = coverFrame(p, from, to);
    return { x: f.x - origin.value.x, y: f.y - origin.value.y, width: f.width, height: f.height };
  };
  const shownStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const shown = playerCoverHandoff.value && isUsableRect(playerCoverFrom.value) && ghostVisible(p);
    const tail = fadeOut ? 1 - Math.min(1, Math.max(0, (p - 0.9) / 0.1)) : 1;
    return { opacity: shown ? tail : 0 };
  });
  const clipStyle = (layout: Rect, which: 'mini' | 'player') => {
    'worklet';
    const frame = frameAt(progress.value);
    const fade = ghostClipOpacity(progress.value);
    return {
      opacity: which === 'mini' ? fade.mini : fade.player,
      transform: [
        { translateX: frame.x + (frame.width - layout.width) / 2 },
        { translateY: frame.y + (frame.height - layout.height) / 2 },
        { scaleX: Math.max(0.0001, frame.width / layout.width) },
        { scaleY: Math.max(0.0001, frame.height / layout.height) },
      ] as const,
    };
  };
  const pictureStyle = (layout: Rect) => {
    'worklet';
    const scale = coverPictureScale(frameAt(progress.value), layout);
    return { transform: [{ scaleX: scale.x }, { scaleY: scale.y }] as const };
  };
  const playerClip = useAnimatedStyle(() => clipStyle(to, 'player'));
  const miniClip = useAnimatedStyle(() => clipStyle(MINI_LAYOUT, 'mini'));
  const playerPicture = useAnimatedStyle(() => pictureStyle(to));
  const miniPicture = useAnimatedStyle(() => pictureStyle(MINI_LAYOUT));

  const side = Math.max(to.width, to.height);
  return (
    <Animated.View ref={rootRef} onLayout={measureOrigin} pointerEvents="none" style={[StyleSheet.absoluteFill, shownStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ghost, { width: to.width, height: to.height, borderRadius: toRadius }, playerClip]}>
        <Animated.View style={[styles.picture, { width: side, height: side, left: (to.width - side) / 2, top: (to.height - side) / 2 }, playerPicture]}>
          <Artwork uri={uri} title={title} artist={artist} size={side} priority="high" quiet style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.ghost, { width: MINI_LAYOUT.width, height: MINI_LAYOUT.height, borderRadius: Radius.cover }, miniClip]}>
        <Animated.View style={[styles.picture, { width: MINI_LAYOUT.width, height: MINI_LAYOUT.height, left: 0, top: 0 }, miniPicture]}>
          <Artwork uri={uri} title={title} artist={artist} size={MINI_LAYOUT.width} priority="high" quiet style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  ghost: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  picture: { position: 'absolute' },
});

export default CoverGhost;
