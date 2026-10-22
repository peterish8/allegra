/**
 * The Library's A–Z rail drawn by a Kotlin view (android/.../views/NativeAlphabetRailView.kt). The view is larger than
 * the rail (the bubble beside the thumb sits outside it), placed so the rail itself is where `AlphabetRail`'s rail is;
 * only the rail takes touches. `AlphabetRail` keeps its React Native rail as the fallback
 * (`nativeAlphabetRailAvailable()`).
 */
import React, { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import {
  RAIL_REACH_LEFT,
  RAIL_REACH_V,
  RAIL_W,
  railHeight,
  railIndexOf,
  railLettersJson,
  railPalette,
  type RailEntry,
} from './railPayload';

interface NativeAlphabetRailViewProps {
  letters: string;
  palette: string;
  onPick: (event: { nativeEvent: { index: number } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeAlphabetRailViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeAlphabetRailViewProps>('NativeAlphabetRail');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeAlphabetRailAvailable = (): boolean => NativeView !== null;

interface NativeAlphabetRailProps {
  letters: readonly RailEntry[];
  /** `railPalette(Signal)`. */
  palette: string;
  /** A new letter is under the thumb: the list index it jumps to. */
  onPick: (index: number) => void;
}

const NativeAlphabetRail: React.FC<NativeAlphabetRailProps> = ({ letters, palette, onPick }) => {
  const json = useMemo(() => railLettersJson(letters), [letters]);
  const onEvent = useCallback((event: { nativeEvent: { index: number } }) => {
    const index = railIndexOf(event);
    if (index !== null) onPick(index);
  }, [onPick]);
  if (!NativeView) return null;
  // The box is the rail's own size; the view reaches out of it (overflow is visible) so the bubble has room.
  const h = railHeight(letters.length, StyleSheet.hairlineWidth);
  return (
    <View style={{ width: RAIL_W, height: h }}>
      <NativeView
        style={[styles.view, { left: -RAIL_REACH_LEFT, top: -RAIL_REACH_V, width: RAIL_W + RAIL_REACH_LEFT, height: h + 2 * RAIL_REACH_V }]}
        letters={json}
        palette={palette}
        onPick={onEvent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  view: { position: 'absolute' },
});

export { railPalette };
export default React.memo(NativeAlphabetRail);
