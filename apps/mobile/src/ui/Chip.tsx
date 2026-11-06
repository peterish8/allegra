/**
 * Chips: filters, sorts, moods, the choices under a heading. A chosen chip is lit white glass — never the
 * accent, which is kept for play and progress. `ChipRow` scrolls them sideways with the page's gutter.
 */
import React from 'react';
import { ScrollView, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Control, Motion, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
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

export const Chip: React.FC<ChipProps> = ({ label, onPress, selected = false, icon, clearable, disabled, accessibilityLabel }) => {
  // The lit fill fades rather than snapping, so a choice moving between chips reads as one change.
  const lit = useAnimatedStyle(() => ({ opacity: withTiming(selected ? 1 : 0, { duration: Motion.duration.fast }) }), [selected]);
  const ink = selected ? Signal.bgDeep : Signal.inkSoft;
  return (
    <Tactile
      onPress={onPress}
      disabled={disabled}
      haptic="select"
      pressScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      hitSlop={CHIP_SLOP}
      style={[styles.chip, disabled && styles.disabled]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.lit, lit]} />
      {icon ? <Ionicons name={icon} size={15} color={ink} /> : null}
      <Text variant="secondary" style={[selected && styles.label, { color: ink }]}>{label}</Text>
      {clearable ? <Ionicons name="close" size={14} color={ink} /> : null}
    </Tactile>
  );
};

/**
 * A chip draws 36dp tall (the V6 board's compact filters) and answers a 48dp touch: the slop above and below makes
 * up the rest. A row of chips pads by the same slop, so the whole target stays inside it and nothing beside it.
 */
export const CHIP_HEIGHT = 36;
const SLOP = (Control.target - CHIP_HEIGHT) / 2;
const CHIP_SLOP = { top: SLOP, bottom: SLOP, left: 0, right: 0 } as const;
/** The padding a row of chips needs around them for their full touch target. */
export const CHIP_ROW_PADDING = SLOP;

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
    borderRadius: Radius.chip,
    overflow: 'hidden',
    backgroundColor: Surface.control,
  },
  lit: { backgroundColor: Signal.wave },
  label: { fontWeight: '600' },
  disabled: { opacity: Control.disabledOpacity },
  row: { gap: Space.xs, alignItems: 'center', paddingVertical: SLOP },
});
