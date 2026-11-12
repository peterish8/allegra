import { SavedQuickPicks, useSavedQuickPicks } from '../library/SavedQuickPicks';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import type { AlbumSummary } from '@shared/types';
import { CollectionCard, Button, Text, Signal, Space } from '../../ui';
import { SectionHeading } from '../allegra/home';
import { YTMusicClient } from '../../services/ytmusic/YTMusicClient';
import type { YTPageItem } from '../../services/ytmusic/browse';
import { searchAlbums } from '../../services/search/catalogSearch';
import type { SearchCategory, SearchScope } from '../../store/searchSessionStore';
import { usePlaylistStore } from '../../store/playlistStore';
import { navigationRef } from '../../utils/navigationService';
import type { Song } from '../../types/song';
interface Results { albums: AlbumSummary[]; artists: YTPageItem<'artist'>[] }
const cache = new Map<string, Results>();
export function SearchCategoryResults({ query, category, scope = 'All', localSongs = [] }: { query: string; category: SearchCategory; scope?: SearchScope; localSongs?: Song[] }) {
  const { entry: livePicks } = useSavedQuickPicks();
  const playlists = usePlaylistStore(s => s.playlists);
  const [answer, setAnswer] = useState<{ key: string; data: Results } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${query.trim().toLowerCase()}|${category}|${scope}`;
  useEffect(() => {
    if (!query.trim() || category === 'Songs' || category === 'Playlists' || scope === 'On this phone') return;
    let current = true;
    const controller = new AbortController();
    setError(null);
    const known = cache.get(key);
    if (known) { setAnswer({ key, data: known }); return; }
    const timer = setTimeout(() => {
      Promise.all([
        category === 'Artists' ? YTMusicClient.searchArtists(query) : Promise.resolve([]),
        category === 'Albums' || category === 'All' ? searchAlbums(query, controller.signal) : Promise.resolve([]),
      ]).then(([artists, albums]) => {
        if (!current) return;
        const data = { artists, albums };
        if (cache.size >= 40) cache.delete(cache.keys().next().value!);
        cache.set(key, data); setAnswer({ key, data });
      }).catch(() => { if (current) setError({ key, message: 'Could not load these results. Check your connection and try again.' }); });
    }, 350);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [key, query, category, scope, attempt]);
  if (!query.trim() || category === 'Songs') return null;
  const data = answer?.key === key ? answer.data : cache.get(key);
  const failed = error?.key === key;
  const online = category !== 'Playlists' && scope !== 'On this phone';
  const matching = playlists.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const openArtist = (name: string, browseId?: string) => navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Artist', params: { name, browseId } } });
  const localArtists = [...new Set(localSongs.map(s => s.artist).filter((a): a is string => !!a))];
  const localAlbums = [...new Set(localSongs.map(s => s.album).filter((a): a is string => !!a))];
  return <View style={styles.section}>
    {online && !data && !failed ? <ActivityIndicator accessibilityLabel={`Loading ${category.toLowerCase()} results`} color={Signal.ink} /> : null}
    {failed ? <><Text tone="secondary">{error.message}</Text><Button label="Retry results" onPress={() => setAttempt(n => n + 1)} /></> : null}
    {category === 'Artists' ? <>
      <SectionHeading title="Artists" />
      {scope === 'On this phone' ? localArtists.map(name => <Button key={name} label={name} onPress={() => openArtist(name)} />) : (data?.artists ?? []).map(artist => <Button key={artist.browseId} label={artist.title} icon="person-outline" onPress={() => openArtist(artist.title, artist.browseId)} />)}
      {((scope === 'On this phone' && !localArtists.length) || (data && !data.artists.length)) ? <Text tone="secondary">No artists match this search.</Text> : null}
    </> : null}
    {category === 'Albums' || category === 'All' ? <>
      <SectionHeading title="Albums" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
        {scope === 'On this phone' ? localAlbums.map(name => <CollectionCard key={name} title={name} meta="On this phone" onPress={() => navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Mix', params: { title: name, kind: 'local', songs: localSongs.filter(s => s.album === name) } } })} />) : (data?.albums ?? []).map(album => <CollectionCard key={album.id} title={album.name} meta={album.artist} uri={album.artwork ?? undefined} onPress={() => navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'CatalogAlbum', params: { id: album.id } } })} />)}
      </ScrollView>
      {((scope === 'On this phone' && !localAlbums.length) || (data && !data.albums.length)) ? <Text tone="secondary">No albums match this search.</Text> : null}
    </> : null}
    {category === 'Playlists' || category === 'All' ? <>
      <SectionHeading title="Your playlists" />
      <SavedQuickPicks query={query} />
      {matching.map(p => <Button key={p.id} label={p.name} icon="albums-outline" onPress={() => navigationRef.navigate('Main', { screen: 'Library', params: { screen: 'PlaylistDetail', params: { playlistId: p.id } } })} />)}
      {!matching.length && !(livePicks?.saved && 'quick picks'.includes(query.toLowerCase())) ? <Text tone="secondary">No saved playlists match this search.</Text> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { paddingHorizontal: Space.md, gap: Space.sm, paddingBottom: Space.md }, shelf: { gap: Space.sm } });
