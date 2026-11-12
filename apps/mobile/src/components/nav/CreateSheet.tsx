/** Create rises above the navigation; the mini player yields on the same motion clock. */
import React, { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { ListRow, Motion, Radius, Space, Surface, Tactile } from '../../ui';
import { createSheetProgress } from '../../navigation/sheetProgress';
import { CREATE_ITEMS, type CreateAction } from '../../navigation/createMenu';

/** How far the page dims under the sheet. The mini player fades away before the card reaches it. */
export const CREATE_SCRIM_OPACITY = 0.62;
const SCRIM_OPACITY = CREATE_SCRIM_OPACITY;

/**
 * `bottom` and `maxHeight` come from `createSheetFrame`: the card rests above the navigation bar while the mini player is hidden.
 * Rows scroll when larger system text needs more room.
 */
export const CreateSheet: React.FC<{ open: boolean; bottom: number; maxHeight: number; onClose: () => void; onPick: (action: CreateAction) => void }> = ({ open, bottom, maxHeight, onClose, onPick }) => {
  const reduce = useReducedMotion();
  const shown = useSharedValue(open ? 1 : 0);
  const cardHeight = useSharedValue(0);
  useAnimatedReaction(() => shown.value, p => { createSheetProgress.value = Math.min(1, Math.max(0, p)); });
  useEffect(() => {
    shown.value = reduce
      ? withTiming(open ? 1 : 0, { duration: Motion.duration.fast })
      : withSpring(open ? 1 : 0, Motion.spring.player);
  }, [open, shown, reduce]);
  useEffect(() => () => { createSheetProgress.value = 0; }, []);
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  const scrim = useAnimatedStyle(() => ({ opacity: SCRIM_OPACITY * shown.value }));
  const card = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: reduce ? 0 : (1 - shown.value) * Math.max(Space.xl, cardHeight.value + Space.sm) }, { scale: reduce ? 1 : 0.96 + 0.04 * shown.value }] as const,
  }));
  return <View style={StyleSheet.absoluteFill} pointerEvents={open ? "box-none" : "none"} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
    {/* The dimmed page closes the sheet on a tap; TalkBack closes it with Back or the Create tab. */}
    <Tactile style={StyleSheet.absoluteFill} wrapperStyle={StyleSheet.absoluteFill} pressScale={1} onPress={onClose} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
    </Tactile>
    <Animated.View style={[styles.card, { bottom, maxHeight }, card]} onLayout={event => { cardHeight.value = event.nativeEvent.layout.height; }} accessibilityViewIsModal={open} accessibilityLabel="Create">
      <ScrollView bounces={false} overScrollMode="never" showsVerticalScrollIndicator={false} contentContainerStyle={styles.rows}>
        {CREATE_ITEMS.map(item => (
          <ListRow key={item.id} title={item.title} subtitle={item.subtitle} subtitleLines={3} icon={item.icon} onPress={() => onPick(item.id)} style={styles.action} />
        ))}
      </ScrollView>
    </Animated.View>
  </View>;
};

const styles = StyleSheet.create({
  scrim: { backgroundColor: Surface.scrim },
  card: {
    position: 'absolute', left: 0, right: 0,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, backgroundColor: Surface.raised, overflow: 'hidden',
  },
  rows: { paddingVertical: Space.sm },
  action: { minHeight: Space.xl * 2 + Space.md, paddingVertical: Space.sm },
});
