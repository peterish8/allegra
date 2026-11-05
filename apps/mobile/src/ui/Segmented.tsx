/**
 * A segmented control: two to four options in one pill, the chosen one under a lit plate that slides to it.
 * The plate's radius is the pill's minus its padding, so the curves nest. For more options, use `Chip`s.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withSpring } from 'react-native-reanimated';
import { Control, Motion, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { Tactile } from '../components/allegra/motion';
import { Text } from './Text';

const PAD = 3;
const HEIGHT = Control.target + PAD * 2;

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** The group's accessible name. */
  label: string;
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const cell = options.length > 0 ? Math.max(0, width - PAD * 2) / options.length : 0;
  const index = Math.max(0, options.findIndex(o => o.value === value));
  const plate = useAnimatedStyle(() => {
    const x = index * cell;
    return {
      width: cell,
      opacity: cell > 0 ? 1 : 0,
      transform: [{ translateX: reduce ? x : withSpring(x, Motion.spring.open) }],
    };
  }, [index, cell, reduce]);
  return (
    <View
      style={styles.track}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      <Animated.View pointerEvents="none" style={[styles.plate, plate]} />
      {options.map(o => {
        const selected = o.value === value;
        return (
          <Tactile
            key={o.value}
            onPress={() => { if (!selected) onChange(o.value); }}
            haptic={selected ? undefined : 'select'}
            pressScale={0.96}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            wrapperStyle={styles.cellWrap}
            style={styles.cell}
          >
            <Text variant="secondary" style={[selected && styles.text, { color: selected ? Signal.bgDeep : Signal.inkSoft }]}>{o.label}</Text>
          </Tactile>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    minHeight: HEIGHT,
    padding: PAD,
    borderRadius: Radius.control,
    backgroundColor: Surface.control,
  },
  plate: { position: 'absolute', top: PAD, bottom: PAD, left: PAD, borderRadius: Radius.chip, backgroundColor: Signal.wave },
  cellWrap: { flex: 1 },
  cell: { flex: 1, minHeight: Control.target, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xs, paddingVertical: Space.xs },
  text: { fontWeight: '600' },
});
