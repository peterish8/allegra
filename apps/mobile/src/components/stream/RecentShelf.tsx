/**
 * Stream's "Recent" shelf and the header switch that drives it. The switch is two chips in the header (Songs,
 * Playlists); the shelf is the same six-tile grid for either, and changing the view fades the tiles out and the new
 * ones in (opacity only, 100 ms out then 160 ms in; Reduce Motion swaps at once).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Motion, Space } from '../../constants/allegraTheme';
import type { RecentView } from '../../services/stream/recentItems';
import { Chip, Text } from '../../ui';
import { ShortcutGrid, type TrackItem } from './StreamHome';

export const RecentSwitch: React.FC<{ view: RecentView; onChange: (view: RecentView) => void }> = ({ view, onChange }) => (
  <View style={styles.switch} accessibilityRole="radiogroup" accessibilityLabel="Recent: songs or playlists">
    <Chip label="Songs" selected={view === 'songs'} onPress={() => onChange('songs')} accessibilityLabel="Recent songs" />
    <Chip label="Playlists" selected={view === 'playlists'} onPress={() => onChange('playlists')} accessibilityLabel="Recent playlists" />
  </View>
);

interface ShelfProps {
  view: RecentView;
  songs: TrackItem[];
  playlists: TrackItem[];
  onPressSong: (index: number) => void;
  onLongPressSong?: (index: number) => void;
  onPressPlaylist: (index: number) => void;
}

export const RecentShelf: React.FC<ShelfProps> = ({ view, songs, playlists, onPressSong, onLongPressSong, onPressPlaylist }) => {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<RecentView>(view);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (view === shown) return;
    if (reduce) { setShown(view); return; }
    opacity.value = withTiming(0, { duration: Motion.duration.instant }, finished => {
      if (finished) runOnJS(setShown)(view);
    });
  }, [view, shown, reduce, opacity]);

  useEffect(() => {
    if (reduce) { opacity.value = 1; return; }
    opacity.value = withTiming(1, { duration: Motion.duration.fast });
  }, [shown, reduce, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }), [opacity]);
  const empty = shown === 'songs' ? songs.length === 0 : playlists.length === 0;

  return (
    <Animated.View style={fade}>
      {empty ? (
        <View style={styles.empty}>
          <Text variant="secondary" tone="secondary">
            {shown === 'songs' ? 'Songs you play will show up here.' : 'Playlists you make or change will show up here.'}
          </Text>
        </View>
      ) : shown === 'songs' ? (
        <ShortcutGrid items={songs} onPress={onPressSong} onLongPress={onLongPressSong} />
      ) : (
        <ShortcutGrid items={playlists} onPress={onPressPlaylist} />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexShrink: 1 },
  empty: { paddingHorizontal: Space.md, paddingVertical: Space.lg },
});
