import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import * as GestureHandler from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCanvasArtwork } from '../hooks/useCanvasArtwork';
import { createSheetProgress } from '../navigation/sheetProgress';
import { useShellMenuStore } from '../store/shellMenuStore';
import { openPlayerSheet } from '../navigation/playerSheet';
import { durationSV, isSeeking, positionSV } from '../playback/positionBus';
import CanvasVideoLayer from './CanvasVideoLayer';
import PillPlayer from './PillPlayer';
import { NativePlaybackControl } from './NativePlaybackControl';
import { NativeSkip, useNativeSkip } from './NativeSkip';
import { useSongActions } from './library/useSongActions';
import SynchronizedLyrics from './SynchronizedLyrics';
import TimelineScrubber from './TimelineScrubber';
import { YtMiniPlayer } from './YtMiniPlayer';
const { Gesture, GestureDetector } = GestureHandler;

import { Control, Glass, Motion, OnMedia, Signal, Surface, TypeScale } from '../constants/allegraTheme';
import { CLASSIC_BAR_SCRIM, CLASSIC_BAR_SONG_FALLBACK, classicBarStops } from '../constants/classicBarThemes';
import { Tactile, TactileRow } from './allegra/motion';
import { planLyricsSwap } from './player/lyricsSwap';
import { getGradientColors } from '../constants/gradients';
import { CLASSIC_MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT } from '../constants/layout';
import { usePlayer } from '../contexts/PlayerContext';
import { useIsSongLiked } from '../hooks/useIsSongLiked';
import { PILL_STACK_GAP, pillBarTop } from '../navigation/tabs';
import { useConnect } from '../services/connect/ConnectProvider';
import { notifyLuvLinkUserSeek } from '../services/luvLink/legacy/sync';
import { handleOwnedLuvLinkSeek, notifyOwnedLuvLinkUserSeek } from '../services/luvLink/sync';
import { skipBackward as sharedSkipBackward, skipForward as sharedSkipForward } from '../services/player/skipControls';
import { beginAudioLoad, endAudioLoad, playerControls, prepareNextInQueue, shouldPlayAfterLoad, takeResumePosition, usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSongsStore } from '../store/songsStore';
import { diag } from '../utils/diag';
import Artwork from './allegra/Artwork';

// Tallest the classic bar's blurred artwork ever needs to be — the full-expand
// stage is 0.915 of the screen, with headroom so the image is never the thing
// that runs out. Held constant so the Android blur bitmap is computed once.
const CLASSIC_BG_HEIGHT = Dimensions.get('window').height * 0.95;

// Transport / song row height inside the classic shell (scrubber sits on its top edge).
const CLASSIC_TRANSPORT_H = CLASSIC_MINI_PLAYER_HEIGHT;

// Touch height of the classic scrubber wrapper. The wrapper is bottom-anchored at
// (CLASSIC_TRANSPORT_H - this), so its TOP edge lands at exactly CLASSIC_TRANSPORT_H
// above the shell bottom — i.e. on the shell's top edge when collapsed, and on the
// transport row's top seam at every other stage. Keep the two in this relationship;
// the extra height below the track exists only because Android clips touch dispatch
// to the parent's bounds, which would otherwise throw away the scrubber's hitSlop.
const CLASSIC_SCRUBBER_HIT_H = 32;

// Classic shell height at the two open stages, as a fraction of screen height.
// Shared by the animated shell height and the lyrics container so the two can
// never drift apart.
const CLASSIC_HALF_RATIO = 0.54;
const CLASSIC_FULL_RATIO = 0.915;

// Soft enough to hide hard crop edges, light enough that cover colour still reads.
const CLASSIC_COVER_BLUR = Platform.OS === 'android' ? 28 : 32;
const COVER_BLEED = 20; // px the blurred image overshoots the clip on each side

// Each half of the classic bar's lyrics cross-fade on a song change. A plain number, read inside a worklet.
const LYRICS_SWAP_MS = Motion.duration.base;

// Create Animated Pressable
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ΓöÇΓöÇΓöÇ Memoized sub-panels ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Defined outside MiniPlayer so React never creates a new component type on re-render.

interface TrackInfoProps {
  title: string;
  artist: string;
  coverImageUri?: string;
  onPress: () => void;
  onBodyPress: () => void;
}
const TrackInfo = memo(({ title, artist, coverImageUri, onPress, onBodyPress }: TrackInfoProps) => (
  <>
    <Tactile onPress={(e) => { e.stopPropagation(); onPress(); }} accessibilityRole="button" accessibilityLabel={`Open player, ${title || 'Untitled'}`}>
      <Artwork
        uri={coverImageUri}
        title={title || 'Untitled'}
        artist={artist}
        size={48}
        style={styles.coverThumbnail}
      />
    </Tactile>
    <TactileRow
      onPress={(e) => { e.stopPropagation(); onBodyPress(); }}
      style={styles.info}
      wrapperStyle={styles.info}
      pressedColor={Glass.fillLight}
    >
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Text style={styles.artist} numberOfLines={1}>
        {artist || 'Unknown Artist'}
      </Text>
    </TactileRow>
  </>
));
TrackInfo.displayName = 'TrackInfo';

interface PlaybackControlsProps {
  playing: boolean;
  onToggle: (e?: any) => void;
  onSkipBack: (e?: any) => void;
  onSkipForward: (e?: any) => void;
  animatedButtonStyle: any;
  showSkipButtons?: boolean;
}
// Width the skip buttons occupy once fully grown (24px icon + 4px padding each side).
const SKIP_BUTTON_WIDTH = 32;
// The 32 dp glyph is padded out to a 48 dp touch target without moving the transport row.
const SKIP_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

const PlaybackControls = memo(({
  playing, onToggle, onSkipBack, onSkipForward, animatedButtonStyle, showSkipButtons = true,
}: PlaybackControlsProps) => {
  const reduceMotion = useReducedMotion();
  // A tap skips on Android's main thread (the island's path); the Pressable then must not skip as well.
  const nativeSkip = useNativeSkip();
  // Keep transport geometry fixed while the controls appear. Animating width
  // moved the play button and title row on every expand/collapse.
  const skipProgress = useSharedValue(showSkipButtons ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      skipProgress.value = showSkipButtons ? 1 : 0;
    } else {
      skipProgress.value = withSpring(showSkipButtons ? 1 : 0, Motion.spring.tactile);
    }
  }, [reduceMotion, showSkipButtons, skipProgress]);

  const skipBackStyle = useAnimatedStyle(() => ({
    opacity: skipProgress.value,
    transform: reduceMotion ? [] : [
      { scale: 0.55 + skipProgress.value * 0.45 },
      { translateX: (1 - skipProgress.value) * 14 },
    ],
  } as ViewStyle));

  const skipForwardStyle = useAnimatedStyle(() => ({
    opacity: skipProgress.value,
    transform: reduceMotion ? [] : [
      { scale: 0.55 + skipProgress.value * 0.45 },
      { translateX: (1 - skipProgress.value) * -14 },
    ],
  } as ViewStyle));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Animated.View pointerEvents={showSkipButtons ? 'auto' : 'none'} style={[styles.skipWrap, skipBackStyle]}>
        <NativeSkip direction={-1} enabled={nativeSkip && showSkipButtons}>
          <Tactile
            onPress={(e) => { e.stopPropagation(); if (!(nativeSkip && showSkipButtons)) onSkipBack(e); }}
            style={styles.controlButton}
            hitSlop={SKIP_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Previous song"
            accessibilityElementsHidden={!showSkipButtons}
            importantForAccessibility={showSkipButtons ? 'auto' : 'no-hide-descendants'}
          >
            <Ionicons name="play-skip-back" size={24} color={OnMedia.primary} />
          </Tactile>
        </NativeSkip>
      </Animated.View>
      <Animated.View style={animatedButtonStyle}>
        <NativePlaybackControl plain size={48} status={playing ? 'playing' : 'paused'} onPress={onToggle} />
      </Animated.View>
      <Animated.View pointerEvents={showSkipButtons ? 'auto' : 'none'} style={[styles.skipWrap, skipForwardStyle]}>
        <NativeSkip direction={1} enabled={nativeSkip && showSkipButtons}>
          <Tactile
            onPress={(e) => { e.stopPropagation(); if (!(nativeSkip && showSkipButtons)) onSkipForward(e); }}
            style={styles.controlButton}
            hitSlop={SKIP_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Next song"
            accessibilityElementsHidden={!showSkipButtons}
            importantForAccessibility={showSkipButtons ? 'auto' : 'no-hide-descendants'}
          >
            <Ionicons name="play-skip-forward" size={24} color={OnMedia.primary} />
          </Tactile>
        </NativeSkip>
      </Animated.View>
    </View>
  );
});
PlaybackControls.displayName = 'PlaybackControls';

// UIManager.setLayoutAnimationEnabledExperimental removed to avoid New Architecture warning

export const MiniPlayer: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const createOpen = useShellMenuStore(s => s.createOpen);
  const createDismissStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, createSheetProgress.value * 2) }));
  const connect = useConnect();
  const player = usePlayer();
  const currentSong = usePlayerStore(state => state.currentSong);
  const showTransliteration = usePlayerStore(state => state.showTransliteration);
  const loadedAudioId = usePlayerStore(state => state.loadedAudioId);
  const setLoadedAudioId = usePlayerStore(state => state.setLoadedAudioId);
  const hideMiniPlayer = usePlayerStore(state => state.hideMiniPlayer);
  const requestPlayback = usePlayerStore(state => state.requestPlayback);
  const storePlaying = usePlayerStore(state => state.isPlaying);
  const classicBarBgMode = useSettingsStore(state => state.classicBarBgMode);
  const insets = useSafeAreaInsets();
  const navBarStyle = useSettingsStore(state => state.navBarStyle);
  const toggleLike = useSongsStore(state => state.toggleLike);
  const isLiked = useIsSongLiked(currentSong?.id, currentSong);

  // The pill stays mounted under the player sheet so it can hand over to it
  // (PillPlayer reads the sheet's progress); anything else hides it outright.
  const hiddenOnlyBySheet = usePlayerStore(state =>
    state.miniPlayerHiddenSources.size === 1 && state.miniPlayerHiddenSources.has('NowPlaying'));
  const pillNav = navBarStyle === 'modern-pill';
  // Use store instead of navigation state to avoid root-level crashes
  const isNowPlaying = hideMiniPlayer && !(pillNav && hiddenOnlyBySheet);

  // Animation for Play/Pause Button
  const playButtonScale = useSharedValue(1);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playButtonScale.value }]
  }));

  // togglePlay reads live store state so the callback stays stable across renders.
  // A stable callback means PlaybackControls (memo'd) never re-renders just because
  // the play/pause state changed ΓÇö only when the icon prop itself changes.
  // requestPlayback routes through playerControls (setTimeout-wrapped) to avoid
  // "accessed on wrong thread" on Android, and arms the status echo guard.
  const togglePlay = useCallback((e?: any) => {
      e?.stopPropagation();
      if (!currentSong) return;

      if (reduceMotion) {
        playButtonScale.value = 1;
      } else {
        playButtonScale.value = withSequence(
            withTiming(0.82, { duration: Motion.duration.instant }),
            withSpring(1, Motion.spring.tactile)
        );
      }

      requestPlayback(!usePlayerStore.getState().isPlaying);
  }, [currentSong, requestPlayback, playButtonScale, reduceMotion]);


  const songActions = useSongActions();
  const [expanded, setExpanded] = useState(false);
  const [classicFullExpanded, setClassicFullExpanded] = useState(false);
  const [lyricExpandedAt, setLyricExpandedAt] = useState(0);
  const [showYtButton, setShowYtButton] = useState(false);
  const [showYtMini, setShowYtMini] = useState(false);
  const ytButtonOpacity = useSharedValue(0);
  const ytButtonScale = useSharedValue(0.6);
  const ytButtonTimer = useRef<NodeJS.Timeout | null>(null);
  const wasPlayingBeforeYt = useRef(false);
  const ytVideoPreview = useSettingsStore(state => state.ytVideoPreview);

  // Animation values
  const expansionProgress = useSharedValue(0); // 0 = collapsed, 1 = half-opened
  const classicFullProgress = useSharedValue(0); // 0 = half-opened, 1 = 95% full

  const screenHeight = Dimensions.get('window').height;
  // With the floating pill tab bar, the collapsed player is a matching pill
  // just above it (Apple Music style) and widens into the sheet as it expands.
  const pillMode = navBarStyle === 'modern-pill';

  const gradientColors = currentSong?.gradientId
    ? getGradientColors(currentSong.gradientId)
    : CLASSIC_BAR_SONG_FALLBACK;

  // Local state for persistent lyrics (Cross-fade support)
  const [displayedSong, setDisplayedSong] = useState(currentSong);
  const transitionOpacity = useSharedValue(1);

  // The fade-out swaps to the song playing when it ends, not the one playing when it began: a quick next then
  // previous must not leave the song in between on screen.
  const latestSongRef = useRef(currentSong);
  latestSongRef.current = currentSong;
  const showLatestSong = useCallback(() => setDisplayedSong(latestSongRef.current), []);

  // Update displayed song with cross-fade when expanded (rules in player/lyricsSwap)
  useEffect(() => {
    const swap = planLyricsSwap({
      shownId: displayedSong?.id,
      currentId: currentSong?.id,
      sameObject: currentSong === displayedSong,
      expanded,
    });
    if (swap === 'fade') {
      if (reduceMotion) {
        cancelAnimation(transitionOpacity);
        setDisplayedSong(currentSong);
        transitionOpacity.value = 1;
        return;
      }
      // Fade out -> swap -> fade in. A new timing replaces this one (its callback then gets finished=false).
      transitionOpacity.value = withTiming(0, { duration: LYRICS_SWAP_MS }, (finished) => {
        if (finished) {
          runOnJS(showLatestSong)();
          if (reduceMotion) {
            transitionOpacity.value = 1;
          } else {
            transitionOpacity.value = withTiming(1, { duration: LYRICS_SWAP_MS });
          }
        }
      });
    } else if (swap === 'cut') {
      cancelAnimation(transitionOpacity);
      setDisplayedSong(currentSong);
      transitionOpacity.value = 1;
    } else if (swap === 'refresh') {
      // Same song, new object (lyrics landed, or a skip away and back): call off any fade still running and bring
      // the lines back — even when the shared value still reads 1, so a pending fade-out cannot finish on us.
      cancelAnimation(transitionOpacity);
      if (reduceMotion) {
        transitionOpacity.value = 1;
      } else {
        transitionOpacity.value = withTiming(1, { duration: LYRICS_SWAP_MS });
      }
      if (currentSong !== displayedSong) setDisplayedSong(currentSong);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong, expanded]);

  const activeBgMode = classicBarBgMode;
  const useThemeBg = activeBgMode !== 'album-art';

  // Motion canvas only once the player is opened — a collapsed bar never
  // decodes video. Album-art backgrounds only; theme gradients stay flat.
  const canvas = useCanvasArtwork(expanded && !useThemeBg ? currentSong : null);

  const themePlayerColors = classicBarStops(activeBgMode, gradientColors);

  // Seek lock timeout (isSeeking shared value lives in positionBus)
  const seekLockTimeout = useRef<NodeJS.Timeout | null>(null);




  // Cleanup seekLock
  useEffect(() => {
    return () => {
      if (seekLockTimeout.current) clearTimeout(seekLockTimeout.current);
    };
  }, []);

  // Track if this is the first song loore)

  // Audio Sync Logic: Auto-load song if it changes in the store
  useEffect(() => {
    const syncAudio = async () => {
      if (!currentSong || !player) return;

      // If the player doesn't have this audio loaded, load it.
      // beginAudioLoad claims ownership so NowPlayingScreen — which watches the
      // same loadedAudioId — doesn't replace() the same track in parallel.
      if (loadedAudioId !== currentSong.id && currentSong.audioUri) {
        const songId = currentSong.id;
        if (!beginAudioLoad(songId)) return;
        try {
          if (__DEV__) console.log('[MiniPlayer] Syncing audio for:', currentSong.title);
          // The song is named: a load keeps the queue it sits in (and never loads another song's address).
          await player.replace(currentSong.audioUri, currentSong);
          // Skipped on while this loaded: the newer song's own load decides what is playing. Marking this
          // one loaded (and playing it) put the old audio under the new title for a moment.
          if (usePlayerStore.getState().currentSongId !== songId) return;
          setLoadedAudioId(songId);
          // Stage the following queue item in Media3 (Android) for gapless advance.
          prepareNextInQueue();
          // A recovery reload carries on from where the song stopped.
          const resumeAt = takeResumePosition(songId);
          if (resumeAt !== null) playerControls.seekTo(resumeAt);

          // The last-played song restored at launch waits for a tap; anything
          // the listener picked plays. (Keyed to that song: a fresh install
          // used to swallow its first pick because it was the "first load".)
          const play = shouldPlayAfterLoad(songId);
          requestPlayback(play);
          diag('audio', `pill loaded "${currentSong.title}", ${play ? 'play requested' : 'waits for a tap'}`);
        } catch (error) {
          if (__DEV__) console.error('[MiniPlayer] Failed to sync audio:', error);
        } finally {
          endAudioLoad(songId);
        }
      }
    };

    syncAudio();
    // audioUri too: a streamed song can arrive before its audio link resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id, currentSong?.audioUri, player, loadedAudioId, setLoadedAudioId, requestPlayback]);

  // Capture timestamp when any lyric view opens so SynchronizedLyrics can reset its scroll
  useEffect(() => {
    if (expanded || classicFullExpanded) {
      setLyricExpandedAt(Date.now());
    }
  }, [expanded, classicFullExpanded]);

  // Show YouTube button for 5s when classic bar expands (beta feature)
  useEffect(() => {
    if (expanded && ytVideoPreview && currentSong?.youtubeVideoId) {
      setShowYtButton(true);
      if (reduceMotion) {
        ytButtonOpacity.value = 1;
        ytButtonScale.value = 1;
      } else {
        ytButtonOpacity.value = withSpring(1, Motion.spring.breathe);
        ytButtonScale.value = withSpring(1, Motion.spring.breathe);
      }
      if (ytButtonTimer.current) clearTimeout(ytButtonTimer.current);
      ytButtonTimer.current = setTimeout(() => {
        if (reduceMotion) {
          ytButtonOpacity.value = 0;
          ytButtonScale.value = 0.6;
          setShowYtButton(false);
        } else {
          ytButtonOpacity.value = withTiming(0, { duration: Motion.duration.fast });
          ytButtonScale.value = withTiming(0.6, { duration: Motion.duration.fast });
          setTimeout(() => setShowYtButton(false), Motion.duration.fast);
        }
      }, 5000);
    } else {
      if (ytButtonTimer.current) clearTimeout(ytButtonTimer.current);
      if (reduceMotion) {
        ytButtonOpacity.value = 0;
        ytButtonScale.value = 0.6;
      } else {
        ytButtonOpacity.value = withTiming(0, { duration: Motion.duration.fast });
        ytButtonScale.value = withTiming(0.6, { duration: Motion.duration.fast });
      }
      setShowYtButton(false);
    }
    return () => { if (ytButtonTimer.current) clearTimeout(ytButtonTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, reduceMotion, ytVideoPreview, currentSong?.youtubeVideoId]);

  // Classic Height Animation — three stages: collapsed → half → full (95%).
  // Keep the shell at its full static height and reveal it with a bottom-anchored
  // scale. The content counter-scales so text and the transport row stay at their
  // normal size while the shell clips the lyrics during collapse.
  const classicHeightForProgress = () => {
    'worklet';
    const halfHeight = screenHeight * CLASSIC_HALF_RATIO;
    const fullHeight = screenHeight * CLASSIC_FULL_RATIO;
    const baseHeight = interpolate(
      expansionProgress.value,
      [0, 1],
      [CLASSIC_TRANSPORT_H, halfHeight],
      Extrapolation.CLAMP,
    );
    const fullExtension = interpolate(
      classicFullProgress.value,
      [0, 1],
      [0, fullHeight - halfHeight],
      Extrapolation.CLAMP,
    );
    return baseHeight + fullExtension;
  };

  const classicFullHeight = screenHeight * CLASSIC_FULL_RATIO;

  const animatedClassicShellStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scaleY: classicHeightForProgress() / classicFullHeight }],
    };
  });

  const animatedClassicContentStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: classicFullHeight / classicHeightForProgress() }],
  }));

  // The lyric viewport stays at its full-stage layout height. Its parent shell
  // clips the hidden rows during collapse, so Yoga and the ScrollView never
  // remeasure while the listener drags between stages.
  const animatedClassicLyricsStyle = useAnimatedStyle(() => {
    const expandOp = interpolate(expansionProgress.value, [0.25, 0.75], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: expandOp * transitionOpacity.value,
    };
  });

  const animatedClassicOverlayStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: classicFullHeight / classicHeightForProgress() }],
  }));

  // Classic artwork scrim — collapsed is near-solid black (readable mini bar).
  // Half/full open dissolve almost all of it so cover colour stays vivid;
  // a thin residual keeps white lyric text readable.
  const animatedClassicScrimStyle = useAnimatedStyle(() => {
    const expand = expansionProgress.value;
    const full = classicFullProgress.value;
    // half: ~0.07 · full: ~0.04
    const opacity = interpolate(expand, [0, 1], [1, 0.07], Extrapolation.CLAMP)
      - interpolate(full, [0, 1], [0, 0.03], Extrapolation.CLAMP);
    return { opacity };
  });

  // displayedSong while open, so a song change cross-fades instead of jumping.
  const songForLyrics = expanded ? displayedSong : currentSong;

  const lyricsToUse = (showTransliteration && songForLyrics?.transliteratedLyrics && songForLyrics.transliteratedLyrics.length > 0)
    ? songForLyrics.transliteratedLyrics
    : songForLyrics?.lyrics;

  // The same next / previous as Now Playing (services/player/skipControls): LuvLink first, then the queue owner,
  // and a restart past 3 s resumes through requestPlayback.
  const skipForward = useCallback(async (e?: any) => {
    e?.stopPropagation();
    await sharedSkipForward();
  }, []);

  const skipBackward = useCallback(async (e?: any) => {
    e?.stopPropagation();
    await sharedSkipBackward();
  }, []);

  // -------------------------------------------------------------------------
  // Capture the JS-state flags we need inside the worklet as shared values.
  // Reading React state inside a worklet closure is unsafe ΓÇö the closure
  // captures a stale value. Shared values are always fresh on the UI thread.
  // -------------------------------------------------------------------------
  const expandedSV = useSharedValue(false);
  const classicFullExpandedSV = useSharedValue(false);

  // Keep shared flags in sync with React state (cheap writes, no re-render).
  useEffect(() => { expandedSV.value = expanded; }, [expanded, expandedSV]);
  useEffect(() => { classicFullExpandedSV.value = classicFullExpanded; }, [classicFullExpanded, classicFullExpandedSV]);

  // Built by a factory, not shared: one Gesture instance cannot be attached to
  // more than one GestureDetector (each carries its own handler tag). The classic
  // bar needs the same stage-drag behaviour at three mount points — the transport
  // row and the two edge rails — so each gets its own instance.
  // The gestures are built before openNowPlaying exists; they reach it
  // through this ref instead of capturing it.
  const openNowPlayingRef = useRef<() => void>(() => {});
  const requestOpenNowPlaying = useCallback(() => openNowPlayingRef.current(), []);

  const settleClassicStage = (expansion: number, full: number) => {
    'worklet';
    if (reduceMotion) {
      expansionProgress.value = expansion;
      classicFullProgress.value = full;
    } else {
      expansionProgress.value = withSpring(expansion);
      classicFullProgress.value = withSpring(full);
    }
  };

  const buildStageGesture = () => Gesture.Pan()
    .activeOffsetY([-5, 5])
    .activeOffsetX([-80, 80])
    .simultaneousWithExternalGesture()
    .onUpdate((event) => {
      'worklet';
      // Horizontal swipe detection (classic full mode)
      const isHoriz =
        Math.abs(event.translationX) > Math.abs(event.translationY);
      if (
        expandedSV.value &&
        classicFullExpandedSV.value &&
        isHoriz
      ) {
        return; // Skip vertical updates during horizontal swipe
      }

      if (expandedSV.value) {
        // Two-stage expansion (half ΓåÆ full)
        if (!classicFullExpandedSV.value) {
          if (event.translationY < 0) {
            // Drag up to expand to full
            classicFullProgress.value = Math.min(
              Math.abs(event.translationY) / 200,
              1,
            );
          } else if (event.translationY > 0) {
            // Drag down to collapse from half
            expansionProgress.value = Math.max(
              1 - event.translationY / 200,
              0,
            );
          }
        } else {
          if (event.translationY > 0) {
            // Drag down from full to half
            classicFullProgress.value =
              1 - Math.min(event.translationY / 200, 1);
          }
        }
      }
    })
    .onEnd((event) => {
      'worklet';
      const isHoriz =
        Math.abs(event.translationX) > Math.abs(event.translationY);

      // Collapsed (both styles) ΓÇö swipe left/right to skip
      if (!expandedSV.value && isHoriz) {
        if (event.translationX < -60 || event.velocityX < -600) {
          runOnJS(skipForward)();
        } else if (event.translationX > 60 || event.velocityX > 600) {
          runOnJS(skipBackward)();
        }
        return;
      }

      // Swipe up opens the full Now Playing screen, as in Apple Music.
      if (!expandedSV.value && (event.translationY < -40 || event.velocityY < -500)) {
        runOnJS(requestOpenNowPlaying)();
        return;
      }

      if (
        expandedSV.value &&
        classicFullExpandedSV.value &&
        isHoriz
      ) {
        if (event.translationX < -60 || event.velocityX < -600) {
          runOnJS(skipForward)();
          return;
        } else if (event.translationX > 60 || event.velocityX > 600) {
          runOnJS(skipBackward)();
          return;
        }
      }

      if (expandedSV.value) {
        const vel = event.velocityY;
        const trans = event.translationY;

        // The shell height is the SUM of both progress values, and onUpdate moves
        // whichever one the drag direction implicates — so a drag that dips down
        // before pushing up leaves expansionProgress below 1. Every settle branch
        // must therefore pin BOTH values to that stage's canonical pair, not just
        // the one it was moving; otherwise the bar lands short of the stage by
        // (1 - expansionProgress) * (halfHeight - CLASSIC_TRANSPORT_H).
        // collapsed = (0, 0) · half = (1, 0) · full = (1, 1).
        if (!classicFullExpandedSV.value) {
          if (trans < -50 || vel < -500) {
            settleClassicStage(1, 1);
            runOnJS(setClassicFullExpanded)(true);
          } else if (trans > 50 || vel > 500) {
            settleClassicStage(0, 0);
            runOnJS(setExpanded)(false);
            runOnJS(setClassicFullExpanded)(false);
          } else {
            settleClassicStage(1, 0);
          }
        } else {
          if (trans > 50 || vel > 500) {
            settleClassicStage(1, 0);
            runOnJS(setClassicFullExpanded)(false);
          } else {
            settleClassicStage(1, 1);
          }
        }
      }
    });

  // Transport row.
  const panGesture = buildStageGesture();
  // Classic only: narrow rails down the left/right screen edges over the lyrics,
  // so the middle of the bar belongs to the lyric ScrollView and can scroll.
  const stageRailLeftGesture = buildStageGesture();
  const stageRailRightGesture = buildStageGesture();

  // The bar opens the Apple-style Now Playing screen, never the old
  // half-height sheet that sat the lyrics at the bottom of the screen.
  const onBarPress = useCallback(() => openNowPlayingRef.current(), []);

  // `velocity`: a swipe up on the pill hands its speed to the sheet.
  const openNowPlaying = useCallback((velocity?: number) => {
    if (currentSong) {
      // No global hide here: NowPlaying hides the pill through its own source
      // while it's focused and releases it as it closes. A global hide set
      // here was never cleared, so the pill vanished after the player closed.
      openPlayerSheet(currentSong.id, typeof velocity === 'number' ? velocity : 0);
      if (reduceMotion) {
        expansionProgress.value = 0;
        classicFullProgress.value = 0;
      } else {
        expansionProgress.value = withSpring(0);
        classicFullProgress.value = withSpring(0);
      }
      setExpanded(false);
      setClassicFullExpanded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong, reduceMotion]);
  openNowPlayingRef.current = openNowPlaying;
  // Fluid player: the sheet opens at the start of a drag from the pill and follows the finger (PillPlayer).
  const openNowPlayingTracking = useCallback(() => {
    if (currentSong) openPlayerSheet(currentSong.id, 0, true);
  }, [currentSong]);

  // Classic bar: tapping a lyric seeks straight to it. Stable identity matters —
  // an inline arrow here invalidated SynchronizedLyrics' renderItem callback, so
  // every MiniPlayer re-render re-rendered all ~60 memoized lyric rows.
  // Tapping a lyric line jumps the song to it. The optimistic position write is
  // load-bearing, not polish: without it the position bus keeps reporting the
  // OLD time until the native player catches up, so the lyric list follows the
  // stale position and scrolls back down to where it was playing — which reads
  // as "tapping the line did nothing".
  const handleClassicLyricSeek = useCallback(async (time: number) => {
    if (!player) return;
    if (await handleOwnedLuvLinkSeek(time)) return;
    const seekSongId = usePlayerStore.getState().currentSongId;
    const previousPosition = positionSV.value;
    isSeeking.value = true;
    positionSV.value = time;

    const wasPlaying = usePlayerStore.getState().isPlaying;
    try {
      await player.seekTo(time);
      await notifyOwnedLuvLinkUserSeek(time);
      notifyLuvLinkUserSeek(time);
      if (wasPlaying && usePlayerStore.getState().isPlaying && usePlayerStore.getState().currentSongId === seekSongId) requestPlayback(true);
    } catch (error) {
      if (usePlayerStore.getState().currentSongId === seekSongId) positionSV.value = previousPosition;
      throw error;
    } finally {
      if (seekLockTimeout.current) clearTimeout(seekLockTimeout.current);
      seekLockTimeout.current = setTimeout(() => {
        isSeeking.value = false;
      }, 280);
    }
  }, [player, requestPlayback]);






  // Placeholder check to avoid early null return (safer for Reanimated hooks)
  const isActuallyVisible = currentSong && !isNowPlaying && !connect.remotePlayback;

  if (!isActuallyVisible) return <View style={{ height: 0, opacity: 0 }} />;

  // Classic bar is a root-level sibling of the stack (after it in tree), so it
  // can paint over the tab bar if its frame intersects. Anchor with `bottom`
  // equal to the full tab chrome — never bottom:0 + margin that can collapse.
  const tabChromeH = pillMode
    ? pillBarTop(insets.bottom) + PILL_STACK_GAP
    : TAB_BAR_HEIGHT + insets.bottom;

  // The pill nav gets Echo Music's compact pill; the classic bar keeps the old UI.
  if (pillMode) {
    return (
      <>
      <PillPlayer
        title={currentSong.title}
        artist={currentSong.artist}
        coverImageUri={currentSong.coverImageUri}
        playing={storePlaying}
        bottom={tabChromeH}
        sheetUp={hiddenOnlyBySheet}
        onOpen={openNowPlaying}
        onOpenTracking={openNowPlayingTracking}
        onTogglePlay={togglePlay}
        onNext={skipForward}
        onPrevious={skipBackward}
        onRetry={() => usePlayerStore.getState().requestPlayback(true)}
        onSeek={handleClassicLyricSeek}
        onMore={() => songActions.open(currentSong, { current: true })}
        liked={isLiked}
        onToggleLike={() => { void toggleLike(currentSong.id); }}
      />
      {songActions.element}
      </>
    );
  }

  const classicShellStyle = [
    styles.container,
    styles.barContainer,
    {
      bottom: tabChromeH,
      height: classicFullHeight,
      overflow: 'hidden' as const,
      transformOrigin: 'center bottom' as const,
      // No elevation — Android elevates above the in-navigator tab bar otherwise.
      elevation: 0,
      zIndex: 10,
    },
  ];

  return (
    <Animated.View pointerEvents={createOpen ? "none" : "auto"} accessibilityElementsHidden={createOpen} importantForAccessibility={createOpen ? "no-hide-descendants" : "auto"} style={[classicShellStyle, animatedClassicShellStyle, createDismissStyle]}>
      {/* Classic background — clipped to the player shell only (no bleed into nav). */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { overflow: 'hidden' },
          ]}
        >
          {useThemeBg ? (
            <LinearGradient
              colors={themePlayerColors}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : currentSong.coverImageUri ? (
            <>
              {/* Fixed to the tallest size the bar ever reaches, anchored to the
                  bottom, rather than absoluteFill. blurRadius on Android is a CPU
                  bitmap blur that re-runs whenever the view resizes, so an image
                  that grows with the container shows the previous bitmap's hard
                  edge for a frame or two mid-expand. At a constant size the
                  bitmap is blurred once and the container just reveals more.
                  Oversized + scaled so album-art rectangle edges and blur
                  kernel roll-off sit outside the visible clip. */}
              <Image
                source={{ uri: currentSong.coverImageUri }}
                style={{
                  position: 'absolute',
                  left: -COVER_BLEED,
                  right: -COVER_BLEED,
                  bottom: -COVER_BLEED,
                  height: CLASSIC_BG_HEIGHT + COVER_BLEED * 2,
                  // Slight scale keeps blur kernel roll-off outside the clip.
                  transform: [{ scale: 1.04 }],
                }}
                resizeMode="cover"
                blurRadius={CLASSIC_COVER_BLUR}
              />
              <Animated.View style={[StyleSheet.absoluteFill, animatedClassicScrimStyle]}>
                {/* Soft tint only — expanded opacity is tiny so colour stays vivid. */}
                <LinearGradient
                  colors={CLASSIC_BAR_SCRIM}
                  locations={[0, 0.5, 1]}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Surface.deep }]} />
          )}
          <CanvasVideoLayer canvas={canvas} playing={storePlaying} scrimStrength={0.85} />
        </View>

      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.classicOverlay, animatedClassicOverlayStyle]}
      >
        {/* Scrubber stays pinned to the transport row while the shell scales. */}
        <View pointerEvents="box-none" style={styles.classicScrubberOverride}>
          <TimelineScrubber
            currentTime={positionSV}
            duration={durationSV}
            onSeek={handleClassicLyricSeek}
            showTimeLabels={false}
          />
        </View>

        {/* Beta: YouTube video preview button — floats above play/pause row. */}
        {showYtButton && (
          <Animated.View
            style={[
              styles.ytPreviewBtn,
              {
                opacity: ytButtonOpacity,
                transform: [{ scale: ytButtonScale }],
              },
            ]}
          >
            <Tactile
              onPress={() => {
                if (ytButtonTimer.current) clearTimeout(ytButtonTimer.current);
                setShowYtButton(false);
                setShowYtMini(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Watch the video"
              style={[styles.ytPreviewBtnInner, { backgroundColor: Glass.fillLight }]}
            >
              <Ionicons name="logo-youtube" size={18} color={Signal.ink} />
            </Tactile>
          </Animated.View>
        )}
      </Animated.View>

      <AnimatedPressable
        onPress={!expanded ? onBarPress : undefined}
        pointerEvents={expanded ? 'box-none' : 'auto'}
        style={[
          styles.content,
          styles.classicContent,
          animatedClassicContentStyle,
        ]}
      >
        {/* No detector around the whole column: that stole every vertical drag over the lyrics
            for the stage change, so the lyric list could never scroll. The stage drag lives on the
            transport row (the entire bar when collapsed, so swipe-to-skip works anywhere on it)
            plus the two edge rails below. */}
        {/* column-reverse keeps the track info + transport row pinned to the bottom next to the
            nav bar at every expansion stage; the lyrics grow upward above it. */}
                <View style={{ width: '100%', height: '100%', flexDirection: 'column-reverse' }}>
                  <GestureDetector gesture={panGesture}>
                    <View style={styles.classicTransportRow}>
                        <TrackInfo
                            title={currentSong.title}
                            artist={currentSong.artist || ''}
                            coverImageUri={currentSong.coverImageUri}
                            onPress={onBarPress}
                            onBodyPress={onBarPress}
                        />
                        {/* Like the currently playing song without leaving the bar. */}
                        <Tactile
                            onPress={(e) => {
                                e.stopPropagation();
                                if (currentSong) toggleLike(currentSong.id);
                            }}
                            hitSlop={12}
                            style={styles.likeButton}
                            accessibilityRole="button"
                            accessibilityLabel={isLiked ? 'Remove from liked songs' : 'Add to liked songs'}
                            accessibilityState={{ selected: isLiked }}
                        >
                            <Ionicons
                                name={isLiked ? 'checkmark-circle' : 'add-circle-outline'}
                                size={24}
                                color={isLiked ? Signal.wave : OnMedia.primary}
                            />
                        </Tactile>
                        <PlaybackControls
                            playing={storePlaying}
                            onToggle={togglePlay}
                            onSkipBack={skipBackward}
                            onSkipForward={skipForward}
                            animatedButtonStyle={animatedButtonStyle}
                            showSkipButtons={expanded}
                        />
                    </View>
                  </GestureDetector>

                    <Animated.View
                      style={[
                        styles.classicLyricsContainer,
                        { height: classicFullHeight - CLASSIC_TRANSPORT_H },
                        animatedClassicLyricsStyle,
                      ]}
                    >
                        {/* edgeFade uses native ScrollView fadingEdgeLength (no
                            MaskedView rebuild) so lyric text soft-dissolves at
                            the top/bottom instead of a black scrim. */}
                        <SynchronizedLyrics
                            lyrics={lyricsToUse || []}
                            duration={songForLyrics?.duration}
                            currentTime={positionSV}
                            onLyricPress={handleClassicLyricSeek}
                            isUserScrolling={false}
                            scrollEnabled={expanded}
                            textStyle={styles.expandedLyricText}
                            activeLinePosition={0.4}
                            songTitle={currentSong?.title}
                            topSpacerHeight={50}
                            bottomSpacerHeight={50}
                            expandedAt={lyricExpandedAt}
                            edgeFade={48}
                        />

                        {/* Stage-drag rails. Transparent strips down the far left and
                            right of the lyric area — collapsed/half/full drags start
                            here, so the lyric list owns everything between them and
                            scrolls normally. Clipped away with the rest of the block
                            when the bar is collapsed, so they cost nothing there. */}
                        <GestureDetector gesture={stageRailLeftGesture}>
                            <View style={[styles.classicStageRail, styles.classicStageRailLeft]} />
                        </GestureDetector>
                        <GestureDetector gesture={stageRailRightGesture}>
                            <View style={[styles.classicStageRail, styles.classicStageRailRight]} />
                        </GestureDetector>

                        <View style={styles.dragHandle} />
                    </Animated.View>

                </View>
      </AnimatedPressable>
      {showYtMini && currentSong?.youtubeVideoId && (
        <YtMiniPlayer
          videoId={currentSong.youtubeVideoId}
          songTitle={currentSong.title}
          onOpen={() => {
            wasPlayingBeforeYt.current = usePlayerStore.getState().isPlaying;
            if (wasPlayingBeforeYt.current) player?.pause();
          }}
          onDismiss={() => {
            if (wasPlayingBeforeYt.current) player?.play();
          }}
          onClose={() => setShowYtMini(false)}
        />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 0,
  },
  barContainer: {
    // `bottom` set inline to tabChromeH — never sit on y=0 over the nav.
    borderTopWidth: 0,
  },
  classicContent: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingHorizontal: 0,
    overflow: 'hidden',
    transformOrigin: 'center bottom',
    // Fill the shell's static max height; animatedClassicContentStyle counter-scales it.
    flex: 1,
  },
  classicOverlay: {
    zIndex: 20,
    elevation: 20,
    transformOrigin: 'center bottom',
  },
  classicTransportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CLASSIC_TRANSPORT_H,
    paddingHorizontal: 16,
    // Room for the top-edge scrubber track
    paddingTop: 8,
    width: '100%',
  },
  // Top seam of the transport row (= top of shell when collapsed). `bottom + height`
  // must equal CLASSIC_TRANSPORT_H so the wrapper's top edge is flush with the seam;
  // the track paints from the wrapper's y=0 downward. left/right 0 makes it span the
  // real screen width at runtime — the scrubber measures itself via onLayout, so no
  // width is hardcoded anywhere.
  classicScrubberOverride: {
    position: 'absolute',
    bottom: CLASSIC_TRANSPORT_H - CLASSIC_SCRUBBER_HIT_H,
    left: 0,
    right: 0,
    width: 'auto',
    height: CLASSIC_SCRUBBER_HIT_H,
    zIndex: 20,
    elevation: 0,
  },
  expandedLyricText: {
    color: OnMedia.primary,
    fontSize: TypeScale.detail,
    lineHeight: 28,
    marginVertical: 10,
    textAlign: 'center',
  },
  dragHandle: {
    position: 'absolute',
    bottom: -10,
    left: '50%',
    marginLeft: -20,
    width: 40,
    height: 4,
    backgroundColor: Glass.hairlineStrong,
    borderRadius: 2
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  // Wide enough to hit reliably with a thumb, narrow enough that the lyric text
  // (which carries 32px of its own horizontal padding) stays fully scrollable.
  classicStageRail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 36,
    zIndex: 5,
  },
  classicStageRailLeft: {
    left: 0,
  },
  classicStageRailRight: {
    right: 0,
  },
  classicLyricsContainer: {
    // A fixed max-stage height keeps the lyric ScrollView layout stable; the shell clips it.
    flexShrink: 0,
    width: '100%',
    backgroundColor: 'transparent', // Transparent to show blurred background
    paddingTop: 10,
  },
  ytPreviewBtn: {
    position: 'absolute',
    bottom: 78,
    right: 16,
    zIndex: 50,
  },
  ytPreviewBtnInner: {
    width: Control.target,
    height: Control.target,
    borderRadius: Control.target / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  coverThumbnail: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 12,
  },
  info: {
    flex: 1,
    marginRight: 12,
    justifyContent: 'center',
  },
  title: {
    fontSize: TypeScale.body,
    fontWeight: '600',
    color: OnMedia.primary,
  },
  artist: {
    fontSize: TypeScale.caption,
    color: OnMedia.muted,
    marginTop: 2,
  },
  controlButton: {
    padding: 4,
  },
  likeButton: {
    paddingHorizontal: 8,
  },
  // Always reserves transport space; visibility changes use opacity and transform.
  skipWrap: {
    width: SKIP_BUTTON_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    padding: 4,
    marginHorizontal: 2,
  },
});

export default MiniPlayer;
