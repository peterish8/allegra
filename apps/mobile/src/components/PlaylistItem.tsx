import { Ionicons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { RenderItemParams } from 'react-native-draggable-flatlist';
import Animated, { cancelAnimation, Easing, interpolate, SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useLyricsScanQueueStore } from '../store/lyricsScanQueueStore';
import { Song } from '../types/song';
import { Glass, IconButton, Motion, OnMedia, Signal, Space, TactileRow, Text } from '../ui';
import Artwork from './allegra/Artwork';

/** Every row is this tall, so the list can lay itself out without measuring. */
export const PLAYLIST_ROW_HEIGHT = 72;

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

interface PlaylistItemProps extends Partial<RenderItemParams<Song>> {
  item: Song;
  currentSongId: string | null;
  isEditMode: boolean;
  onPress: (song: Song, index: number) => void;
  /** The song's actions sheet: the ••• and a long press. */
  onMore?: (song: Song) => void;
  onDelete: (songId: string) => void;
  isPlaying: boolean;
  displayIndex: number;
}

const VisualizerBar = ({ anim }: { anim: SharedValue<number> }) => {
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: interpolate(anim.value, [0, 1], [4 / 14, 1]) }],
    opacity: interpolate(anim.value, [0, 1], [0.5, 1]),
  }));
  return <Animated.View style={[styles.visualizerBar, style]} />;
};

/** Three bars dancing over the playing song's cover. Still (mid height) when paused or under Reduce Motion. */
const LiveVisualizer = ({ isPlaying }: { isPlaying: boolean }) => {
  const reduce = useReducedMotion();
  const sv1 = useSharedValue(0.3);
  const sv2 = useSharedValue(0.4);
  const sv3 = useSharedValue(0.3);
  const animations = React.useMemo(() => [sv1, sv2, sv3], [sv1, sv2, sv3]);

  React.useEffect(() => {
    if (!isPlaying || reduce) {
      animations.forEach(anim => { cancelAnimation(anim); anim.value = withTiming(0.5, { duration: Motion.duration.base }); });
      return;
    }
    const timers = animations.map((anim, i) => setTimeout(() => {
      anim.value = withRepeat(
        withSequence(
          withTiming(Math.random(), { duration: Motion.duration.fast, easing: Easing.linear }),
          withTiming(Math.random(), { duration: Motion.duration.instant, easing: Easing.quad }),
          withTiming(Math.random(), { duration: Motion.duration.base, easing: Easing.inOut(Easing.quad) }),
          withTiming(Math.random(), { duration: Motion.duration.instant, easing: Easing.linear }),
        ), -1, true
      );
    }, i * 50));
    return () => {
      timers.forEach(clearTimeout);
      animations.forEach(anim => cancelAnimation(anim));
    };
  }, [isPlaying, reduce, animations]);

  return (
    <View style={styles.visualizerContainer}>
      {animations.map((anim, i) => <VisualizerBar key={i} anim={anim} />)}
    </View>
  );
};

const PlaylistItemComponent: React.FC<PlaylistItemProps> = ({
  item, drag, isActive, currentSongId, isEditMode,
  onPress, onMore, onDelete, isPlaying, displayIndex
}) => {
  const isActiveSong = currentSongId === item.id && !isEditMode;
  const scanJob = useLyricsScanQueueStore(state => state.queue[item.id]);
  const isScanning = scanJob?.status === 'scanning' || scanJob?.status === 'pending';
  const hasLyrics = scanJob?.status === 'completed' || (item.lyrics?.length ?? 0) > 0;
  const artist = item.artist || 'Unknown artist';

  // A tap plays at once: no multi-tap timer in front of the common case. Finding lyrics lives in the actions sheet.
  return (
    <TactileRow
      onPress={isEditMode ? undefined : () => onPress(item, displayIndex)}
      onLongPress={isEditMode ? drag : onMore ? () => onMore(item) : undefined}
      delayLongPress={isEditMode ? 200 : 350}
      disabled={isActive}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${artist}`}
      accessibilityState={{ selected: isActiveSong }}
      accessibilityHint={isEditMode ? 'Long press and drag to move' : onMore ? 'Long press for more' : undefined}
      style={[styles.songRow, isActiveSong && styles.songRowActive, isActive && styles.songRowDragging]}
    >
      <View style={styles.leftAction}>
        {isEditMode ? (
          <IconButton icon="reorder-two" label={`Move ${item.title}`} variant="plain" size="sm" onPress={() => undefined} onLongPress={drag} />
        ) : (
          <Text variant="secondary" tone="muted" tabular>{displayIndex + 1}</Text>
        )}
      </View>

      <View style={styles.cover}>
        <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={48} style={StyleSheet.absoluteFill} />
        {isScanning ? (
          <View style={styles.coverOverlay}><Ionicons name="sync" size={16} color={OnMedia.primary} /></View>
        ) : isActiveSong ? (
          <View style={styles.coverOverlay}><LiveVisualizer isPlaying={isPlaying} /></View>
        ) : null}
      </View>

      <View style={styles.songInfo}>
        <View style={styles.titleRow}>
          <Text variant="row" tone={isActiveSong ? 'accent' : 'primary'} numberOfLines={1} style={styles.title}>{item.title}</Text>
          {hasLyrics ? <Ionicons name="checkmark-circle" size={12} color={Signal.wave} accessibilityLabel="Has lyrics" /> : null}
        </View>
        <Text variant="secondary" tone="muted" numberOfLines={1}>{artist}</Text>
      </View>

      {isEditMode ? (
        <IconButton icon="remove-circle" label={`Remove ${item.title}`} variant="plain" size="sm" onPress={() => onDelete(item.id)}>
          <Ionicons name="remove-circle" size={22} color={Signal.danger} />
        </IconButton>
      ) : (
        <>
          <Text variant="secondary" tone="muted" tabular style={styles.duration}>{formatDuration(item.duration || 0)}</Text>
          {onMore ? <IconButton icon="ellipsis-vertical" label={`More for ${item.title}`} variant="plain" size="sm" onPress={() => onMore(item)} /> : null}
        </>
      )}
    </TactileRow>
  );
};

const styles = StyleSheet.create({
  songRow: { flexDirection: 'row', alignItems: 'center', height: PLAYLIST_ROW_HEIGHT, paddingHorizontal: Space.sm, borderRadius: Space.sm, marginHorizontal: Space.xs, gap: Space.sm },
  songRowActive: { backgroundColor: Glass.fillLight },
  songRowDragging: { backgroundColor: Glass.fillPressed },
  leftAction: { width: 28, alignItems: 'center', justifyContent: 'center' },
  cover: { width: 48, height: 48, borderRadius: Space.xs, overflow: 'hidden' },
  coverOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  visualizerContainer: { flexDirection: 'row', alignItems: 'flex-end', height: 16, gap: 2 },
  visualizerBar: { width: 3, height: 14, backgroundColor: OnMedia.primary, borderRadius: 2, transformOrigin: 'bottom' },
  songInfo: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  title: { flexShrink: 1 },
  duration: { marginLeft: Space.xxs },
});

export const PlaylistItem = memo(PlaylistItemComponent, (prevProps, nextProps) => {
  const idChanged = prevProps.item.id !== nextProps.item.id;
  const activeChanged = prevProps.isActive !== nextProps.isActive;
  const editModeChanged = prevProps.isEditMode !== nextProps.isEditMode;
  const indexChanged = prevProps.displayIndex !== nextProps.displayIndex;
  const currentSongChanged = prevProps.currentSongId !== nextProps.currentSongId;
  const playingChanged = prevProps.isPlaying !== nextProps.isPlaying;
  const isActiveSong = prevProps.item.id === prevProps.currentSongId || nextProps.item.id === nextProps.currentSongId;
  if (idChanged || activeChanged || editModeChanged || indexChanged) return false;
  if ((currentSongChanged || playingChanged) && isActiveSong) return false;
  if (prevProps.onMore !== nextProps.onMore) return false;
  return true;
});
