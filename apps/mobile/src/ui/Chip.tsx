/**
 * Chips: filters, sorts, moods, the choices under a heading. Round 7 item 1: full capsules (radius half the height)
 * with a light frost over the page and its glow. A chosen chip is solid white with a check, so the choice reads by
 * shape and text, not colour alone. Pressed lightens and sinks 3%; keyboard focus is its own ring, offset from the
 * chip, and never looks like selection. `ChipRow` scrolls them sideways with the page's gutter.
 */
import React, { useState } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Control, Glass, Motion, Radius, Signal, Space } from '../constants/allegraTheme';
import { Tactile } from '../components/allegra/motion';
import { Text } from './Text';
import type { IconName } from './Button';

export interface ChipProps {
  label: string;
  onPress: () => void;
  selected?: boolean;
  icon?: IconName;
  /** A small × after the label: the chip clears a filter. */
  clearable?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/** What a chip shows before its label: the caller's icon, or a check once it is chosen. */
export const chipLeadingIcon = (selected: boolean, icon?: IconName): IconName | undefined => icon ?? (selected ? 'checkmark' : undefined);

export const Chip: React.FC<ChipProps> = ({ label, onPress, selected = false, icon, clearable, disabled, accessibilityLabel }) => {
  // The lit fill fades rather than snapping, so a choice moving between chips reads as one change.
  const lit = useAnimatedStyle(() => ({ opacity: withTiming(selected ? 1 : 0, { duration: Motion.duration.fast }) }), [selected]);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const ink = selected ? Signal.bgDeep : Signal.ink;
  const leading = chipLeadingIcon(selected, icon);
  return (
    <Tactile
      onPress={onPress}
      disabled={disabled}
      haptic="select"
      pressScale={0.97}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      hitSlop={CHIP_SLOP}
      style={[styles.chip, pressed && !selected && styles.pressed, disabled && styles.disabled]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.lit, lit]} />
      {leading ? <Ionicons name={leading} size={15} color={ink} /> : null}
      <Text variant="secondary" style={[styles.labelText, selected && styles.label, { color: ink }]}>{label}</Text>
      {clearable ? <Ionicons name="close" size={14} color={ink} /> : null}
      {focused ? <View pointerEvents="none" style={styles.focus} /> : null}
    </Tactile>
  );
};

/**
 * A chip draws 36dp tall and answers a 48dp touch: the slop above and below makes up the rest. A row of chips pads by
 * the same slop, so the whole target stays inside it and nothing beside it.
 */
export const CHIP_HEIGHT = 36;
const SLOP = (Control.target - CHIP_HEIGHT) / 2;
const CHIP_SLOP = { top: SLOP, bottom: SLOP, left: 0, right: 0 } as const;
/** The padding a row of chips needs around them for their full touch target. */
export const CHIP_ROW_PADDING = SLOP;
const FOCUS_OFFSET = 3;

export const ChipRow: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; gutter?: number }> = ({ children, style, gutter = Control.gutter }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={style}
    contentContainerStyle={[styles.row, { paddingHorizontal: gutter }]}
    keyboardShouldPersistTaps="handled"
  >
    {children}
  </ScrollView>
);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs - 2,
    minHeight: CHIP_HEIGHT,
    paddingVertical: Space.xxs,
    paddingHorizontal: Space.md - 2,
    borderRadius: Radius.pill,
    backgroundColor: Glass.chip,
  },
  pressed: { backgroundColor: Glass.capsulePressed },
  lit: { backgroundColor: Signal.wave, borderRadius: Radius.pill },
  labelText: { fontWeight: '400' },
  label: { fontWeight: '600' },
  focus: {
    position: 'absolute', top: -FOCUS_OFFSET, bottom: -FOCUS_OFFSET, left: -FOCUS_OFFSET, right: -FOCUS_OFFSET,
    borderRadius: Radius.pill, borderWidth: 2, borderColor: Glass.focusRing,
  },
  disabled: { opacity: Control.disabledOpacity },
  row: { gap: Space.xs, alignItems: 'center', paddingVertical: SLOP },
});
