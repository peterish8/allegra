import { seekTargetForGesture } from '../playback/seekTarget';
import { PlaybackButton } from '../ui/PlaybackButton';
/** V6 mini player: separated seek target, square cover and stable transport. */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { usePlaybackStatus } from '../hooks/usePlaybackStatus';
import { useTabBarPushStyle } from '../navigation/sheetProgress';
import { shellNavHeight } from '../navigation/v6Shell';
import { durationSV, positionSV } from '../playback/positionBus';
import { usePlayerStore } from '../store/playerStore';
import { usePositionStore } from '../store/positionStore';
import { Control, IconButton, Radius, Signal, Space, Surface, Tactile, Text } from '../ui';
import Artwork from './allegra/Artwork';
import { ShellMaterial } from './ShellMaterial';

interface Props {
  title: string; artist?: string; coverImageUri?: string; playing: boolean; bottom: number; sheetUp?: boolean;
  onOpen: (velocity?: number) => void; onTogglePlay: () => void; onNext: () => void; onPrevious: () => void;
  onSeek?: (time: number) => Promise<void>;
  onRetry?: () => void;
  remote?: boolean;
}
const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export default function PillPlayer({ title, artist, coverImageUri, playing, remote, sheetUp, onOpen, onTogglePlay, onNext, onSeek, onRetry }: Props) {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottom = shellNavHeight(height, insets.bottom);
  const localStatus = usePlaybackStatus();
  const status = remote ? (playing ? 'playing' : 'paused') : localStatus;
  const songId = usePlayerStore(s => s.currentSongId);
  const localDuration = usePositionStore(s => s.duration);
  const duration = remote ? 0 : localDuration;
  const position = usePositionStore(s => s.position);
  const loading = status === 'loading';
  const [drag, setDrag] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
  const keyboard = useKeyboardVisible();
  const seekGeneration = useRef(0);
  const track = useRef(songId); track.current = songId;
  const gestureSong = useRef(songId);
  const push = useTabBarPushStyle(bottom);
  const enabled = !!onSeek && Number.isFinite(duration) && duration > 0 && !loading;
  useEffect(() => { setDrag(null); seekGeneration.current++; }, [songId, loading]);
  const fraction = useDerivedValue(() => durationSV.value > 0 ? Math.max(0, Math.min(1, positionSV.value / durationSV.value)) : 0);
  const progress = useAnimatedStyle(() => ({ transform: [{ scaleX: drag !== null && duration > 0 ? drag / duration : fraction.value }] }));
  const commit = async (seconds: number, startedOn = track.current) => {
    if (!enabled || !track.current || !onSeek) return;
    const target = seekTargetForGesture(startedOn, track.current, seconds, duration, loading);
    if (target === null) { setDrag(null); return; }
    const id = track.current;
    const generation = ++seekGeneration.current;
    try { await onSeek(target); }
    catch { AccessibilityInfo.announceForAccessibility('Could not seek. Position restored.'); }
    finally { if (generation === seekGeneration.current && id === track.current) setDrag(null); }
  };
  const pan = Gesture.Pan().enabled(enabled).activeOffsetX([-4, 4]).runOnJS(true)
    .onStart(e => { gestureSong.current = track.current; setDrag(Math.max(0, Math.min(duration, e.x / width * duration))); })
    .onUpdate(e => setDrag(Math.max(0, Math.min(duration, e.x / width * duration))))
    .onEnd(e => { commit(e.x / width * duration, gestureSong.current); })
    .onFinalize((_e, success) => { if (!success) setDrag(null); });
  const tap = Gesture.Tap().enabled(enabled).runOnJS(true).onEnd((e, success) => { if (success) commit(e.x / width * duration); });
  const open = Gesture.Pan().activeOffsetY(-20).failOffsetX([-20, 20]).runOnJS(true).onEnd(e => { if (e.translationY < -24) onOpen(e.velocityY); });
  if (sheetUp || keyboard) return null;
  return <Animated.View style={[styles.shell, { bottom }, push]}>
    <ShellMaterial uri={coverImageUri} />
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View style={styles.seek} onLayout={e => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="adjustable" accessibilityLabel="Song position"
        accessibilityState={{ disabled: !enabled }} accessibilityValue={{ min: 0, max: duration || 1, now: drag ?? position, text: `${time(drag ?? position)} of ${time(duration)}` }}
        accessibilityActions={[{ name: 'increment', label: 'Forward ten seconds' }, { name: 'decrement', label: 'Back ten seconds' }]}
        onAccessibilityAction={e => { if (enabled) commit(usePositionStore.getState().position + (e.nativeEvent.actionName === 'increment' ? 10 : -10)); }}>
        <View style={[styles.track, duration <= 0 && styles.unknown]}>{duration > 0 ? <Animated.View style={[styles.fill, progress]} /> : null}</View>
        {drag !== null && duration > 0 ? <View style={[styles.thumb, { left: Math.max(0, Math.min(width - 8, drag / duration * width - 4)) }]} /> : null}
        {drag !== null ? <View style={[styles.preview, { left: Math.max(8, Math.min(width - 140, drag / duration * width - 60)) }]}><Text variant="meta" tabular>{time(drag)} / {time(duration)}</Text></View> : null}
      </View>
    </GestureDetector>
    <View style={[styles.row, { minHeight: fontScale >= 1.6 ? 72 : 56 }, drag !== null && styles.dim]} pointerEvents={drag !== null ? 'none' : 'auto'}>
      <GestureDetector gesture={open}><View style={styles.main}><Tactile onPress={() => onOpen()} accessibilityRole="button" accessibilityLabel={`${title} by ${artist ?? 'Unknown artist'}. Open player`} style={styles.info}>
        <View style={styles.cover}><Artwork uri={coverImageUri} title={title} artist={artist} size={44} style={StyleSheet.absoluteFill} /></View>
        <View style={styles.copy}><Text variant="row" style={styles.title} numberOfLines={1}>{title}</Text><Text variant="secondary" tone="secondary" numberOfLines={1}>{status === 'error' ? 'Couldn’t play · tap retry' : artist}</Text></View>
      </Tactile></View></GestureDetector>
      <PlaybackButton size={48} status={status} onPress={() => { if (!remote && status === 'error') (onRetry ?? onTogglePlay)(); else onTogglePlay(); }} />
      <IconButton icon="play-skip-forward" label="Next song" onPress={onNext} />
    </View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  shell: { position: 'absolute', left: 0, right: 0, zIndex: 15, backgroundColor: Surface.raised },
  seek: { height: 24 }, track: { height: 2, backgroundColor: Surface.control },
  unknown: { backgroundColor: 'transparent', borderTopWidth: 2, borderStyle: 'dashed', borderColor: Signal.inkMuted },
  thumb: { position: 'absolute', top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: Signal.ink },
  fill: { height: 2, backgroundColor: Signal.wave, transformOrigin: 'left' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.xs },
  main: { flex: 1, minWidth: 0 }, info: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 56 },
  cover: { width: 44, height: 44, borderRadius: Radius.thumb, backgroundColor: Surface.control },
  copy: { flex: 1, minWidth: 0 }, title: { fontWeight: '600' },
  dim: { opacity: Control.disabledOpacity },
  preview: { position: 'absolute', bottom: 32, padding: Space.xs, borderRadius: Radius.thumb, backgroundColor: Surface.deep },
});
