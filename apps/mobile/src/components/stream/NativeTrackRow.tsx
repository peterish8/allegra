/**
 * A song row of the Library and the download lists drawn by a Kotlin view (android/.../views/NativeTrackRowView.kt).
 * `TrackRow` keeps its React Native row as the fallback (`nativeTrackRowAvailable()`); the view only reports a tap, a
 * long press and the trailing button, and the same handlers run.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';
import { Glass, Signal } from '../../constants/allegraTheme';
import { trackRowLabel, trackRowMeta, trackRowPalette, trackRowTile } from './trackRowPayload';

interface NativeTrackRowViewProps {
  title: string;
  meta: string;
  label: string;
  cover: string;
  base: string;
  mid: string;
  spark: string;
  glyph: string;
  variant: number;
  current: boolean;
  progress: number;
  trailing: string;
  trailingLabel: string;
  palette: string;
  onPress: () => void;
  onLongPress: () => void;
  onTrailing: () => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeTrackRowViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeTrackRowViewProps>('NativeTrackRow');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeTrackRowAvailable = (): boolean => NativeView !== null;

const PALETTE = trackRowPalette(Signal, Glass.fillLight);

interface NativeTrackRowProps {
  title: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  meta?: string;
  isCurrent?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** 'refresh' shows the retry button. */
  trailingIcon?: string;
  trailingLabel?: string;
  onTrailingPress?: () => void;
  progress?: number;
}

const noop = () => {};

const NativeTrackRow: React.FC<NativeTrackRowProps> = ({
  title, artist, artwork, duration, meta, isCurrent, onPress, onLongPress, trailingIcon, trailingLabel, onTrailingPress, progress,
}) => {
  const tile = useMemo(() => trackRowTile(title, artist), [title, artist]);
  if (!NativeView) return null;
  const showTrailing = !!trailingIcon && !!onTrailingPress;
  return (
    <NativeView
      style={styles.row}
      title={title}
      meta={trackRowMeta(artist, meta, duration)}
      label={trackRowLabel(title, artist)}
      cover={artwork ?? ''}
      base={tile.base}
      mid={tile.mid}
      spark={tile.spark}
      glyph={tile.glyph}
      variant={tile.variant}
      current={!!isCurrent}
      progress={progress ?? -1}
      trailing={showTrailing ? 'refresh' : ''}
      trailingLabel={trailingLabel ?? ''}
      palette={PALETTE}
      onPress={onPress}
      onLongPress={onLongPress ?? noop}
      onTrailing={onTrailingPress ?? noop}
    />
  );
};

const styles = StyleSheet.create({
  row: { height: 64, alignSelf: 'stretch' },
});

export default React.memo(NativeTrackRow);
