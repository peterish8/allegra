import { AppScreen } from '../components/AppScreen';
/**
 * A YouTube Music album or playlist: cover, title, artists, Play / Shuffle,
 * then the tracks. Taps play through the catalog (browsePlay).
 */
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SongRow } from '../components/browse/BrowseShelf';
import { heroHeight, heroImageUrl } from '../components/playlist/heroFade';
import { ImmersiveHero, ImmersiveTopBar, useHeroScroll } from '../components/playlist/ImmersiveHero';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { playYTSongs } from '../services/stream/browsePlay';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { CollectionPage } from '../services/ytmusic/browse';
import { YTSong } from '../services/ytmusic/parsers';
import { BrowseStackParamList } from '../types/navigation';
import { Button, Signal, Space, Surface } from '../ui';
import * as Haptics from '../utils/haptics';

type Props = NativeStackScreenProps<BrowseStackParamList, 'Collection'>;

const CollectionScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const scroll = useHeroScroll();
  const hero = heroHeight(width, windowHeight);
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
  const title = page?.title ?? hintTitle ?? '';
  const lines = [page?.artists.join(', ') ?? '', page?.subtitle ?? ''];
  const header = (
    <ImmersiveHero uri={heroImageUrl(cover)} title={title} lines={lines} width={width} height={hero} scrollY={scroll.y}>
      <View style={styles.buttons}>
        <Button label="Shuffle" icon="shuffle" size="compact" onPress={() => songs.length && play(songs, 0, true)} />
        <Button label="Play" icon="play" variant="primary" onPress={() => songs.length && play(songs, 0)} />
      </View>
      {!page ? (failed ? <Text style={styles.empty}>This could not be loaded.</Text> : <ActivityIndicator color={Signal.ink} style={styles.loading} />) : null}
    </ImmersiveHero>
  );

  return (
    <AppScreen staticGlow={false} style={styles.fill}>
      <Animated.FlatList
        data={songs}
        keyExtractor={(s, i) => `${s.videoId}-${i}`}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <SongRow song={item} pending={pending === item.videoId} onPress={() => play(songs, index)} />
        )}
        onScroll={scroll.onScroll}
        scrollEventThrottle={16}
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: bottom }}
        initialNumToRender={12}
      />
      <ImmersiveTopBar title={title} height={hero} scrollY={scroll.y} topInset={insets.top} onBack={() => navigation.goBack()} />
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  // Fixed pure black behind the whole page and its list: no cover colour reaches it.
  fill: { flex: 1, backgroundColor: Surface.immersive },
  buttons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  empty: { color: Signal.inkSoft, marginTop: 20, textAlign: 'center' },
  loading: { marginTop: 24 },
});

export default CollectionScreen;
