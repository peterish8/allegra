/**
 * Echo's Ambient mode: the player steps away and the song's art — or its
 * motion canvas — fills the screen, with the title quietly underneath. The
 * screen stays awake. Tap anywhere (or back) to return.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CanvasArtwork } from '../../services/canvas/types';
import { Song } from '../../types/song';
import Artwork from '../allegra/Artwork';
import CanvasVideoLayer from '../CanvasVideoLayer';

interface AmbientModeProps {
  song: Song;
  canvas: CanvasArtwork | null;
  playing: boolean;
  onExit: () => void;
}

const AmbientMode: React.FC<AmbientModeProps> = ({ song, canvas, playing, onExit }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const size = Math.min(width - 56, height * 0.5, 460);

  useEffect(() => {
    activateKeepAwakeAsync('ambient').catch(() => {});
    return () => { deactivateKeepAwake('ambient').catch(() => {}); };
  }, []);

  return (
    <Animated.View entering={FadeIn.duration(360)} exiting={FadeOut.duration(260)} style={[StyleSheet.absoluteFill, styles.room]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onExit} accessibilityRole="button" accessibilityLabel="Leave ambient mode">
        {/* The cover stays under the canvas, so the clip fades in over it, never over black. */}
        <View style={styles.center}>
          <Artwork uri={song.coverImageUri} title={song.title} artist={song.artist} size={size} priority="high" continuous style={[styles.art, { width: size, height: size }]} />
        </View>
        {canvas ? <CanvasVideoLayer canvas={canvas} playing={playing} scrimStrength={0} /> : null}
        <View style={[styles.meta, { paddingBottom: insets.bottom + 36 }]} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
          {song.artist ? <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  room: { backgroundColor: '#000000', zIndex: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  art: { borderRadius: 18, overflow: 'hidden' },
  meta: { position: 'absolute', left: 32, right: 32, bottom: 0, alignItems: 'center' },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  artist: { color: 'rgba(255,255,255,0.75)', fontSize: 16, marginTop: 4 },
});

export default React.memo(AmbientMode);
