/**
 * The rows of the Up next panel, drawn, scrolled and re-ordered in Kotlin (android/.../views/NativeQueueListView.kt).
 * The panel's chrome stays React Native; `UpNextPanel` falls back to its FlatList on iOS and in builds without the
 * view (`nativeQueueListAvailable()`).
 */
import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';

interface NativeQueueListViewProps {
  rows: string;
  currentIndex: number;
  movable: boolean;
  bottomPad: number;
  startRow: number;
  scrollToken: number;
  onPick: (event: { nativeEvent: { index: number } }) => void;
  onMove: (event: { nativeEvent: { from: number; to: number } }) => void;
  onAtTop: (event: { nativeEvent: { atTop: boolean } }) => void;
  onLift: (event: { nativeEvent: { index: number } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeQueueListViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeQueueListViewProps>('NativeQueueList');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeQueueListAvailable = (): boolean => NativeView !== null;

interface NativeQueueListProps {
  /** `queueRowsJson(...)`. */
  rows: string;
  /** The playing song's place in the whole queue. */
  currentIndex: number;
  /** Rows have a handle and can be moved (the unfiltered list). */
  movable: boolean;
  /** Empty space under the last row, in dp. */
  bottomPad: number;
  /** The row to put at the top when `scrollToken` changes. */
  startRow: number;
  scrollToken: number;
  onPick: (index: number) => void;
  onMove: (from: number, to: number) => void;
  /** False once the list is scrolled away from its top: the panel's swipe down must then leave it alone. */
  onAtTop: (atTop: boolean) => void;
  /** A row was picked up by its handle (JavaScript gives the haptic: the Settings switch applies). */
  onLift: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}

const NativeQueueList: React.FC<NativeQueueListProps> = ({ onPick, onMove, onAtTop, onLift, ...rest }) => {
  if (!NativeView) return null;
  return (
    <NativeView
      {...rest}
      onPick={e => onPick(e.nativeEvent.index)}
      onMove={e => onMove(e.nativeEvent.from, e.nativeEvent.to)}
      onAtTop={e => onAtTop(e.nativeEvent.atTop)}
      onLift={e => onLift(e.nativeEvent.index)}
    />
  );
};

export default React.memo(NativeQueueList);
