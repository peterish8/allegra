/**
 * The Create (+) tab's sheet (1.42.0), Spotify's: a rounded card that rises just above the tab bar over a dimmed
 * page, while the Create tab turns into a white close disc (drawn by the native bar). Luvs first, then Playlist,
 * Blend and LuvLink (`navigation/createMenu`). Back, a tap on the dimmed page or the close disc puts it away.
 *
 * Drawn inside the tab bar's host, not a Modal, so the bar and its close disc stay on top and tappable. Moves by
 * transform and opacity only; under Reduce Motion it only fades.
 */
import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { ListRow, Motion, Radius, Space, Surface, Tactile } from '../../ui';
import { CREATE_ITEMS, type CreateAction } from '../../navigation/createMenu';

/** How far the page dims under the sheet. */
const SCRIM_OPACITY = 0.62;

export const CreateSheet: React.FC<{ open: boolean; bottom: number; onClose: () => void; onPick: (action: CreateAction) => void }> = ({ open, bottom, onClose, onPick }) => {
  const reduce = useReducedMotion();
  const shown = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, { duration: open ? Motion.duration.base : Motion.duration.fast, easing: open ? Motion.ease.decelerate : Motion.ease.accelerate });
  }, [open, shown]);
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  const scrim = useAnimatedStyle(() => ({ opacity: SCRIM_OPACITY * shown.value }));
  const card = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: reduce ? 0 : (1 - shown.value) * 24 }, { scale: reduce ? 1 : 0.98 + 0.02 * shown.value }] as const,
  }));
  if (!open) return null;
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    {/* The dimmed page closes the sheet on a tap; TalkBack closes it with Back or the Create tab. */}
    <Tactile style={StyleSheet.absoluteFill} wrapperStyle={StyleSheet.absoluteFill} pressScale={1} onPress={onClose} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
    </Tactile>
    <Animated.View style={[styles.card, { bottom: bottom + Space.sm }, card]} accessibilityViewIsModal accessibilityLabel="Create">
      {CREATE_ITEMS.map(item => (
        <ListRow key={item.id} title={item.title} subtitle={item.subtitle} icon={item.icon} onPress={() => onPick(item.id)} />
      ))}
    </Animated.View>
  </View>;
};

const styles = StyleSheet.create({
  scrim: { backgroundColor: Surface.scrim },
  card: {
    position: 'absolute', left: Space.md, right: Space.md, paddingVertical: Space.sm,
    borderRadius: Radius.sheet, backgroundColor: Surface.raised, overflow: 'hidden',
  },
});
