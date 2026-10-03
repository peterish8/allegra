/**
 * Now Playing while another device plays over Connect. It is the same player as the local one:
 * the sheet that grows out of the pill and follows the finger down (the pill hands over to it
 * through `playerSheetProgress`), the cover's colours, the cover and lyrics stage and the
 * standard controls. What differs is where actions go: every control is a Connect command, the
 * volume is the playing device's, and a chip under the grabber says which device that is.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as GestureHandler from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SongSnapshot } from '@shared/songRef';
import type { RootStackScreenProps } from '../../types/navigation';
import { useConnect } from '../../services/connect/ConnectProvider';
import { useConnectPositionStore } from '../../services/connect/remotePositionStore';
import { toggleOnlineLike } from '../../services/sync/onlineLike';
import { lyricaService } from '../../services/LyricaService';
import { extractAlbumColors } from '../../services/NativePalette';
import { usePlayerStore } from '../../store/playerStore';
import { usePlaylistStore } from '../../store/playlistStore';
import { useSongsStore } from '../../store/songsStore';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { libraryLookup, matchKey } from '../../utils/downloadState';
import { isSeeking } from '../../playback/positionBus';
import { safeGoBack } from '../../utils/navigationService';
import { DISMISS_DISTANCE, DISMISS_VELOCITY, takeOpenVelocity } from '../../navigation/playerSheet';
import { playerSheetRest, tabBarTopFromBottom } from '../../navigation/tabs';
import { playerSheetProgress } from '../../navigation/sheetProgress';
import { Signal } from '../../constants/allegraTheme';
import * as Haptics from '../../utils/haptics';
import NowPlayingBackground from '../NowPlayingBackground';
import NowPlayingHeader from '../NowPlayingHeader';
import NowPlayingLyricsArea, { CONTROLS_CLEARANCE, HEADER_CLEARANCE, LYRICS_MORPH_MS } from '../NowPlayingLyricsArea';
import NowPlayingControls from '../NowPlayingControls';
import type { SynchronizedLyricsRef } from '../SynchronizedLyrics';
import { PlayerSheet, SheetScrollView } from '../player/PlayerSheet';
import Artwork from '../allegra/Artwork';

const { Gesture, GestureDetector } = GestureHandler;

type Props = RootStackScreenProps<'NowPlaying'>;

// The local player's sheet physics (screens/NowPlayingScreen.tsx), so both feel the same.
const criticallyDamped = (stiffness: number) => ({ stiffness, damping: 2 * Math.sqrt(stiffness), mass: 1, overshootClamping: true }) as const;
const SOFT_SPRING = criticallyDamped(400);
const FLING_SPRING = criticallyDamped(1500);
const CLOSE_REST = { restDisplacementThreshold: 0.5, restSpeedThreshold: 8 } as const;
const FLICK = 800;
const PAGE_DIM = 0.5;
const SHEET_CORNER = 22;
const projectMomentum = (velocity: number): number => {
  'worklet';
  return (velocity / 1000) * (0.99 / (1 - 0.99));
};
const rubberBand = (overshoot: number, dimension: number): number => {
  'worklet';
  const a = Math.abs(overshoot);
  return Math.sign(overshoot) * ((a * dimension * 0.55) / (dimension + 0.55 * a));
};
/** The remote position arrives once a second; the scrubber and lyrics glide between reports. */
const TICK_MS = 1000;
const FALLBACK_COLORS = ['#1b1a22', '#2a2833', '#08090d'];

/** Liked here: a library copy that is liked, or the song liked online (synced with the account). */
function useRemoteLike(song: SongSnapshot | undefined): { liked: boolean; toggle: () => void } {
  const key = song ? matchKey(song.title, song.artist) : null;
  const copyId = useSongsStore(state => (key ? libraryLookup(state.songs).get(key)?.id : undefined));
  const copyLiked = usePlaylistStore(state => (copyId ? state.likedSongIds.has(copyId) : false));
  const onlineLiked = useOnlineLibraryStore(state => (song ? state.likedRefs.has(song.ref) : false));
  const toggle = useCallback(() => {
    if (!song) return;
    const done = copyId ? useSongsStore.getState().toggleLike(copyId) : toggleOnlineLike(song);
    done.catch(() => undefined);
  }, [song, copyId]);
  return { liked: copyLiked || onlineLiked, toggle };
}

export const ConnectRemotePlayer: React.FC<Props> = ({ navigation }) => {
  const connect = useConnect();
  const view = connect.view;
  const song = view?.song;
  const playing = view?.isPlaying ?? false;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const screenH = Math.max(windowH, Dimensions.get('screen').height);
  const pillNav = useSettingsStore(s => s.navBarStyle) === 'modern-pill';
  const setMiniPlayerHiddenSource = usePlayerStore(state => state.setMiniPlayerHiddenSource);

  // ── Sheet: grow out of the pill, follow the finger, shrink back ──────────
  const { y: restY } = playerSheetRest(windowW, screenH, insets.bottom, pillNav);
  const sheetY = useSharedValue(restY);
  const progress = useDerivedValue(() => Math.min(1, Math.max(0, 1 - sheetY.value / restY)));
  useAnimatedReaction(() => progress.value, p => { playerSheetProgress.value = p; });
  useEffect(() => () => { playerSheetProgress.value = 0; }, []);
  const [holdRoute, setHoldRoute] = useState(true);
  const closing = useSharedValue(false);

  useEffect(() => {
    const velocity = takeOpenVelocity();
    sheetY.value = reduceMotion
      ? withTiming(0, { duration: 200 })
      : withSpring(0, { ...(velocity > FLICK ? FLING_SPRING : SOFT_SPRING), velocity: -velocity });
  // Mount only: the sheet opens once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishClose = useCallback(() => setHoldRoute(false), []);
  useEffect(() => {
    if (!holdRoute) safeGoBack(navigation);
  }, [holdRoute, navigation]);
  const revealPill = useCallback(() => setMiniPlayerHiddenSource('NowPlaying', false), [setMiniPlayerHiddenSource]);
  const animateClose = useCallback((velocity = 0) => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    runOnJS(revealPill)();
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(finishClose)();
    };
    sheetY.value = reduceMotion
      ? withTiming(restY, { duration: 200, easing: Easing.out(Easing.quad) }, done)
      : withSpring(restY, { ...(velocity > FLICK ? FLING_SPRING : SOFT_SPRING), ...CLOSE_REST, velocity: Math.max(0, velocity) }, done);
  }, [restY, reduceMotion, finishClose, revealPill, closing, sheetY]);

  useFocusEffect(useCallback(() => {
    setMiniPlayerHiddenSource('NowPlaying', true);
    return () => setMiniPlayerHiddenSource('NowPlaying', false);
  }, [setMiniPlayerHiddenSource]));

  const [queueOpen, setQueueOpen] = useState(false);
  const queueRef = useRef(queueOpen);
  queueRef.current = queueOpen;
  usePreventRemove(holdRoute, () => {
    if (queueRef.current) setQueueOpen(false);
    else animateClose(0);
  });

  // ── Lyrics and the cover ↔ lyrics morph ─────────────────────────────────
  const [showLyrics, setShowLyrics] = useState(false);
  const showLyricsSV = useSharedValue(false);
  const lyricsP = useSharedValue(0);
  const dockX = useSharedValue(0);
  const dockY = useSharedValue(0);
  useEffect(() => {
    showLyricsSV.value = showLyrics;
    lyricsP.value = reduceMotion
      ? (showLyrics ? 1 : 0)
      : withTiming(showLyrics ? 1 : 0, { duration: LYRICS_MORPH_MS, easing: Easing.bezier(0.32, 0.72, 0, 1) });
  }, [showLyrics, reduceMotion, lyricsP, showLyricsSV]);
  const lyricsOffset = useSharedValue(0);
  const flatListRef = useRef<SynchronizedLyricsRef>(null);
  const isUserScrolling = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [lyrics, setLyrics] = useState<{ timestamp: number; text: string }[]>([]);
  const songRef = song?.ref;
  const songTitle = song?.title;
  const songArtist = song?.artist;
  const songDuration = song?.duration;
  useEffect(() => {
    let current = true;
    setLyrics([]);
    if (!songRef || !songTitle) return () => { current = false; };
    lyricaService.fetchLyrics(songTitle, songArtist, false, songDuration)
      .then(result => {
        if (current && result?.lyrics) setLyrics(lyricaService.parseLrc(result.lyrics, songDuration));
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [songRef, songTitle, songArtist, songDuration]);

  // ── The cover's colours ─────────────────────────────────────────────────
  const [colors, setColors] = useState<string[]>(FALLBACK_COLORS);
  const artwork = song?.artwork;
  useEffect(() => {
    let current = true;
    if (!artwork) { setColors(FALLBACK_COLORS); return () => { current = false; }; }
    extractAlbumColors(artwork).then(swatches => {
      if (!current || !swatches) return;
      setColors([
        swatches.darkVibrant?.color ?? swatches.dominant?.color ?? '#111',
        swatches.vibrant?.color ?? swatches.dominant?.color ?? '#333',
        swatches.darkMuted?.color ?? '#000',
      ]);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [artwork]);

  // ── Position: glide between the once-a-second reports ───────────────────
  const remotePosition = useConnectPositionStore(state => state.positionSec);
  const livePos = useSharedValue(remotePosition);
  const liveDur = useSharedValue(Math.max(0, songDuration ?? 0));
  useEffect(() => { liveDur.value = Math.max(0, songDuration ?? 0); }, [songDuration, liveDur]);
  useEffect(() => {
    if (isSeeking.value) return;
    cancelAnimation(livePos);
    livePos.value = remotePosition;
    const end = liveDur.value;
    if (playing && !reduceMotion && end > 0) {
      livePos.value = withTiming(Math.min(end, remotePosition + TICK_MS / 1000), { duration: TICK_MS, easing: Easing.linear });
    }
  }, [remotePosition, playing, reduceMotion, livePos, liveDur]);

  // ── Volume of the device that plays ─────────────────────────────────────
  const remoteVolume = view?.volume ?? 1;
  const volumeLevel = useSharedValue(remoteVolume);
  useEffect(() => { volumeLevel.value = remoteVolume; }, [remoteVolume, volumeLevel]);

  const control = connect.control;
  const seek = useCallback((seconds: number) => {
    // A scrub is a finger on a slider: whatever Connect makes of it, it must not end the app. A
    // position that is not a number (an unknown length) is not sent at all.
    if (!Number.isFinite(seconds)) return;
    try {
      const end = Math.max(1, liveDur.value);
      control({ kind: 'seek', sec: Math.max(0, Math.min(end, seconds)) });
    } catch { /* the scrubber settles on the next report from the playing device */ }
  }, [control, liveDur]);
  const like = useRemoteLike(song);

  // ── Drag down to close (the lyrics list keeps a drag that starts on it) ─
  const grabY = useSharedValue(0);
  const frameH = useSharedValue(screenH);
  const lyricsTop = insets.top + HEADER_CLEARANCE;
  const dismissGesture = Gesture.Pan()
    .enabled(!queueOpen)
    .activeOffsetY(12)
    .failOffsetY(-10)
    .failOffsetX([-24, 24])
    .onTouchesDown((e, state) => {
      'worklet';
      if (closing.value) { state.fail(); return; }
      const y = e.allTouches[0] ? e.allTouches[0].y : 0;
      if (showLyricsSV.value && lyricsOffset.value > 2 && y > lyricsTop && y < frameH.value - CONTROLS_CLEARANCE) state.fail();
    })
    .onStart(() => {
      'worklet';
      grabY.value = sheetY.value;
    })
    .onUpdate(e => {
      'worklet';
      const y = grabY.value + e.translationY;
      sheetY.value = y >= 0 ? Math.min(y, restY) : rubberBand(y, 120);
    })
    .onEnd(e => {
      'worklet';
      const landing = sheetY.value + projectMomentum(e.velocityY);
      if ((landing > screenH * DISMISS_DISTANCE && e.velocityY > -200) || e.velocityY > DISMISS_VELOCITY) {
        animateClose(e.velocityY);
      } else {
        sheetY.value = withSpring(0, { ...(Math.abs(e.velocityY) > FLICK ? FLING_SPRING : SOFT_SPRING), velocity: e.velocityY });
      }
    });

  // As in NowPlayingScreen: the sheet ends at the bottom bar's top while it is closed and reaches the screen's bottom once
  // open, the bar sliding down under that edge (useTabBarPushStyle) — the bar never pops out from
  // under a sheet that covered it. The clip moves up by the gap and the sheet down by it, so the
  // sheet stays where it was and only its bottom edge is cut. Transforms only.
  const barTop = tabBarTopFromBottom(insets.bottom, pillNav);
  const sheetClipStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -(1 - progress.value) * barTop }] }));
  const sheetStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const corner = SHEET_CORNER * (1 - interpolate(p, [0.9, 1], [0, 1], Extrapolation.CLAMP));
    return {
      opacity: reduceMotion ? p : 1,
      borderTopLeftRadius: corner,
      borderTopRightRadius: corner,
      transform: [{ translateY: sheetY.value + (1 - p) * barTop }] as const,
    };
  });
  const playerFadeStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : interpolate(progress.value, [0.15, 0.4], [0, 1], Extrapolation.CLAMP),
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: PAGE_DIM * Math.min(1, 1.4 * Math.sqrt(Math.max(0, progress.value - 0.1))),
  }));

  const playingOn = view?.activeDevice ? { name: view.activeDevice.name, kind: view.activeDevice.kind } : null;

  return (
    <View style={styles.root}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.sheetClip, sheetClipStyle]}>
      <GestureDetector gesture={dismissGesture}>
        <Animated.View style={[styles.container, sheetStyle]} onLayout={e => { frameH.value = e.nativeEvent.layout.height; }}>
          <Animated.View style={[styles.playerLayer, playerFadeStyle]}>
            <NowPlayingBackground coverImageUri={artwork} gradientColors={colors} showLyrics={showLyrics} playing={playing} />
            <NowPlayingHeader
              animatedStyle={undefined}
              controlsVisible
              onGoBack={() => animateClose(0)}
              playingOn={playingOn}
              onPlayingOnPress={connect.openDevices}
            />

            {song && view ? (
              <>
                <View style={styles.contentArea}>
                  <NowPlayingLyricsArea
                    showLyrics={showLyrics}
                    processedLyrics={lyrics}
                    currentTime={livePos}
                    onLyricPress={seek}
                    songTitle={song.title}
                    isUserScrollingRef={isUserScrolling}
                    scrollTimeoutRef={scrollTimeoutRef}
                    flatListRef={flatListRef}
                    coverImageUri={artwork}
                    songArtist={song.artist}
                    scrollOffset={lyricsOffset}
                    lyricsP={lyricsP}
                    dockX={dockX}
                    dockY={dockY}
                  />
                </View>
                <NowPlayingControls
                  animatedStyle={undefined}
                  controlsVisible
                  storePlaying={playing}
                  currentSongTitle={song.title}
                  currentSongArtist={song.artist}
                  isCurrentSongLiked={like.liked}
                  onTogglePlay={() => control({ kind: playing ? 'pause' : 'play' })}
                  onSkipForward={() => control({ kind: 'next' })}
                  onSkipBackward={() => control({ kind: 'prev' })}
                  onToggleLike={like.toggle}
                  onToggleLyrics={() => setShowLyrics(value => !value)}
                  positionSV={livePos}
                  durationSV={liveDur}
                  onSeek={seek}
                  showLyrics={showLyrics}
                  compact={showLyrics}
                  coverImageUri={artwork}
                  lyricsP={lyricsP}
                  dockX={dockX}
                  dockY={dockY}
                  onOpenQueue={() => setQueueOpen(true)}
                  remoteVolume={{ level: volumeLevel, onCommit: v => control({ kind: 'volume', v: Math.max(0, Math.min(1, v)) }) }}
                  onOutputPress={connect.openDevices}
                  outputActive
                />
                <PlayerSheet visible={queueOpen} title="Up next" tall onClose={() => setQueueOpen(false)}>
                  <View style={styles.modes}>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync().catch(() => undefined); control({ kind: 'shuffle', on: !view.shuffle }); }}
                      style={[styles.mode, view.shuffle && styles.modeOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: view.shuffle }}
                      accessibilityLabel={view.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
                    >
                      <Ionicons name="shuffle" size={18} color={view.shuffle ? Signal.waveInk : '#fff'} />
                      <Text style={[styles.modeText, view.shuffle && styles.modeTextOn]}>Shuffle</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync().catch(() => undefined); control({ kind: 'repeat', mode: view.repeat === 'off' ? 'all' : view.repeat === 'all' ? 'one' : 'off' }); }}
                      style={[styles.mode, view.repeat !== 'off' && styles.modeOn]}
                      accessibilityRole="button"
                      accessibilityLabel={`Repeat ${view.repeat}`}
                    >
                      <MaterialCommunityIcons name={view.repeat === 'one' ? 'repeat-once' : 'repeat'} size={18} color={view.repeat !== 'off' ? Signal.waveInk : '#fff'} />
                      <Text style={[styles.modeText, view.repeat !== 'off' && styles.modeTextOn]}>{view.repeat === 'one' ? 'Repeat one' : view.repeat === 'all' ? 'Repeat all' : 'Repeat'}</Text>
                    </Pressable>
                    {view.queueEditable && view.queue.length > 0 ? (
                      <Pressable
                        onPress={() => { Haptics.selectionAsync().catch(() => undefined); control({ kind: 'queue_clear' }); }}
                        style={[styles.mode, styles.modeEnd]}
                        accessibilityRole="button"
                        accessibilityLabel="Clear the queue"
                      >
                        <Text style={styles.modeText}>Clear</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <SheetScrollView showsVerticalScrollIndicator={false}>
                    {view.queue.length ? view.queue.map((queued, index) => (
                      <View key={`${queued.ref}-${index}`} style={styles.queued}>
                        <Pressable
                          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                          onPress={() => {
                            control({ kind: 'play_song', song: queued, queue: view.queue.slice(index + 1) });
                            setQueueOpen(false);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Play ${queued.title}`}
                        >
                          <Artwork uri={queued.artwork} title={queued.title} artist={queued.artist} size={48} style={styles.rowArt} />
                          <View style={styles.rowCopy}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{queued.title}</Text>
                            <Text style={styles.rowArtist} numberOfLines={1}>{queued.artist}</Text>
                          </View>
                        </Pressable>
                        {view.queueEditable ? (
                          <>
                            {index > 0 ? (
                              <Pressable
                                style={({ pressed }) => [styles.rowAction, pressed && styles.rowPressed]}
                                onPress={() => { Haptics.selectionAsync().catch(() => undefined); control({ kind: 'queue_move', from: index, to: 0, ref: queued.ref }); }}
                                accessibilityRole="button"
                                accessibilityLabel={`Play ${queued.title} next`}
                                hitSlop={4}
                              >
                                <MaterialCommunityIcons name="arrow-collapse-up" size={20} color="rgba(255,255,255,0.7)" />
                              </Pressable>
                            ) : null}
                            <Pressable
                              style={({ pressed }) => [styles.rowAction, pressed && styles.rowPressed]}
                              onPress={() => { Haptics.selectionAsync().catch(() => undefined); control({ kind: 'queue_remove', index, ref: queued.ref }); }}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${queued.title} from the queue`}
                              hitSlop={4}
                            >
                              <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
                            </Pressable>
                          </>
                        ) : null}
                      </View>
                    )) : <Text style={styles.notice}>Nothing is queued after this song.</Text>}
                  </SheetScrollView>
                </PlayerSheet>
              </>
            ) : (
              <View style={styles.waiting}>
                <Text style={styles.notice}>Waiting for the playing device…</Text>
                <Pressable style={styles.waitingAction} onPress={connect.openDevices} accessibilityRole="button">
                  <MaterialCommunityIcons name="devices" size={19} color={Signal.waveInk} />
                  <Text style={styles.waitingActionText}>Choose a device</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheetClip: { overflow: 'hidden' },
  backdrop: { backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#0b0b0f', overflow: 'hidden' },
  playerLayer: { ...StyleSheet.absoluteFillObject },
  contentArea: { flex: 1 },
  modes: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)' },
  modeOn: { backgroundColor: Signal.wave },
  modeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modeTextOn: { color: Signal.waveInk },
  modeEnd: { marginLeft: 'auto' },
  queued: { flexDirection: 'row', alignItems: 'center' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  rowAction: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  rowArt: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden' },
  rowCopy: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowArtist: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 },
  notice: { color: 'rgba(255,255,255,0.67)', fontSize: 14, lineHeight: 20, textAlign: 'center', padding: 18 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  waitingAction: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: Signal.wave },
  waitingActionText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
});

export default ConnectRemotePlayer;
