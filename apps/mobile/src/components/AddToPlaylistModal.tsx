import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, StyleSheet, TextInput, View, type ListRenderItem } from 'react-native';
import { displayPlaylistName } from '../utils/sentenceCase';
import { Glass, Radius, Signal, Space, Typography } from '../constants/allegraTheme';
import * as playlistQueries from '../database/playlistQueries';
import { getOnlineLikes, getOnlinePlaylistSongs, removeOnlinePlaylistSong } from '../database/syncQueries';
import { addOnlineSongToPlaylist } from '../services/sync/onlinePlaylist';
import { removeOnlineLikeByRef } from '../services/sync/onlineLike';
import { record } from '../services/sync/LibrarySync';
import { playlistItemOp } from '../services/sync/plan';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { StreamService } from '../services/stream/StreamService';
import { toStreamSong } from '../services/stream/streamSong';
import { filterSavedPlaylists, snapshotForStreamSong, sortSavedPlaylists, type PlaylistSort } from './savedIn';
import { applyPlaylistMembershipChanges, canonicalSongRef, desiredPlaylistMembership, isSongAlreadySaved } from './savedInBehavior';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import type { RootStackParamList } from '../types/navigation';
import type { Playlist, Song } from '../types/song';
import { Button, IconButton, Sheet, SheetScrollable, TactileRow, Text } from '../ui';
import * as Haptics from '../utils/haptics';
import { safeGoBack } from '../utils/navigationService';
import Artwork from './allegra/Artwork';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AddToPlaylist'>;
type Mode = 'ADD_SONGS_TO_PLAYLIST' | 'ADD_SONG_TO_PLAYLISTS';
type Item = Song | Playlist;
const isSong = (item: Item): item is Song => 'title' in item;
const GRID_ITEM_WIDTH = (Dimensions.get('window').width - 48 - 12) / 3;

/** The playlist-page mode remains a song picker; its list shares the sheet's drag/scroll handoff. */
function SheetList<T>(props: React.ComponentProps<typeof FlatList<T>>) {
  return <SheetScrollable><FlatList<T> {...props} /></SheetScrollable>;
}

export const AddToPlaylistModal = () => {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const { playlistId: targetPlaylistId, songId: targetSongId } = route.params || {};
  const songMetadata = route.params?.songMetadata;
  const mode: Mode = targetPlaylistId ? 'ADD_SONGS_TO_PLAYLIST' : 'ADD_SONG_TO_PLAYLISTS';
  const setMiniPlayerHiddenSource = usePlayerStore(state => state.setMiniPlayerHiddenSource);
  const currentSong = usePlayerStore(state => state.currentSong);
  const playlists = usePlaylistStore(state => state.playlists);
  const fetchPlaylists = usePlaylistStore(state => state.fetchPlaylists);
  const addSongToPlaylist = usePlaylistStore(state => state.addSongToPlaylist);
  const addSongsToPlaylist = usePlaylistStore(state => state.addSongsToPlaylist);
  const songs = useSongsStore(state => state.songs);
  const fetchSongs = useSongsStore(state => state.fetchSongs);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState<PlaylistSort>('custom');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [existingItems, setExistingItems] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const loadGeneration = useRef(0);

  useFocusEffect(useCallback(() => {
    setMiniPlayerHiddenSource('AddToPlaylist', true);
    return () => setMiniPlayerHiddenSource('AddToPlaylist', false);
  }, [setMiniPlayerHiddenSource]));

  const loadData = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(false);
    try {
      if (mode === 'ADD_SONGS_TO_PLAYLIST' && targetPlaylistId) {
        if (songs.length === 0) await fetchSongs();
        const currentSongs = await playlistQueries.getPlaylistSongs(targetPlaylistId);
        if (generation === loadGeneration.current) setExistingItems(new Set(currentSongs.map(song => song.id)));
      } else {
        await fetchPlaylists();
        if (usePlaylistStore.getState().error) throw new Error('Playlists could not be loaded');
        if (targetSongId) {
          if (songs.length === 0) await fetchSongs();
          const librarySongs = useSongsStore.getState().songs;
          const localCopy = librarySongs.find(song => song.id === targetSongId);
          const matchingCurrent = currentSong?.id === targetSongId ? currentSong : undefined;
          const ref = canonicalSongRef(targetSongId, localCopy, matchingCurrent);
          const equivalentCopy = localCopy ?? (ref ? librarySongs.find(song => song.originId === ref) : undefined);
          const onlineLikes = ref ? await getOnlineLikes() : [];
          const memberships = await Promise.all(usePlaylistStore.getState().playlists.map(async playlist => {
            const localMembership = equivalentCopy ? await playlistQueries.isSongInPlaylist(playlist.id, equivalentCopy.id) : false;
            if (!ref) return localMembership ? playlist.id : null;
            const onlineMembership = playlist.id === usePlaylistStore.getState().defaultPlaylistId
              ? onlineLikes.some(song => song.ref === ref)
              : (await getOnlinePlaylistSongs(playlist.id)).some(song => song.ref === ref);
            return isSongAlreadySaved(localMembership, onlineMembership) ? playlist.id : null;
          }));
          if (generation === loadGeneration.current) setExistingItems(new Set(memberships.filter((id): id is string => id !== null)));
        }
      }
    } catch (error) {
      console.error('Failed to load playlist memberships', error);
      if (generation === loadGeneration.current) setLoadError(true);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [mode, targetPlaylistId, targetSongId, songs, fetchSongs, fetchPlaylists, currentSong]);

  useEffect(() => {
    const generation = loadGeneration;
    loadData().catch(() => {});
    return () => { generation.current++; };
  }, [loadData]);

  const data = useMemo<Item[]>(() => {
    if (mode === 'ADD_SONGS_TO_PLAYLIST') {
      const query = searchQuery.trim().toLocaleLowerCase();
      return query ? songs.filter(song => `${song.title} ${song.artist ?? ''}`.toLocaleLowerCase().includes(query)) : songs;
    }
    return filterSavedPlaylists(sortSavedPlaylists(playlists, sort), searchQuery);
  }, [mode, songs, playlists, searchQuery, sort]);

  const toggleSelection = useCallback((id: string) => {
    setSaveError(false);
    Haptics.selectionAsync().catch(() => {});
    setSelectedItems(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const finish = () => { if (!savingRef.current) safeGoBack(navigation); };
  const retryLoad = () => { loadData().catch(() => {}); };
  const handleDone = async () => {
    if (savingRef.current) return;
    if (selectedItems.size === 0) { finish(); return; }
    savingRef.current = true;
    setSaving(true);
    setLoading(true);
    setSaveError(false);
    try {
      if (mode === 'ADD_SONGS_TO_PLAYLIST' && targetPlaylistId) {
        await addSongsToPlaylist(targetPlaylistId, Array.from(selectedItems));
      } else if (targetSongId) {
        if (songs.length === 0) await fetchSongs();
        const librarySongs = useSongsStore.getState().songs;
        const localCopy = librarySongs.find(song => song.id === targetSongId);
        const matchingCurrent = currentSong?.id === targetSongId ? currentSong : undefined;
        const ref = canonicalSongRef(targetSongId, localCopy, matchingCurrent);
        const equivalentCopy = localCopy ?? (ref ? librarySongs.find(song => song.originId === ref) : undefined);
        const streamSong = currentSong?.id === targetSongId
          ? currentSong
          : equivalentCopy ?? (songMetadata?.id === targetSongId
            ? songMetadata
            : StreamService.catalogFor(targetSongId) ? toStreamSong(StreamService.catalogFor(targetSongId)!) : undefined);
        const snapshot = ref && !equivalentCopy && streamSong ? snapshotForStreamSong(streamSong) : null;
        if (ref && !equivalentCopy && !snapshot) throw new Error('Song details are no longer available');
        const attempt = await applyPlaylistMembershipChanges(Array.from(selectedItems), existingItems,
          async id => {
            if (equivalentCopy) await addSongToPlaylist(id, equivalentCopy.id);
            else if (snapshot) {
              const result = await addOnlineSongToPlaylist(id, snapshot);
              if (result === 'error') throw new Error('Could not save this song');
            } else throw new Error('Song is no longer available');
          },
          async id => {
            const isLiked = id === usePlaylistStore.getState().defaultPlaylistId;
            // Remove the online side first. If local removal later fails, retry can safely
            // observe the missing online row and continue with the local membership.
            if (ref) {
              if (isLiked) {
                if ((await getOnlineLikes()).some(song => song.ref === ref)) await removeOnlineLikeByRef(ref);
              } else if ((await getOnlinePlaylistSongs(id)).some(song => song.ref === ref)) {
                await removeOnlinePlaylistSong(id, ref);
                const at = Date.now();
                record(playlistItemOp(id, ref, false, at));
                useOnlineLibraryStore.getState().bumpPlaylists();
              }
            }
            if (equivalentCopy && await playlistQueries.isSongInPlaylist(id, equivalentCopy.id)) {
              await usePlaylistStore.getState().removeSongFromPlaylist(id, equivalentCopy.id);
            }
          });
        if (attempt.changed.length > 0) {
          const completed = new Set(attempt.changed.map(change => change.id));
          setExistingItems(previous => {
            const next = new Set(previous);
            for (const change of attempt.changed) change.present ? next.add(change.id) : next.delete(change.id);
            return next;
          });
          setSelectedItems(previous => new Set([...previous].filter(id => !completed.has(id))));
        }
        if (attempt.failed) throw new Error('Could not update this song');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      safeGoBack(navigation);
    } catch (error) {
      console.error('Failed to save song to playlists', error);
      setSaveError(true);
      setLoading(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const renderSong = (item: Song) => {
    const selected = desiredPlaylistMembership(item.id, existingItems, selectedItems);
    const existing = existingItems.has(item.id);
    if (viewMode === 'grid') return <TactileRow style={[styles.gridItem, (selected || existing) && styles.selected]} onPress={() => toggleSelection(item.id)} disabled={existing}
      accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked: selected || existing, disabled: existing }}>
      <View style={styles.gridImage}><Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={GRID_ITEM_WIDTH} style={StyleSheet.absoluteFill} />
        {selected || existing ? <View style={styles.checkOverlay}><Ionicons name="checkmark-circle" size={24} color={Signal.wave} /></View> : null}
      </View>
      <Text variant="caption" numberOfLines={1} align="center" style={styles.gridText}>{item.title}</Text>
    </TactileRow>;
    return <TactileRow style={[styles.row, (selected || existing) && styles.selected]} onPress={() => toggleSelection(item.id)} disabled={existing}
      accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked: selected || existing, disabled: existing }}>
      <View style={styles.rowLead}>
        <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={48} style={styles.artwork} />
        <View style={styles.labelGroup}><Text variant="row" numberOfLines={1}>{item.title}</Text><Text variant="secondary" tone="muted" numberOfLines={1}>{item.artist || 'Unknown artist'}</Text></View>
      </View>
      <Ionicons name={selected || existing ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={existing ? Signal.inkMuted : Signal.ink} />
    </TactileRow>;
  };

  const renderPlaylist = (item: Playlist) => {
    const existing = existingItems.has(item.id);
    const selected = desiredPlaylistMembership(item.id, existingItems, selectedItems);
    return <TactileRow style={[styles.row, selected && styles.selected]} onPress={() => toggleSelection(item.id)}
      accessibilityRole="checkbox" accessibilityLabel={displayPlaylistName(item.name)} accessibilityState={{ checked: selected }}>
      <View style={styles.rowLead}>
        {item.isDefault
          ? <View style={[styles.artwork, styles.likedArtwork]}><Ionicons name="heart" size={22} color={Signal.ink} /></View>
          : <Artwork uri={item.coverImageUri} title={item.name} size={48} style={styles.artwork} />}
        <View style={styles.labelGroup}><Text variant="row" numberOfLines={1}>{displayPlaylistName(item.name)}</Text><Text variant="secondary" tone="muted" numberOfLines={1}>{existing ? 'Saved here · tap to remove' : `${item.songCount ?? 0} songs`}</Text></View>
      </View>
      <Ionicons name={selected ? 'checkmark-circle' : 'add-circle-outline'} size={25} color={selected ? Signal.wave : Signal.inkMuted} />
    </TactileRow>;
  };
  const renderItem: ListRenderItem<Item> = ({ item }) => isSong(item) ? renderSong(item) : renderPlaylist(item);

  const openCreate = () => navigation.navigate('CreatePlaylist');
  const header = mode === 'ADD_SONG_TO_PLAYLISTS' ? (
    <>
      <View style={styles.savedHeader}>
        <Button label="Cancel" variant="plain" size="sm" onPress={finish} disabled={saving} />
        <Text variant="detail" accessibilityRole="header">Saved in</Text>
        <Button label="Done" variant="plain" size="sm" onPress={handleDone} busy={saving} disabled={loading || saving} />
      </View>
      <View style={styles.actions}>
        <Button label="New playlist" icon="add" variant="plain" size="sm" onPress={openCreate} />
      </View>
      {saveError ? <Text variant="secondary" tone="danger" accessibilityRole="alert">Couldn’t update where this song is saved. Check your connection and try again.</Text> : null}
    </>
  ) : (
    <>
      <View style={styles.reverseHeader}>
        <Text variant="secondary" tone="muted">{selectedItems.size} selected</Text>
        <IconButton icon={viewMode === 'grid' ? 'list' : 'grid'} label={viewMode === 'grid' ? 'Show as list' : 'Show as grid'} size="sm" onPress={() => setViewMode(value => value === 'grid' ? 'list' : 'grid')} />
      </View>
      {saveError ? <Text variant="secondary" tone="danger" accessibilityRole="alert">Couldn’t add these songs. Try again.</Text> : null}
    </>
  );

  return <Sheet visible presentation="inline" keyboard title={mode === 'ADD_SONGS_TO_PLAYLIST' ? 'Add songs' : undefined} expandable onClose={finish}>
    {header}
    <View style={styles.searchBar}>
      <Ionicons name="search" size={18} color={Signal.inkMuted} />
      <TextInput style={styles.searchInput} placeholder={mode === 'ADD_SONGS_TO_PLAYLIST' ? 'Search your songs' : 'Find playlist'} placeholderTextColor={Signal.inkFaint}
        selectionColor={Signal.wave} value={searchQuery} onChangeText={setSearchQuery} returnKeyType="search" accessibilityLabel={mode === 'ADD_SONGS_TO_PLAYLIST' ? 'Search your songs' : 'Find playlist'} />
      {mode === 'ADD_SONG_TO_PLAYLISTS' ? <Button label={sort === 'custom' ? 'Sort' : 'A–Z'} icon="swap-vertical" variant="secondary" size="sm" onPress={() => setSort(value => value === 'custom' ? 'name' : 'custom')} /> : null}
    </View>
    {loadError ? <View style={styles.empty}><Text variant="body" tone="danger" accessibilityRole="alert">{mode === 'ADD_SONG_TO_PLAYLISTS' ? 'Couldn’t load saved playlists.' : 'Couldn’t load songs already in this playlist.'} Try again.</Text><Button label="Try again" onPress={retryLoad} /></View>
      : loading ? <ActivityIndicator color={Signal.wave} size="large" style={styles.loading} />
      : data.length === 0 ? <View style={styles.empty}><Text variant="body" tone="muted">{searchQuery ? 'No playlists match your search' : mode === 'ADD_SONG_TO_PLAYLISTS' ? 'Create a playlist to save this song' : 'No songs found'}</Text>{!searchQuery && mode === 'ADD_SONG_TO_PLAYLISTS' ? <Button label="New playlist" icon="add" onPress={openCreate} /> : null}</View>
      : <SheetList<Item> key={viewMode} data={data} keyExtractor={item => item.id} numColumns={mode === 'ADD_SONGS_TO_PLAYLIST' && viewMode === 'grid' ? 3 : 1}
        renderItem={renderItem} contentContainerStyle={styles.listContent} initialNumToRender={20} />}
    {mode === 'ADD_SONGS_TO_PLAYLIST' ? <View style={styles.footer}><Button label={selectedItems.size === 1 ? 'Add 1 song' : `Add ${selectedItems.size || ''} songs`.trim()} variant="primary" block disabled={selectedItems.size === 0} onPress={handleDone} busy={loading} /></View> : null}
  </Sheet>;
};

const styles = StyleSheet.create({
  savedHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Space.xs },
  reverseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Space.xs },
  searchBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Space.xs, backgroundColor: Glass.fillLight, borderRadius: Radius.pill, paddingLeft: Space.md, paddingRight: Space.xs, marginBottom: Space.sm },
  searchInput: { flex: 1, minHeight: 48, color: Signal.ink, ...Typography.body },
  listContent: { paddingBottom: Space.md },
  gridItem: { width: GRID_ITEM_WIDTH, marginBottom: Space.sm, alignItems: 'center', padding: Space.xxs },
  gridImage: { width: GRID_ITEM_WIDTH - Space.xs, height: GRID_ITEM_WIDTH - Space.xs, borderRadius: Radius.thumb, overflow: 'hidden', marginBottom: Space.xs },
  gridText: { width: '100%' },
  checkOverlay: { position: 'absolute', top: Space.xs, right: Space.xs, backgroundColor: Glass.scrimHeavy, borderRadius: Radius.pill },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm, paddingVertical: Space.xs, paddingHorizontal: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Glass.hairline },
  selected: { backgroundColor: Glass.selected, borderRadius: 12 },
  rowLead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  artwork: { width: 48, height: 48, borderRadius: Radius.thumb, overflow: 'hidden' },
  likedArtwork: { alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.accentDeep },
  labelGroup: { flex: 1, gap: Space.xxs },
  empty: { alignItems: 'center', gap: Space.sm, padding: Space.lg },
  loading: { marginVertical: Space.xl },
  footer: { paddingTop: Space.xs },
});

export default AddToPlaylistModal;
