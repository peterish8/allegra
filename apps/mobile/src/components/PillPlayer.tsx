import { seekTargetForGesture } from '../playback/seekTarget';
import { PlaybackButton } from '../ui/PlaybackButton';
/**
 * V6 mini player: a thin progress line on a separate seek band, a square cover and stable transport.
 * Sideways on the cover and title skips (left: next, right: previous) through the owner's onNext/onPrevious, so
 * local playback, Connect and LuvLink keep deciding what a skip means. Up opens the player; a tap opens it too.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, I18nManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
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
import { Control, Motion, Radius, Signal, Space, Surface, Tactile, Text, Typography } from '../ui';
import Marquee from './allegra/Marquee';
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
  /** 1.43.0 (Spotify's mini player): Devices, then the heart, then play. Each shows only when its owner passes it. */
  onDevices?: () => void;
  liked?: boolean;
  onToggleLike?: () => void;
}

/** A skip that never lands (the queue's last song, a rejected remote command) gives the content back after this. */
const SKIP_SETTLE_MS = 1200;

const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export default function PillPlayer({ title, artist, coverImageUri, playing, remote, sheetUp, onOpen, onTogglePlay, onNext, onPrevious, onSeek, onRetry, onDevices, liked, onToggleLike }: Props) {
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
  const skipInFlight = useSharedValue(false);
  const [displayed, setDisplayed] = useState(() => ({ songId, title, artist, coverImageUri }));
  /** The song a committed swipe is waiting to leave; null when no skip is in flight. */
  const skipping = useRef<{ from: string; dir: -1 | 1; timer: ReturnType<typeof setTimeout>; swapTimer?: ReturnType<typeof setTimeout> } | null>(null);
  const settle = () => {
    skipInFlight.value = false;
    shift.value = withTiming(0, { duration: Motion.duration.fast, easing: Motion.ease.decelerate });
    fade.value = withTiming(1, { duration: Motion.duration.fast });
  };
  const cancelSkip = () => {
    if (skipping.current) {
      clearTimeout(skipping.current.timer);
      if (skipping.current.swapTimer) clearTimeout(skipping.current.swapTimer);
    }
    skipping.current = null;
  };
  // What is showing: a remote (Connect) song changes its title, not the local song id.
  const showing = `${songId ?? ''}|${title}`;
  const shownRef = useRef(showing); shownRef.current = showing;
  // Hold the outgoing row until its 100 ms slide finishes. A restart leaves `showing` unchanged and uses the fallback.
  useEffect(() => {
    const pending = skipping.current;
    const next = { songId, title, artist, coverImageUri };
    if (pending && pending.from === showing) {
      setDisplayed(next);
      return;
    }
    if (pending && pending.from !== showing && !reduceMotion) {
      clearTimeout(pending.timer);
      if (pending.swapTimer) clearTimeout(pending.swapTimer);
      pending.swapTimer = setTimeout(() => {
        setDisplayed(next);
        skipping.current = null;
        shift.value = -pending.dir * 16;
        settle();
      }, Motion.duration.instant);
      skipping.current = pending;
      return;
    }
    cancelSkip();
    setDisplayed(next);
    settle();
    // Only the song identity drives this; shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, songId, title, artist, coverImageUri]);
  useEffect(() => () => cancelSkip(), []);
  const skip = (which: 'next' | 'previous', dx: number) => {
    cancelSkip();
    const dir: -1 | 1 = dx < 0 ? -1 : 1;
    skipInFlight.value = true;
    if (!reduceMotion) shift.value = withTiming(dir * 32, { duration: Motion.duration.instant, easing: Motion.ease.accelerate });
    fade.value = withTiming(0.2, { duration: Motion.duration.instant });
    skipping.current = { from: shownRef.current, dir, timer: setTimeout(() => { skipping.current = null; settle(); }, SKIP_SETTLE_MS) };
    (which === 'next' ? onNext : onPrevious)();
  };
  const resetGesture = () => {
    'worklet';
    skipInFlight.value = false;
    shift.value = withTiming(0, { duration: Motion.duration.fast, easing: Motion.ease.decelerate });
    fade.value = withTiming(1, { duration: Motion.duration.fast });
  };
  const rtl = I18nManager.isRTL;
  const swipe = Gesture.Pan().activeOffsetX([-16, 16]).failOffsetY([-14, 14])
    .onUpdate(e => {
      'worklet';
      if (skipInFlight.value) return;
      if (!reduceMotion) shift.value = swipeFollow(e.translationX);
      fade.value = 1 - Math.min(0.5, Math.abs(e.translationX) / 240);
    })
    .onEnd(e => {
      'worklet';
      const which = miniSwipe(e.translationX, e.translationY, e.velocityX, infoWidth, rtl);
      if (which) {
        skipInFlight.value = true;
        runOnJS(skip)(which, e.translationX);
      } else resetGesture();
    })
    .onFinalize((_e, success) => { 'worklet'; if (!success && !skipInFlight.value) resetGesture(); });
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
        <Tactile onPress={() => onOpen()} pressScale={0.985} accessibilityRole="button" accessibilityLabel={miniPlayerLabel(displayed.title)} accessibilityHint={displayed.artist ? `By ${displayed.artist}` : undefined}
          accessibilityActions={[{ name: 'activate' }, { name: 'next', label: 'Next song' }, { name: 'previous', label: 'Previous song' }]}
          onAccessibilityAction={e => { const a = e.nativeEvent.actionName; if (a === 'next') onNext(); else if (a === 'previous') onPrevious(); else onOpen(); }}
          style={[styles.info, { height: rowHeight }]}>
          <Animated.View style={[styles.follow, following]}>
            <View style={styles.cover}><Artwork uri={displayed.coverImageUri} title={displayed.title} artist={displayed.artist} size={MINI_COVER_SIZE} style={StyleSheet.absoluteFill} /></View>
            {/* 1.43.0 (owner's Spotify screenshot): the title in bold, scrolling slowly when it doesn't fit, with the
                artist on its own line under it. */}
            <View style={styles.copy}>
              <Marquee text={displayed.title} style={styles.line} active={!sheetUp} />
              <Text variant="secondary" tone="secondary" numberOfLines={1}>
                {status === 'error' ? 'Couldn’t play, tap to retry' : displayed.artist || ' '}
              </Text>
            </View>
          </Animated.View>
        </Tactile>
      </View></GestureDetector>
      {/* 1.43.0 (Spotify's mini player): Devices, the heart, then play. Next is the sideways swipe (and TalkBack's
          "Next song" action above). */}
      {/* 1.44.0 (owner: "place neatly like Spotify"): three glyphs of one size on an even rhythm, centred on the row,
          close to the right edge. Each slot is 44 wide and answers a 48dp touch. */}
      <View style={styles.actions}>
        {onDevices ? (
          <Tactile onPress={onDevices} pressScale={0.9} hitSlop={ACTION_SLOP} accessibilityRole="button" accessibilityLabel="Devices" style={styles.action}>
            <Ionicons name="phone-portrait-outline" size={ACTION_GLYPH - 2} color={Signal.ink} />
          </Tactile>
        ) : null}
        {/* Spotify's saved mark: a filled tick in a circle once saved, an outlined plus before. */}
        {onToggleLike ? (
          <Tactile onPress={onToggleLike} haptic="select" pressScale={0.9} hitSlop={ACTION_SLOP} accessibilityRole="button"
            accessibilityLabel={liked ? 'Remove from Liked songs' : 'Add to Liked songs'} accessibilityState={{ selected: !!liked }} style={styles.action}>
            <Ionicons name={liked ? 'checkmark-circle' : 'add-circle-outline'} size={ACTION_GLYPH} color={Signal.ink} />
          </Tactile>
        ) : null}
        <PlaybackButton size={48} plain status={status} onPress={() => { if (!remote && status === 'error') (onRetry ?? onTogglePlay)(); else onTogglePlay(); }} />
      </View>
    </Animated.View>
  </Animated.View>;
}
/** The right-hand controls: one glyph size, 44-wide slots (Spotify's rhythm), each answering a 48dp touch. */
const ACTION_GLYPH = 26;
const ACTION_SLOT = 44;
const ACTION_SLOP = { left: 2, right: 2, top: 0, bottom: 0 } as const;
const styles = StyleSheet.create({
  // No fill of its own: MiniPlayerGlow is its surface (1.41.0). 1.44.0 (owner): the full width of the screen, edge to
  // edge, with no border or outline of its own; the glow and the progress line are clipped to its rounded corners.
  shell: { position: 'absolute', left: 0, right: 0, zIndex: 15, borderRadius: Radius.panel, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: Space.xs, paddingRight: Space.xxs },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { width: ACTION_SLOT, height: Control.target, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 }, info: { justifyContent: 'center' },
  follow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingLeft: Space.xs },
  cover: { width: MINI_COVER_SIZE, height: MINI_COVER_SIZE, borderRadius: Radius.cover, overflow: 'hidden', backgroundColor: Surface.control },
  copy: { flex: 1, minWidth: 0 },
  line: { ...Typography.row, color: Signal.ink, fontWeight: '600' },
});
