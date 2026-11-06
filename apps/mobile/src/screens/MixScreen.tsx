import { playList } from '../services/sync/onlineSongs';
import React from 'react';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BrowseStackParamList } from '../types/navigation';
import { AppScreen } from '../components/AppScreen';
import { useSongActions } from '../components/library/useSongActions';
import { useStreamSongActions } from '../components/stream/useStreamSongActions';
import { StreamService } from '../services/stream/StreamService';
import { usePlayerStore } from '../store/playerStore';
import { Artwork, Button, IconButton, PageHeader, SongRow, Space, Text, useBottomClearance } from '../ui';

export default function MixScreen({ route, navigation }: NativeStackScreenProps<BrowseStackParamList, 'Mix'>) {
  const mix = route.params;
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const localActions = useSongActions();
  const streamActions = useStreamSongActions();
  const play = (index: number) => mix.kind === 'stream' ? StreamService.play(mix.songs, index) : playList(`mix:${mix.title}`, mix.songs, index);
  const rows = mix.kind === 'stream' ? mix.songs.map((song, index) => ({ key: song.id, title: song.title, artist: song.artist, artwork: song.highResArt, onPress: () => play(index), onActions: () => streamActions.open(song) }))
    : mix.songs.map((song, index) => ({ key: song.id, title: song.title, artist: song.artist, artwork: song.coverImageUri, onPress: () => play(index), onActions: () => localActions.open(song) }));
  return <AppScreen style={{ paddingTop: insets.top }}>
    <PageHeader title="Mix" leading={<IconButton icon="arrow-back" label="Back" onPress={() => navigation.goBack()} />} />
    <View style={styles.cover}><Artwork size={184} uri={rows[0]?.artwork} title={mix.title} style={{ width: 184, height: 184, borderRadius: 12, overflow: 'hidden' }} /><Text variant="detail" align="center">{mix.title}</Text><Text variant="meta" tone="secondary">{rows.length} songs · Made for you</Text></View>
    <View style={styles.actions}><Button label="Play mix" icon="play" variant="primary" disabled={!rows.length} onPress={() => play(0)} /></View>
    <FlashList data={rows} keyExtractor={row => row.key} renderItem={({ item }) => <SongRow {...item} />} contentContainerStyle={{ paddingBottom: bottom }} />
    {localActions.element}{streamActions.element}
  </AppScreen>;
}
const styles = StyleSheet.create({ cover: { alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.md }, actions: { alignItems: 'flex-start', paddingHorizontal: Space.md, paddingVertical: Space.sm } });
