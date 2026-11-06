import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';
import { DownloadQueueModal } from '../components/DownloadQueueModal';
import { useSongActions } from '../components/library/useSongActions';
import { useHeaderGlow } from '../hooks/useHeaderGlow';
import { registerLibraryScrollToTop } from '../navigation/libraryRoot';
import { playList } from '../services/sync/onlineSongs';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSongsStore } from '../store/songsStore';
import { LibraryStackParamList, RootStackParamList, TabParamList } from '../types/navigation';
import type { Song } from '../types/song';
import { CollectionCard, Control, EmptyState, HeaderGlow, IconButton, ListRow, PageHeader, Radius, Sheet, SheetOption, Signal, SongRow, Space, Surface, Tactile, Text, TextButton, Typography, useBottomClearance } from '../ui';
import PlaylistsScreen from './PlaylistsScreen';

type Nav = NativeStackNavigationProp<LibraryStackParamList & RootStackParamList & TabParamList>;
type Tab = 'Songs' | 'Playlists' | 'Artists' | 'Albums';
type Sort = 'recent' | 'title' | 'artist';
const TABS: readonly Tab[] = ['Songs', 'Playlists', 'Artists', 'Albums'];
const LABELS: Record<Sort, string> = { recent: 'Recently added', title: 'Title A–Z', artist: 'Artist' };
const SORT_KEY = 'v6-library-sort';

export default function LibraryScreen() {
  const navigation = useNavigation<Nav>();
  const { width, fontScale } = useWindowDimensions();
  const columns = fontScale >= 1.6 ? 1 : 2;
  const cardSize = (width - Control.gutter * 2 - Space.sm * (columns - 1)) / columns;
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const songs = useSongsStore(s => s.songs);
  const fetchSongs = useSongsStore(s => s.fetchSongs);
  const current = usePlayerStore(s => s.currentSongId);
  const actions = useSongActions();
  // Settings → Library → Opens on: the tab Library shows first (1.41.0).
  const [tab, setTab] = useState<Tab>(() => useSettingsStore.getState().libraryStartTab);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloads, setDownloads] = useState(false);
  const [collection, setCollection] = useState<{ type: 'Artists' | 'Albums'; name: string } | null>(null);
  const listRef = useRef<FlashListRef<Song>>(null);
  useEffect(() => registerLibraryScrollToTop(() => listRef.current?.scrollToOffset({ offset: 0, animated: true })), []);
  useFocusEffect(useCallback(() => { fetchSongs(); }, [fetchSongs]));
  useEffect(() => { AsyncStorage.getItem(SORT_KEY).then(value => { if (value === 'recent' || value === 'title' || value === 'artist') setSort(value); }).catch(() => undefined); }, []);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searching) { setSearching(false); setQuery(''); return true; }
      if (collection) { setCollection(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [searching, collection]));
  // Songs saved only for a downloaded playlist play from that playlist; they are not part of your Library list.
  const visible = useMemo(() => songs.filter(song => !song.isHidden && !song.playlistOnly), [songs]);
  const list = useMemo(() => visible.filter(song => (!collection || (collection.type === 'Artists' ? song.artist : song.album) === collection.name)
    && (!query || `${song.title} ${song.artist ?? ''}`.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'artist' ? (a.artist ?? '').localeCompare(b.artist ?? '') : Date.parse(b.dateCreated) - Date.parse(a.dateCreated)), [visible, collection, query, sort]);
  const groups = useMemo(() => {
    const map = new Map<string, Song[]>();
    for (const song of visible) {
      const key = tab === 'Artists' ? song.artist : song.album;
      if (!key || (query && !key.toLowerCase().includes(query.toLowerCase()))) continue;
      const group = map.get(key) ?? []; group.push(song); map.set(key, group);
    }
    return Array.from(map, ([name, items]) => ({ name, items })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tab, visible, query]);
  const openPhone = () => navigation.navigate('Settings', { action: 'import-phone' });
  // Title, tabs and sort stay pinned; the header glow leaves and returns with whichever list is scrolling.
  const glow = useHeaderGlow();
  const glowScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => glow.onScroll(e.nativeEvent.contentOffset.y);
  const selectTab = (next: Tab) => { setTab(next); setQuery(''); setSearching(false); setCollection(null); glow.onScroll(0); };
  const showSongs = tab === 'Songs' || collection !== null;
  const changeSort = (value: Sort) => { setSort(value); setSortOpen(false); AsyncStorage.setItem(SORT_KEY, value).catch(() => undefined); };
  return (
    <AppScreen style={{ paddingTop: insets.top }} staticGlow={false}>
      <HeaderGlow {...glow.props} />
      <PageHeader title={collection?.name ?? 'Library'} leading={collection ? <IconButton icon="arrow-back" label="Back to Library" onPress={() => setCollection(null)} /> : undefined}
        actions={<><IconButton icon="download-outline" label="Downloads" onPress={() => setDownloads(true)} /><IconButton icon="ellipsis-vertical" label="Library options" onPress={() => setMenuOpen(true)} /></>} />
      {searching ? <View style={styles.search}><IconButton icon="arrow-back" label="Close library search" onPress={() => { setSearching(false); setQuery(''); }} />
        <TextInput autoFocus value={query} onChangeText={setQuery} style={styles.input} placeholder={`Search ${tab.toLowerCase()}`} placeholderTextColor={Signal.inkMuted} accessibilityLabel={`Search in ${tab}`} />
        <IconButton icon="close" label="Clear search" onPress={() => setQuery('')} /></View>
        : <View style={styles.tabs}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
          {TABS.map(value => <Tactile key={value} onPress={() => selectTab(value)} haptic="select" accessibilityRole="tab" accessibilityState={{ selected: tab === value }} style={[styles.tab, tab === value && styles.selected]}>
            <Text tone={tab === value ? 'primary' : 'secondary'} style={tab === value && styles.selectedText}>{value}</Text></Tactile>)}
        </ScrollView><IconButton icon="search" label={`Search in ${tab}`} onPress={() => setSearching(true)} /></View>}
      {showSongs ? <><View style={styles.tools}><TextButton label={LABELS[sort]} icon="chevron-down" onPress={() => setSortOpen(true)} /><Text variant="meta" tone="secondary">{list.length} songs{searching ? ' · Songs only' : ''}</Text></View>
        <FlashList ref={listRef} data={list} keyExtractor={song => song.id} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottom }}
          onScroll={glowScroll} scrollEventThrottle={16}
          renderItem={({ item, index }) => <SongRow title={item.title} artist={item.artist} artwork={item.coverImageUri} downloaded={!!item.audioUri && !item.audioUri.startsWith('http')} playing={item.id === current}
            onPress={() => { playList('library', list, index); }} onActions={() => actions.open(item)} />}
          ListEmptyComponent={<View style={styles.empty}>{query ? <EmptyState icon="search" title="No matches" body="Try another title or artist." />
            : <><EmptyState icon="musical-notes-outline" title="Your next favorite starts here" body="Save songs from Stream, or add music files from this phone." action={{ label: 'Find music on Stream', onPress: () => navigation.navigate('Stream' as never) }} />
              <TextButton label="Add songs from this phone" onPress={openPhone} /></>}</View>} />
      </> : tab === 'Playlists' ? <PlaylistsScreen embedded query={query} /> : <ScrollView contentContainerStyle={{ paddingBottom: bottom }} onScroll={glowScroll} scrollEventThrottle={16}>
        {tab === 'Albums' ? <View style={styles.albumGrid}>{groups.map(({ name, items }) => <CollectionCard key={name} title={name} meta={`${items[0].artist ?? 'Unknown artist'} · ${items.length} songs`} uri={items[0].coverImageUri} size={cardSize} onPress={() => setCollection({ type: 'Albums', name })} />)}</View> : groups.map(({ name, items }) => <ListRow key={name} title={name} subtitle={`${items.length} songs`} artwork={{ uri: items[0].coverImageUri, title: name, round: tab === 'Artists' }} chevron
          onPress={() => setCollection({ type: tab as 'Artists' | 'Albums', name })} />)}
        {groups.length === 0 ? <EmptyState icon={tab === 'Artists' ? 'person-outline' : 'albums-outline'} title={`No ${tab.toLowerCase()}${query ? ' found' : ' yet'}`} body="Songs saved on this phone appear here." /> : null}
      </ScrollView>}
      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort songs by">{(Object.keys(LABELS) as Sort[]).map(value => <SheetOption key={value} label={LABELS[value]} selected={sort === value} onPress={() => changeSort(value)} />)}<Text variant="meta" tone="secondary">Kept for next time.</Text></Sheet>
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Library">
        <SheetOption icon="cloud-download-outline" label="Import from Spotify" onPress={() => { setMenuOpen(false); navigation.navigate('Import'); }} />
        <SheetOption icon="people-outline" label="Blends" onPress={() => { setMenuOpen(false); navigation.navigate('Blends'); }} />
        <SheetOption icon="phone-portrait-outline" label="Add songs from this phone" onPress={() => { setMenuOpen(false); openPhone(); }} />
        <SheetOption icon="eye-off-outline" label="Hidden songs" onPress={() => { setMenuOpen(false); navigation.navigate('Settings', { action: 'hidden-songs' }); }} />
      </Sheet>
      <DownloadQueueModal visible={downloads} onClose={() => setDownloads(false)} />
      {actions.element}
    </AppScreen>
  );
}
const styles = StyleSheet.create({
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, paddingHorizontal: Control.gutter },
  tabs: { flexDirection: 'row', alignItems: 'center', paddingLeft: Control.gutter, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Surface.divider },
  tabContent: { gap: Space.md },
  tab: { minHeight: Control.target, minWidth: Control.target, justifyContent: 'center', paddingVertical: Space.sm },
  selected: { borderBottomWidth: 2, borderColor: Signal.wave },
  selectedText: { fontWeight: '600' },
  search: { marginHorizontal: Control.gutter, flexDirection: 'row', alignItems: 'center', borderRadius: Radius.control, backgroundColor: Surface.control },
  input: { flex: 1, ...Typography.body, color: Signal.ink, paddingVertical: Space.sm },
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Control.gutter },
  empty: { alignItems: 'center', paddingTop: Space.xl },
});
