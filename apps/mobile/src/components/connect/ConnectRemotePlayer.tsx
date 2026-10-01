import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackScreenProps } from '../../types/navigation';
import { useConnect } from '../../services/connect/ConnectProvider';
import { useConnectPositionStore } from '../../services/connect/remotePositionStore';
import { usePlayerStore } from '../../store/playerStore';
import { lyricaService } from '../../services/LyricaService';
import SynchronizedLyrics from '../SynchronizedLyrics';
import { formatTime } from '../../utils/formatters';

type Props = RootStackScreenProps<'NowPlaying'>;

export const ConnectRemotePlayer: React.FC<Props> = ({ navigation }) => {
  const connect = useConnect();
  const view = connect.view;
  const remotePosition = useConnectPositionStore(state => state.positionSec);
  const song = view?.song;
  const songRef = song?.ref;
  const songTitle = song?.title;
  const songArtist = song?.artist;
  const songDuration = song?.duration;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [lyrics, setLyrics] = useState<ReturnType<typeof lyricaService.parseLrc>>([]);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [volumeValue, setVolumeValue] = useState<number | null>(null);

  useFocusEffect(React.useCallback(() => {
    usePlayerStore.getState().setMiniPlayerHiddenSource('NowPlaying', true);
    return () => usePlayerStore.getState().setMiniPlayerHiddenSource('NowPlaying', false);
  }, []));

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

  const seconds = scrubValue ?? remotePosition;
  const volume = volumeValue ?? view?.volume ?? 1;
  const duration = Math.max(1, song?.duration ?? 1);
  const close = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };
  const seek = (positionSec: number): void => {
    setScrubValue(null);
    connect.control({ kind: 'seek', sec: Math.max(0, Math.min(duration, positionSec)) });
  };

  if (!song || !view) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close player">
          <Ionicons name="chevron-down" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.notice}>Connect is waiting for playback information.</Text>
        <Pressable style={styles.devicesButton} onPress={connect.openDevices}>
          <Ionicons name="phone-portrait-outline" size={19} color="#fff" />
          <Text style={styles.devicesLabel}>Connect devices</Text>
        </Pressable>
      </View>
    );
  }

  const artworkSize = Math.min(width - 52, height * (showLyrics ? 0.3 : 0.47));
  const playingOn = view.activeDevice?.name ?? 'a device';
  return (
    <View style={[styles.root, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 10 }]}>
      <LinearGradient colors={['#24202d', '#100f15', '#08090d']} style={StyleSheet.absoluteFill} />
      {song.artwork ? <Image source={{ uri: song.artwork }} blurRadius={48} style={styles.backdropArt} /> : null}
      <LinearGradient colors={['rgba(8,9,13,0.35)', 'rgba(8,9,13,0.84)', '#08090d']} style={StyleSheet.absoluteFill} />
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Close player">
          <Ionicons name="chevron-down" size={25} color="#fff" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>CONNECT</Text>
          <Text style={styles.deviceName} numberOfLines={1}>Playing on {playingOn}</Text>
        </View>
        <Pressable onPress={connect.openDevices} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Choose playback device">
          <Ionicons name="phone-portrait-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {showQueue ? (
        <ScrollView style={styles.queue} contentContainerStyle={styles.queueContent}>
          <Text style={styles.queueTitle}>Up next</Text>
          {view.queue.length ? view.queue.map((queued, index) => (
            <Pressable
              key={`${queued.ref}-${index}`}
              style={({ pressed }) => [styles.queueRow, pressed && styles.queuePressed]}
              onPress={() => {
                connect.control({ kind: 'play_song', song: queued, queue: view.queue.slice(index + 1) });
                setShowQueue(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Play ${queued.title} next`}
            >
              {queued.artwork ? <Image source={{ uri: queued.artwork }} style={styles.queueArt} /> : <View style={[styles.queueArt, styles.noArt]}><Ionicons name="musical-notes" size={18} color="#aaa" /></View>}
              <View style={styles.queueCopy}>
                <Text style={styles.queueSong} numberOfLines={1}>{queued.title}</Text>
                <Text style={styles.queueArtist} numberOfLines={1}>{queued.artist}</Text>
              </View>
              <Ionicons name="play" size={18} color="#fff" />
            </Pressable>
          )) : <Text style={styles.notice}>There are no songs queued.</Text>}
        </ScrollView>
      ) : showLyrics ? (
        <View style={styles.lyrics}>
          {lyrics.length ? (
            <SynchronizedLyrics
              lyrics={lyrics}
              currentTime={remotePosition}
              onLyricPress={seek}
              songTitle={song.title}
            />
          ) : (
            <View style={styles.center}><Text style={styles.notice}>Lyrics are not available for this song.</Text></View>
          )}
        </View>
      ) : (
        <View style={styles.coverStage}>
          <View style={[styles.cover, { width: artworkSize, height: artworkSize }]}>
            {song.artwork ? <Image source={{ uri: song.artwork }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
              <View style={[StyleSheet.absoluteFill, styles.noArt]}><Ionicons name="musical-notes" size={54} color="rgba(255,255,255,0.65)" /></View>
            )}
          </View>
          <Text style={styles.title} numberOfLines={2}>{song.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text>
        </View>
      )}

      <View style={styles.transport}>
        <View style={styles.seekRow}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={duration}
            value={Math.min(duration, seconds)}
            minimumTrackTintColor="#fff"
            maximumTrackTintColor="rgba(255,255,255,0.24)"
            thumbTintColor="#fff"
            onSlidingStart={() => setScrubValue(seconds)}
            onValueChange={setScrubValue}
            onSlidingComplete={seek}
            accessibilityLabel="Playback position"
          />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(seconds)}</Text>
          <Text style={styles.time}>−{formatTime(Math.max(0, duration - seconds))}</Text>
        </View>

        <View style={styles.volumeRow}>
          <Ionicons name="volume-low" size={18} color="rgba(255,255,255,0.72)" />
          <Slider
            style={styles.volumeSlider}
            minimumValue={0}
            maximumValue={1}
            value={volume}
            minimumTrackTintColor="rgba(255,255,255,0.8)"
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor="#fff"
            onValueChange={setVolumeValue}
            onSlidingComplete={value => {
              setVolumeValue(value);
              connect.control({ kind: 'volume', v: value });
            }}
            accessibilityLabel="Playback volume"
          />
          <Ionicons name="volume-high" size={18} color="rgba(255,255,255,0.72)" />
        </View>

        <View style={styles.controls}>
          <Pressable onPress={() => connect.control({ kind: 'prev' })} style={styles.skip} accessibilityRole="button" accessibilityLabel="Previous">
            <Ionicons name="play-skip-back" size={28} color="#fff" />
          </Pressable>
          <Pressable onPress={() => connect.control({ kind: view.isPlaying ? 'pause' : 'play' })} style={styles.play} accessibilityRole="button" accessibilityLabel={view.isPlaying ? 'Pause' : 'Play'}>
            <Ionicons name={view.isPlaying ? 'pause' : 'play'} size={30} color="#111" />
          </Pressable>
          <Pressable onPress={() => connect.control({ kind: 'next' })} style={styles.skip} accessibilityRole="button" accessibilityLabel="Next">
            <Ionicons name="play-skip-forward" size={28} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.footer}>
          <Pressable onPress={() => connect.control({ kind: 'shuffle', on: !view.shuffle })} style={styles.footerAction} accessibilityRole="button" accessibilityLabel={view.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}>
            <Ionicons name="shuffle" size={22} color={view.shuffle ? '#d9e66a' : '#fff'} />
            <Text style={[styles.footerLabel, view.shuffle && styles.activeLabel]}>Shuffle</Text>
          </Pressable>
          <Pressable onPress={() => setShowLyrics(value => !value)} style={styles.footerAction} accessibilityRole="button" accessibilityLabel={showLyrics ? 'Hide lyrics' : 'Show lyrics'}>
            <Ionicons name="chatbox-ellipses-outline" size={22} color={showLyrics ? '#d9e66a' : '#fff'} />
            <Text style={styles.footerLabel}>{showLyrics ? 'Cover' : 'Lyrics'}</Text>
          </Pressable>
          <Pressable onPress={() => connect.control({ kind: 'repeat', mode: view.repeat === 'off' ? 'all' : view.repeat === 'all' ? 'one' : 'off' })} style={styles.footerAction} accessibilityRole="button" accessibilityLabel={`Repeat ${view.repeat}`}>
            <Ionicons name={view.repeat === 'one' ? 'repeat' : 'repeat'} size={22} color={view.repeat === 'off' ? '#fff' : '#d9e66a'} />
            <Text style={[styles.footerLabel, view.repeat !== 'off' && styles.activeLabel]}>{view.repeat === 'off' ? 'Repeat' : view.repeat === 'one' ? 'Repeat one' : 'Repeat all'}</Text>
          </Pressable>
          <Pressable onPress={() => connect.openDevices()} style={styles.footerAction} accessibilityRole="button" accessibilityLabel="Connect devices">
            <Ionicons name="phone-portrait-outline" size={22} color="#fff" />
            <Text style={styles.footerLabel}>Devices</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setShowQueue(value => !value)} style={styles.queueButton} accessibilityRole="button" accessibilityLabel={`Show queue, ${view.queue.length} songs up next`}>
          <Ionicons name={showQueue ? 'chevron-down' : 'list'} size={19} color="#fff" />
          <Text style={styles.queueButtonText}>{showQueue ? 'Back to player' : `Up next · ${view.queue.length}`}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08090d', overflow: 'hidden' },
  backdropArt: { position: 'absolute', left: -40, right: -40, top: -40, width: '120%', height: '72%', opacity: 0.42 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, minHeight: 52, zIndex: 1 },
  headerButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  headerCopy: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  kicker: { color: 'rgba(255,255,255,0.56)', fontSize: 11, fontWeight: '700' },
  deviceName: { color: '#fff', fontSize: 13, fontWeight: '600', marginTop: 3 },
  coverStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  cover: { borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 28 },
  noArt: { alignItems: 'center', justifyContent: 'center' },
  title: { width: '100%', color: '#fff', fontSize: 25, lineHeight: 31, fontWeight: '700', textAlign: 'center' },
  artist: { color: 'rgba(255,255,255,0.67)', fontSize: 16, marginTop: 8, textAlign: 'center' },
  lyrics: { flex: 1, minHeight: 0, paddingHorizontal: 20, paddingTop: 18 },
  queue: { flex: 1, minHeight: 0, paddingHorizontal: 20, paddingTop: 24 },
  queueContent: { gap: 8, paddingBottom: 18 },
  queueTitle: { color: '#fff', fontSize: 22, fontWeight: '700', paddingHorizontal: 4, paddingBottom: 8 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 9, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  queuePressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  queueArt: { width: 44, height: 44, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  queueCopy: { flex: 1 },
  queueSong: { color: '#fff', fontSize: 14, fontWeight: '600' },
  queueArtist: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 3 },
  transport: { paddingHorizontal: 22, paddingBottom: 10 },
  seekRow: { height: 34, justifyContent: 'center' },
  slider: { width: '100%', height: 34 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  time: { color: 'rgba(255,255,255,0.62)', fontSize: 12 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  volumeSlider: { flex: 1, height: 30 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 42, marginTop: 25 },
  skip: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  play: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 4 },
  footerAction: { minWidth: 58, alignItems: 'center', gap: 5 },
  footerLabel: { color: 'rgba(255,255,255,0.76)', fontSize: 12 },
  activeLabel: { color: '#d9e66a' },
  queueButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 42 },
  queueButtonText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 12, left: 16, zIndex: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  devicesButton: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  devicesLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  notice: { color: 'rgba(255,255,255,0.67)', fontSize: 14, textAlign: 'center', padding: 18 },
});

export default ConnectRemotePlayer;
