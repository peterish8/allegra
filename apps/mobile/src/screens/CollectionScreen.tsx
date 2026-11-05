import { AppScreen } from '../components/AppScreen';
import { TypeScale } from '../constants/allegraTheme';
/**
 * A YouTube Music album or playlist: cover, title, artists, Play / Shuffle,
 * then the tracks. Taps play through the catalog (browsePlay).
 */
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Artwork from '../components/allegra/Artwork';
import { SongRow } from '../components/browse/BrowseShelf';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { playYTSongs } from '../services/stream/browsePlay';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { CollectionPage } from '../services/ytmusic/browse';
import { YTSong } from '../services/ytmusic/parsers';
import { BrowseStackParamList } from '../types/navigation';
import { Button, IconButton, Signal, Surface } from '../ui';
import * as Haptics from '../utils/haptics';

type Props = NativeStackScreenProps<BrowseStackParamList, 'Collection'>;

const COVER = 184;

const CollectionScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const { browseId, title: hintTitle, thumbnail: hintThumb } = route.params;
  const [page, setPage] = useState<CollectionPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPage(null);
    setFailed(false);
    YTMusicClient.collection(browseId)
      .then(p => { if (alive) { if (p) setPage(p); else setFailed(true); } })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [browseId]);

  const cover = page?.thumbnail ?? hintThumb;


  const play = useCallback(async (songs: YTSong[], index: number, shuffle = false) => {
    Haptics.selectionAsync().catch(() => {});
    setPending(shuffle ? null : songs[index]?.videoId ?? null);
    await playYTSongs(songs, index, { shuffle });
    setPending(null);
  }, []);

  const songs = page?.songs ?? [];
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 56 }]}>
      <Artwork uri={cover} title={page?.title ?? hintTitle ?? ''} size={COVER} priority="high" style={styles.cover} />
      <Text style={styles.title} numberOfLines={2}>{page?.title ?? hintTitle}</Text>
      {page?.artists.length ? <Text style={styles.artists} numberOfLines={1}>{page.artists.join(', ')}</Text> : null}
      {page?.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{page.subtitle}</Text> : null}
      <View style={styles.buttons}>
        <Button label="Play" icon="play" variant="primary" onPress={() => songs.length && play(songs, 0)} />
        <Button label="Shuffle" icon="shuffle" onPress={() => songs.length && play(songs, 0, true)} />
      </View>
      {!page ? (failed ? <Text style={styles.empty}>This could not be loaded.</Text> : <ActivityIndicator color="#fff" style={styles.loading} />) : null}
    </View>
  );

  return (
    <AppScreen style={styles.fill}>
      <FlatList
        data={songs}
        keyExtractor={(s, i) => `${s.videoId}-${i}`}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <SongRow song={item} pending={pending === item.videoId} onPress={() => play(songs, index)} />
        )}
        contentContainerStyle={{ paddingBottom: bottom }}
        initialNumToRender={12}
      />
      <IconButton icon="arrow-back" label="Back" onPress={() => navigation.goBack()} style={[styles.back, { top: insets.top + 8 }]} />
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Surface.base },
  header: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 16 },
  cover: { width: COVER, height: COVER, borderRadius: 12, overflow: 'hidden' },
  title: { color: Signal.ink, fontSize: TypeScale.detail, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  artists: { color: Signal.inkSoft, fontSize: TypeScale.body, marginTop: 4 },
  subtitle: { color: Signal.inkMuted, fontSize: TypeScale.meta, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  empty: { color: Signal.inkSoft, marginTop: 20 },
  loading: { marginTop: 24 },
  back: { position: 'absolute', left: 14 },
});

export default CollectionScreen;
