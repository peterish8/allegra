import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppScreen } from '../components/AppScreen';
import Artwork from '../components/allegra/Artwork';
import { SongRow } from '../components/browse/BrowseShelf';
import { appendReleases, releaseKey, type ArtistReleasesPage, type YTItem } from '../services/ytmusic/browse';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { playYTSongs } from '../services/stream/browsePlay';
import type { BrowseStackParamList } from '../types/navigation';
import { Button, Chip, ChipRow, IconButton, PageHeader, Signal, Space, Surface, Tactile, Text, useBottomClearance } from '../ui';

type Props = NativeStackScreenProps<BrowseStackParamList, 'ArtistReleases'>;
export default function ArtistReleasesScreen({ route, navigation }: Props) {
  const { categories, artistName } = route.params;
  const [selected, setSelected] = useState(Math.min(route.params.selected, Math.max(0, categories.length - 1)));
  const [page, setPage] = useState<ArtistReleasesPage>({ items: categories[selected]?.items ?? [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const flight = useRef(false);
  const seenTokens = useRef(new Set<string>());
  const cache = useRef(new Map<number, ArtistReleasesPage>());
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const category = categories[selected];
  useEffect(() => {
    const turn = ++generation.current;
    const cached = cache.current.get(selected);
    setPage(cached ?? { items: category?.items ?? [] });
    setError(undefined);
    seenTokens.current.clear();
    flight.current = false;
    if (cached || !category?.more) { setLoading(false); return; }
    flight.current = true; setLoading(true);
    void YTMusicClient.artistReleases(category.more).then(next => {
      if (generation.current !== turn) return;
      if (!next) throw new Error('Could not load more releases. Your preview is still available.');
      const value = { ...next, items: appendReleases(next.items, category.items) };
      cache.current.set(selected, value); setPage(value);
    }).catch(() => {
      if (generation.current === turn) setError('Could not load more releases. Try again.');
    }).finally(() => {
      if (generation.current === turn) { flight.current = false; setLoading(false); }
    });
    return () => { if (generation.current === turn) generation.current++; };
  }, [category, selected, attempt]);

  const more = useCallback(async () => {
    const token = page.continuation;
    if (!token || flight.current || error || seenTokens.current.has(token)) return;
    const turn = generation.current;
    flight.current = true; setLoading(true);
    try {
      const next = await YTMusicClient.artistReleasesMore(token);
      if (generation.current !== turn) return;
      if (!next) throw new Error('Could not load more releases.');
      seenTokens.current.add(token);
      const value = { items: appendReleases(page.items, next.items), continuation: next.continuation === token ? undefined : next.continuation };
      cache.current.set(selected, value); setPage(value);
    } catch {
      if (generation.current === turn) setError('Could not load the next releases. Try again.');
    } finally {
      if (generation.current === turn) { flight.current = false; setLoading(false); }
    }
  }, [page, selected, error]);
  const retry = () => { cache.current.delete(selected); setAttempt(value => value + 1); };
  const renderItem = ({ item, index }: { item: YTItem; index: number }) => {
    if (item.kind === 'song') {
      const songs = page.items.flatMap(row => row.kind === 'song' ? [row.song] : []);
      return <SongRow song={item.song} onPress={() => { void playYTSongs(songs, songs.findIndex(song => song.videoId === item.song.videoId)); }} />;
    }
    return <Tactile accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} haptic="select"
      onPress={() => item.kind === 'artist' ? navigation.push('Artist', { browseId: item.browseId }) : navigation.push('Collection', { browseId: item.browseId, title: item.title, thumbnail: item.thumbnail })}
      style={styles.row}>
      <Artwork uri={item.thumbnail} title={item.title} size={index === 0 ? 96 : 80} />
      <View style={styles.copy}><Text variant="row" numberOfLines={2}>{item.title}</Text>
        {item.subtitle ? <Text tone="secondary" numberOfLines={2}>{item.subtitle}</Text> : null}</View>
    </Tactile>;
  };
  return <AppScreen staticGlow={false} style={[styles.screen, { paddingTop: insets.top }]}>
    <PageHeader title="Releases" subtitle={artistName} leading={<IconButton icon="arrow-back" label="Back" onPress={() => navigation.goBack()} />} />
    <ChipRow>{categories.map((row, index) => <Chip key={`${row.title}:${index}`} label={row.title} selected={selected === index} onPress={() => setSelected(index)} />)}</ChipRow>
    <FlatList data={page.items} keyExtractor={releaseKey} renderItem={renderItem} initialNumToRender={8} maxToRenderPerBatch={8}
      windowSize={7} onEndReached={() => { void more(); }} onEndReachedThreshold={0.5}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListHeaderComponent={<Text variant="lead" style={styles.heading}>{category?.title ?? 'Releases'}</Text>}
      ListEmptyComponent={!loading ? <Text style={styles.heading} tone="secondary">No releases available in this category.</Text> : null}
      ListFooterComponent={<View style={styles.footer}>{loading ? <ActivityIndicator color={Signal.ink} /> : null}
        {error ? <><Text tone="secondary" accessibilityLiveRegion="polite">{error}</Text><Button label="Try again" onPress={retry} /></> : null}</View>} />
  </AppScreen>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Surface.immersive },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  copy: { flex: 1, gap: Space.xs },
  heading: { marginHorizontal: Space.md, marginVertical: Space.md },
  footer: { padding: Space.md, gap: Space.sm, alignItems: 'center' },
});
