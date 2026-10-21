/**
 * Now Playing's backdrop, following Echo Music's player background styles
 * (Settings → Appearance → Player background style):
 *
 *   apple  — Echo's APPLE_MUSIC: the cover blurred across the screen, the
 *            sharp cover over the top 65% dissolving into it, and the motion
 *            canvas playing inside that same dissolving hero (Canvas on).
 *   blend  — "Apple + glow": apple while the cover is on show, gliding into
 *            Echo's drifting glow when lyrics open (the two cross-fade).
 *   youtube — YouTube Music: the cover's colour washing down into black, the
 *            artwork as a card (NowPlayingLyricsArea), no canvas.
 *   aura   — "Cover glow", ours: black through the middle, two tones of the
 *            cover pouring in at an angle from the top and bottom edges and
 *            drifting slowly (allegra/EdgeGlow), the artwork as a card, no canvas.
 *
 * With "Apple Music inspired" off, the sharp hero is left out and the player
 * shows a floating artwork card instead (NowPlayingLyricsArea).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { InteractionManager, View, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import AppleBackdrop, { heroHeight, usePlayerFrame } from './player/AppleBackdrop';
import GlowBackground from './player/GlowBackground';
import NativeFlowGlow, { nativeFlowGlowAvailable } from './player/NativeFlowGlow';
import NativeCanvasWash, { CANVAS_VIDEO_NATIVE_ID, nativeCanvasWashAvailable } from './player/NativeCanvasWash';
import YouTubeBackdrop from './player/YouTubeBackdrop';
import EdgeGlow from './allegra/EdgeGlow';
import { COVER_GLOW_BASE, PLAYER_LIGHTS } from './allegra/edgeGlowMath';
import { useGlowColors } from './player/useGlowColors';
import { useArtworkPalette } from './allegra/useArtworkPalette';
import CanvasVideoLayer from './CanvasVideoLayer';
import { CanvasArtwork } from '../services/canvas/types';
import { isCardPlayerBackground, useSettingsStore } from '../store/settingsStore';
import { useAppActive } from '../hooks/useAppActive';
import { diag } from '../utils/diag';

interface NowPlayingBackgroundProps {
  coverImageUri?: string;
  gradientColors: string[];
  /** Lyrics on screen. */
  showLyrics: boolean;
  canvas?: CanvasArtwork | null;
  playing?: boolean;
  onCanvasVisibleChange?: (visible: boolean) => void;
  /** A sideways swipe on the cover moves the hero with the finger. */
  shift?: SharedValue<number>;
  /** The queued artwork that enters from the other side during a cover swipe. */
  incomingCoverImageUri?: string;
}

const CROSSFADE_MS = 600;
/** After the player has opened (its sheet settles in well under this), build the glow in the background. */
const GLOW_PREMOUNT_MS = 1200;

const NowPlayingBackground: React.FC<NowPlayingBackgroundProps> = ({
  coverImageUri,
  gradientColors,
  showLyrics,
  canvas = null,
  playing = false,
  onCanvasVisibleChange,
  shift,
  incomingCoverImageUri,
}) => {
  const { frame, onLayout } = usePlayerFrame();
  // The shader only draws while this screen is the one in front.
  const focused = useIsFocused();
  const appActive = useAppActive();
  const surfaceActive = focused && appActive;
  const { width, height } = frame;
  const style = useSettingsStore(s => s.playerBackground);
  const appleInspired = useSettingsStore(s => s.appleMusicInspired);
  const palette = useArtworkPalette(coverImageUri, gradientColors);
  const incomingPalette = useArtworkPalette(incomingCoverImageUri, gradientColors);

  const glowOn = style === 'blend' && showLyrics;
  // The glow (a Skia canvas and a palette read) sat invisible under the cover on every open of the player. It is
  // built once the open has settled while this route and app are visible, or at once if lyrics are opened first,
  // and then stays, so it cross-fades both ways and a tap on lyrics never waits for it.
  const [glowWanted, setGlowWanted] = useState(glowOn && surfaceActive);
  useEffect(() => {
    if (glowWanted || style !== 'blend' || !surfaceActive) return undefined;
    if (glowOn) {
      setGlowWanted(true);
      return undefined;
    }
    let task: { cancel: () => void } | null = null;
    const t = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => setGlowWanted(true));
    }, GLOW_PREMOUNT_MS);
    return () => { clearTimeout(t); task?.cancel(); };
  }, [glowOn, glowWanted, style, surfaceActive]);
  // On Android the glow is the island's own light, drawn natively; the Skia glow (and its palette read) is the fallback.
  const nativeGlow = nativeFlowGlowAvailable();
  const glowColors = useGlowColors(style === 'blend' && glowWanted && !nativeGlow ? coverImageUri : null);

  // Apple <-> glow cross-fade.
  const glowOpacity = useSharedValue(glowOn ? 1 : 0);
  useEffect(() => {
    glowOpacity.value = withTiming(glowOn ? 1 : 0, { duration: CROSSFADE_MS });
  }, [glowOn, glowOpacity]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));

  // Echo shows the sharp cover (and the canvas inside it) only on the cover
  // view of the Apple Music player.
  const heroOn = appleInspired && !isCardPlayerBackground(style) && !showLyrics && !glowOn;
  const canvasAllowed = heroOn;

  const [canvasShown, setCanvasShown] = useState(false);
  const onVisibleChange = useCallback((visible: boolean) => {
    setCanvasShown(visible);
    onCanvasVisibleChange?.(visible);
  }, [onCanvasVisibleChange]);
  useEffect(() => {
    if (!canvasAllowed) onCanvasVisibleChange?.(false);
  }, [canvasAllowed, onCanvasVisibleChange]);

  const heroH = heroHeight(width, height);
  const washNative = nativeCanvasWashAvailable();
  // The wash eases in with the canvas and out with it.
  const washOpacity = useSharedValue(0);
  useEffect(() => {
    washOpacity.value = withTiming(canvasShown ? 1 : 0, { duration: CROSSFADE_MS });
  }, [canvasShown, washOpacity]);
  const washStyle = useAnimatedStyle(() => ({ opacity: washOpacity.value }));
  const heroFollow = useAnimatedStyle(() => {
    const x = shift ? shift.value : 0;
    return { opacity: 1 - 0.6 * Math.min(1, Math.abs(x) / Math.max(1, width)), transform: [{ translateX: x }] as const };
  });
  // The outgoing artwork follows the finger through `shift`. Its queued neighbour mirrors that move,
  // beginning just beyond the opposite edge, so the full-bleed Apple hero feels like one continuous strip.
  const incomingSlideStyle = useAnimatedStyle(() => {
    const x = shift ? shift.value : 0;
    const enteringX = x < 0 ? x + width : x > 0 ? x - width : width;
    return { transform: [{ translateX: enteringX }] as const };
  });

  useEffect(() => {
    diag('player', `background ${style}, apple inspired ${appleInspired}, lyrics ${showLyrics}, glow ${glowOn}, hero ${heroOn}, canvas ${canvas ? canvas.source : 'none'}`);
  }, [style, appleInspired, showLyrics, glowOn, heroOn, canvas]);

  if (style === 'youtube') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
        <YouTubeBackdrop palette={palette} />
      </View>
    );
  }

  if (style === 'aura') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
        <EdgeGlow palette={palette} lights={PLAYER_LIGHTS} base={COVER_GLOW_BASE} active={surfaceActive} />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {/* The cover stays under the canvas: the canvas fades in over it, and
          when it fades out (song change) the cover is what shows through —
          never an empty gap. */}
      <AppleBackdrop uri={coverImageUri} palette={palette} showHero={heroOn} frame={frame} shift={shift} />

      {canvas || canvasShown ? (
        // The canvas plays across the hero. Its veil paints the blurred room
        // back in through the hero's dissolve, so the video melts like the
        // cover; it rides inside the canvas's own fade, so cover -> video is a
        // single cross-dissolve with the shade applied exactly once. It stays
        // mounted while leaving, so CanvasVideoLayer can fade it out (lyrics
        // opened, song changed) instead of cutting it.
        <Animated.View style={[styles.hero, { height: heroH }, heroFollow]}>
          <CanvasVideoLayer
            canvas={canvasAllowed ? canvas : null}
            playing={playing && canvasAllowed && surfaceActive}
            onVisibleChange={onVisibleChange}
            scrimStrength={0}
            nativeID={washNative ? CANVAS_VIDEO_NATIVE_ID : undefined}
            overlay={<AppleBackdrop uri={coverImageUri} palette={palette} showHero={heroOn} frame={frame} veil />}
          />
        </Animated.View>
      ) : null}

      {washNative && (canvas || canvasShown) ? (
        // The room under the controls takes the video's own colours while the canvas is on show (read natively
        // off its video surface); without it the room keeps the still cover's blur.
        <Animated.View pointerEvents="none" style={[styles.wash, { top: heroH * 0.7 }, washStyle]}>
          <NativeCanvasWash active={canvasAllowed && playing && surfaceActive} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}

      {incomingCoverImageUri ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingSlideStyle]}>
          <AppleBackdrop uri={incomingCoverImageUri} palette={incomingPalette} showHero={heroOn} frame={frame} />
        </Animated.View>
      ) : null}

      {style === 'blend' && glowWanted ? (
        <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
          {nativeGlow ? (
            <NativeFlowGlow coverUri={coverImageUri} active={glowOn && surfaceActive} playing={playing} />
          ) : (
            <GlowBackground colors={glowColors} variant="player" active={glowOn && surfaceActive} />
          )}
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  hero: { position: 'absolute', top: 0, left: 0, right: 0 },
  wash: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

export default React.memo(NowPlayingBackground);
