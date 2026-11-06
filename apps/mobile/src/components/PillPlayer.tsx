import { seekTargetForGesture } from '../playback/seekTarget';
import { PlaybackButton } from '../ui/PlaybackButton';
/**
 * V6 mini player: a thin progress line on a separate seek band, a square cover and stable transport.
 * Sideways on the cover and title skips (left: next, right: previous) through the owner's onNext/onPrevious, so
 * local playback, Connect and LuvLink keep deciding what a skip means. Up opens the player; a tap opens it too.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, I18nManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { usePlaybackStatus } from '../hooks/usePlaybackStatus';
import { useTabBarPushStyle } from '../navigation/sheetProgress';
import { MINI_COVER_SIZE, SEEK_BAND_HEIGHT, miniRowHeight, shellNavHeight } from '../navigation/v6Shell';
import { miniPlayerLabel } from '../playback/miniPlayerLabel';
import { miniSwipe, swipeFollow } from '../playback/miniSwipe';
import { durationSV, positionSV } from '../playback/positionBus';
import { usePlayerStore } from '../store/playerStore';
import { usePositionStore } from '../store/positionStore';
import { Control, IconButton, Motion, Radius, Space, Surface, Tactile, Text } from '../ui';
import Artwork from './allegra/Artwork';
import { MiniPlayerGlow } from './MiniPlayerGlow';
import { MiniScrubber } from './MiniScrubber';
import { scrubSeconds } from '../playback/miniScrub';

interface Props {
  title: string; artist?: string; coverImageUri?: string; playing: boolean; bottom: number; sheetUp?: boolean;
  onOpen: (velocity?: number) => void; onTogglePlay: () => void; onNext: () => void; onPrevious: () => void;
  onSeek?: (time: number) => Promise<void>;
  onRetry?: () => void;
  remote?: boolean;
}

/** A skip that never lands (the queue's last song, a rejected remote command) gives the content back after this. */
const SKIP_SETTLE_MS = 1200;

const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export default function PillPlayer({ title, artist, coverImageUri, playing, remote, sheetUp, onOpen, onTogglePlay, onNext, onPrevious, onSeek, onRetry }: Props) {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const bottom = shellNavHeight(height, insets.bottom);
  const localStatus = usePlaybackStatus();
  const status = remote ? (playing ? 'playing' : 'paused') : localStatus;
  const songId = usePlayerStore(s => s.currentSongId);
  const localDuration = usePositionStore(s => s.duration);
  const duration = remote ? 0 : localDuration;
  const position = usePositionStore(s => s.position);
  const loading = status === 'loading';
  /** 0..1 while the line is being scrubbed (1.41.0: on the UI thread, no React render per frame). */
  const scrubbing = useSharedValue(0);
  const [infoWidth, setInfoWidth] = useState(1);
  const keyboard = useKeyboardVisible();
  const seekGeneration = useRef(0);
  const track = useRef(songId); track.current = songId;
  const gestureSong = useRef(songId);
  const push = useTabBarPushStyle(bottom);
  const enabled = !!onSeek && Number.isFinite(duration) && duration > 0 && !loading;
  useEffect(() => { seekGeneration.current++; gestureSong.current = songId; }, [songId, loading]);
  const commit = async (seconds: number, startedOn = track.current) => {
    if (!enabled || !track.current || !onSeek) return;
    const target = seekTargetForGesture(startedOn, track.current, seconds, duration, loading);
    if (target === null) return;
    ++seekGeneration.current;
    try { await onSeek(target); }
    catch { AccessibilityInfo.announceForAccessibility('Could not seek. Position restored.'); }
  };
  // The scrub started on this song; a skip mid-drag must not seek the next one (seekTargetForGesture refuses it).
  const commitFraction = async (fraction: number) => {
    const seconds = scrubSeconds(fraction, duration);
    if (seconds !== null) await commit(seconds, gestureSong.current);
  };
  const rowDim = useAnimatedStyle(() => ({ opacity: 1 - (1 - Control.disabledOpacity) * scrubbing.value }));

  // ── Sideways skip on the cover and title ───────────────────────────────
  const shift = useSharedValue(0);
  const fade = useSharedValue(1);
  /** The song a committed swipe is waiting to leave; null when no skip is in flight. */
  const skipping = useRef<{ from: string; dir: -1 | 1; timer: ReturnType<typeof setTimeout> } | null>(null);
  const settle = () => {
    shift.value = withTiming(0, { duration: Motion.duration.fast, easing: Motion.ease.decelerate });
    fade.value = withTiming(1, { duration: Motion.duration.fast });
  };
  const cancelSkip = () => {
    if (skipping.current) clearTimeout(skipping.current.timer);
    skipping.current = null;
  };
  // What is showing: a remote (Connect) song changes its title, not the local song id.
  const showing = `${songId ?? ''}|${title}`;
  const shownRef = useRef(showing); shownRef.current = showing;
  // A new song arrives: it slides in from the side the swipe sent the old one, or simply settles if the song changed
  // some other way (a media key, the queue ending, remote ownership moving) mid-swipe.
  useEffect(() => {
    const pending = skipping.current;
    cancelSkip();
    if (pending && pending.from !== showing && !reduceMotion) shift.value = -pending.dir * 16;
    settle();
    // Only the song identity drives this; shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing]);
  useEffect(() => () => cancelSkip(), []);
  const skip = (which: 'next' | 'previous', dx: number) => {
    cancelSkip();
    const dir: -1 | 1 = dx < 0 ? -1 : 1;
    if (!reduceMotion) shift.value = withTiming(dir * 32, { duration: Motion.duration.instant, easing: Motion.ease.accelerate });
    fade.value = withTiming(0.2, { duration: Motion.duration.instant });
    skipping.current = { from: shownRef.current, dir, timer: setTimeout(() => { skipping.current = null; settle(); }, SKIP_SETTLE_MS) };
    (which === 'next' ? onNext : onPrevious)();
  };
  const swipe = Gesture.Pan().activeOffsetX([-16, 16]).failOffsetY([-14, 14]).runOnJS(true)
    .onUpdate(e => {
      if (skipping.current) return;
      if (!reduceMotion) shift.value = swipeFollow(e.translationX);
      fade.value = 1 - Math.min(0.5, Math.abs(e.translationX) / 240);
    })
    .onEnd(e => {
      const which = miniSwipe(e.translationX, e.translationY, e.velocityX, infoWidth, I18nManager.isRTL);
      if (which) skip(which, e.translationX);
      else settle();
    })
    .onFinalize((_e, success) => { if (!success && !skipping.current) settle(); });
  const open = Gesture.Pan().activeOffsetY(-20).failOffsetX([-20, 20]).runOnJS(true).onEnd(e => { if (e.translationY < -24) onOpen(e.velocityY); });
  const infoGesture = Gesture.Race(open, swipe);
  const following = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: shift.value }] }));

  if (sheetUp || keyboard) return null;
  const rowHeight = miniRowHeight(fontScale);
  return <Animated.View style={[styles.shell, { bottom }, push]}>
    {/* 1.41.0: the mini player has its own soft, frosted cover glow; the navigation keeps the shell material. */}
    <MiniPlayerGlow uri={coverImageUri} active />
    <MiniScrubber positionSV={positionSV} durationSV={durationSV} enabled={enabled} active={scrubbing} height={SEEK_BAND_HEIGHT}
      onCommit={commitFraction}
      accessibility={{
        accessible: true, accessibilityRole: 'adjustable', accessibilityLabel: 'Song position',
        accessibilityState: { disabled: !enabled },
        accessibilityValue: { min: 0, max: duration || 1, now: position, text: `${time(position)} of ${time(duration)}` },
        accessibilityActions: [{ name: 'increment', label: 'Forward ten seconds' }, { name: 'decrement', label: 'Back ten seconds' }],
        onAccessibilityAction: e => { if (enabled) commit(usePositionStore.getState().position + (e.nativeEvent.actionName === 'increment' ? 10 : -10)); },
      }} />
    <Animated.View style={[styles.row, { height: rowHeight }, rowDim]}>
      <GestureDetector gesture={infoGesture}><View style={styles.main} onLayout={e => setInfoWidth(e.nativeEvent.layout.width)}>
        <Tactile onPress={() => onOpen()} pressScale={0.985} accessibilityRole="button" accessibilityLabel={miniPlayerLabel(title)} accessibilityHint={artist ? `By ${artist}` : undefined}
          accessibilityActions={[{ name: 'activate' }, { name: 'next', label: 'Next song' }, { name: 'previous', label: 'Previous song' }]}
          onAccessibilityAction={e => { const a = e.nativeEvent.actionName; if (a === 'next') onNext(); else if (a === 'previous') onPrevious(); else onOpen(); }}
          style={[styles.info, { height: rowHeight }]}>
          <Animated.View style={[styles.follow, following]}>
            <View style={styles.cover}><Artwork uri={coverImageUri} title={title} artist={artist} size={MINI_COVER_SIZE} style={StyleSheet.absoluteFill} /></View>
            <View style={styles.copy}><Text variant="row" style={styles.title} numberOfLines={1}>{title}</Text><Text variant="secondary" tone="secondary" numberOfLines={1}>{status === 'error' ? 'Couldn’t play · tap retry' : artist}</Text></View>
          </Animated.View>
        </Tactile>
      </View></GestureDetector>
      <PlaybackButton size={48} plain status={status} onPress={() => { if (!remote && status === 'error') (onRetry ?? onTogglePlay)(); else onTogglePlay(); }} />
      <IconButton icon="play-skip-forward" label="Next song" onPress={onNext} />
    </Animated.View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  // No fill of its own: MiniPlayerGlow is its surface (1.41.0).
  shell: { position: 'absolute', left: 0, right: 0, zIndex: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.xs },
  main: { flex: 1, minWidth: 0 }, info: { justifyContent: 'center' },
  follow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingLeft: Space.xs },
  cover: { width: MINI_COVER_SIZE, height: MINI_COVER_SIZE, borderRadius: Radius.cover, overflow: 'hidden', backgroundColor: Surface.control },
  copy: { flex: 1, minWidth: 0 }, title: { fontWeight: '600' },
});
