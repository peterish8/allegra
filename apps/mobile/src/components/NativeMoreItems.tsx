/**
 * The tiles and rows of the "More" menu drawn by a Kotlin view (android/.../views/NativeMoreItemsView.kt). The frosted
 * card, the backdrop and the card's own spring stay React Native (`MoreMenu`); the view only reports which item was
 * chosen, and `MoreMenu` runs the same handler as for its React Native items, which stay as the fallback
 * (`nativeMoreItemsAvailable()`).
 */
import React, { useCallback } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { moreSelectionOf } from './moreMenuPayload';

interface NativeMoreItemsViewProps {
  items: string;
  activeKey: string;
  palette: string;
  animateIn: boolean;
  onSelect: (event: { nativeEvent: { key: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeMoreItemsViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeMoreItemsViewProps>('NativeMoreItems');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeMoreItemsAvailable = (): boolean => NativeView !== null;

interface NativeMoreItemsProps {
  /** `moreItemsPayload(...)`. */
  items: string;
  activeKey: string | null;
  /** `morePalette(Signal)`. */
  palette: string;
  /** False under Reduce Motion: the items are there at once and a press dims without scaling. */
  animateIn: boolean;
  /** `moreItemsHeight(...)`, in dp. */
  height: number;
  onSelect: (key: string) => void;
}

const NativeMoreItems: React.FC<NativeMoreItemsProps> = ({ items, activeKey, palette, animateIn, height, onSelect }) => {
  const onEvent = useCallback((event: { nativeEvent: { key: string } }) => {
    const key = moreSelectionOf(event);
    if (key) onSelect(key);
  }, [onSelect]);
  if (!NativeView) return null;
  return (
    <NativeView
      style={[styles.view, { height }]}
      items={items}
      activeKey={activeKey ?? ''}
      palette={palette}
      animateIn={animateIn}
      onSelect={onEvent}
    />
  );
};

const styles = StyleSheet.create({
  view: { alignSelf: 'stretch' },
});

export default React.memo(NativeMoreItems);
