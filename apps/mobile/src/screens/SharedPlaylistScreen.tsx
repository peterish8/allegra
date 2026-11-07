/**
 * Someone's public playlist, opened from a link or a scanned LuvLyrics code (1.44.0). The same layout as a playlist
 * of your own: the cover over its colour, the name on the left with who made it, shuffle and a round Play, then the
 * songs. "Save" puts a copy in your account (it reaches the phone with the next sync).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';
import Artwork from '../components/allegra/Artwork';
import { useArtworkPalette } from '../components/allegra/useArtworkPalette';
import { coverSizeFor, PLAYLIST_WASH_STOPS, playlistWash } from '../components/playlist/playlistPage';
import { fetchSharedPlaylist, saveSharedPlaylist, type SharedPlaylist } from '../services/share/shareService';
import { streamIdFor } from '../services/stream/streamSong';
import { StreamService } from '../services/stream/StreamService';
import { usePlayerStore } from '../store/playerStore';
import type { LibraryStackParamList } from '../types/navigation';
import { Chip, ChipRow, Control, EmptyState, GUTTER, IconButton, RowPlaceholder, Signal, SongRow, Space, Tactile, Text, useBottomClearance } from '../ui';
import { countOf } from '../utils/formatters';
import { safeGoBack } from '../utils/navigationService';
import { shuffled } from '../utils/shuffle';

export const SharedPlaylistScreen: React.FC = () => {
  const { params: { code } } = useRoute<RouteProp<LibraryStackParamList, 'SharedPlaylist'>>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const { width } = useWindowDimensions();
  const coverSize = coverSizeFor(width);
  const [playlist, setPlaylist] = useState<SharedPlaylist | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'signed-out' | 'failed'>('idle');
  const currentSongId = usePlayerStore(s => s.currentSongId);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const cover = playlist?.coverUrl ?? playlist?.songs[0]?.highResArt ?? undefined;
  const palette = useArtworkPalette(cover);

  const load = useCallback(() => {
    setState('loading');
    void fetchSharedPlaylist(code).then(found => { setPlaylist(found); setState(found ? 'ready' : 'missing'); });
  }, [code]);
  useEffect(load, [load]);

  const songs = playlist?.songs ?? [];
  const ids = songs.map(streamIdFor);
  const playingHere = currentSongId !== null && ids.includes(currentSongId);
  const play = (index: number) => { if (songs.length) StreamService.play(songs, index); };
  const playOrPause = () => {
    if (playingHere) usePlayerStore.getState().requestPlayback(!usePlayerStore.getState().isPlaying);
    else play(0);
  };
  const save = () => {
    setSaved('saving');
    void saveSharedPlaylist(code).then(setSaved);
  };

  const header = (
    <View style={styles.page}>
      <LinearGradient pointerEvents="none" colors={playlistWash(palette.primary)} locations={PLAYLIST_WASH_STOPS}
        style={[styles.wash, { height: insets.top + Control.target + coverSize + Space.xxl * 2 }]} />
      <View style={{ height: insets.top + Control.target }} />
      <View style={styles.coverRow}>
        <View style={[styles.cover, { width: coverSize, height: coverSize }]}>
          <Artwork uri={cover} title={playlist?.name ?? 'Playlist'} size={coverSize} style={StyleSheet.absoluteFill} />
        </View>
      </View>
      <Text variant="page" numberOfLines={2} accessibilityRole="header">{playlist?.name ?? ' '}</Text>
      <Text variant="secondary" tone="secondary">{playlist ? `By ${playlist.ownerName} · ${countOf(songs.length, 'song')}` : ' '}</Text>
      <View style={styles.actions}>
        <ChipRow gutter={0}>
          <Chip label={saved === 'saved' ? 'Saved' : saved === 'saving' ? 'Saving…' : 'Save'} icon={saved === 'saved' ? undefined : 'add'}
            selected={saved === 'saved'} disabled={saved === 'saving' || saved === 'saved' || !playlist} onPress={save}
            accessibilityLabel={saved === 'saved' ? 'Saved to your library' : 'Save a copy to your library'} />
        </ChipRow>
        {songs.length > 0 ? (
          <View style={styles.tools}>
            <IconButton icon="shuffle" label="Shuffle playlist" variant="plain" size="lg" haptic="select" onPress={() => StreamService.play(shuffled(songs), 0)} />
            <Tactile onPress={playOrPause} haptic="light" pressScale={0.94} accessibilityRole="button"
              accessibilityLabel={playingHere && isPlaying ? 'Pause playlist' : 'Play playlist'} style={styles.play}>
              <Ionicons name={playingHere && isPlaying ? 'pause' : 'play'} size={26} color={Signal.waveInk} style={playingHere && isPlaying ? undefined : styles.playGlyph} />
            </Tactile>
          </View>
        ) : null}
      </View>
      {saved === 'signed-out' ? <Text variant="secondary" tone="secondary">Sign in (profile menu → Settings) to save playlists to your library.</Text> : null}
      {saved === 'failed' ? <Text variant="secondary" tone="secondary">Couldn’t save it. Try again in a moment.</Text> : null}
    </View>
  );

  return (
    <AppScreen style={styles.container}>
      {state === 'missing' ? (
        <View style={[styles.missing, { paddingTop: insets.top + Control.target }]}>
          <EmptyState icon="link-outline" title="This link is not working" body="The playlist may have been made private, or the link is incomplete."
            action={{ label: 'Try again', onPress: load }} />
        </View>
      ) : (
        <FlashList
          data={songs}
          keyExtractor={item => streamIdFor(item)}
          ListHeaderComponent={header}
          ListEmptyComponent={state === 'loading' ? <View>{[0, 1, 2, 3].map(i => <RowPlaceholder key={i} />)}</View> : null}
          contentContainerStyle={{ paddingBottom: bottom }}
          renderItem={({ item, index }) => (
            <SongRow title={item.title} artist={item.artist} artwork={item.highResArt || item.thumbnail}
              playing={currentSongId === streamIdFor(item)} onPress={() => play(index)} />
          )}
        />
      )}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <IconButton icon="arrow-back" label="Back" variant="secondary" shape="disc" onPress={() => safeGoBack(navigation)} />
      </View>
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Signal.bgDeep },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', paddingHorizontal: Space.xs },
  page: { paddingHorizontal: GUTTER, paddingBottom: Space.sm, gap: Space.xxs },
  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  coverRow: { alignItems: 'center', marginTop: Space.sm, marginBottom: Space.lg },
  cover: { borderRadius: 6, overflow: 'hidden', backgroundColor: Signal.bgSubtle },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.sm },
  tools: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  play: { width: Control.target + 8, height: Control.target + 8, borderRadius: (Control.target + 8) / 2, backgroundColor: Signal.wave, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { marginLeft: 3 },
  missing: { flex: 1, justifyContent: 'center' },
});

export default SharedPlaylistScreen;
