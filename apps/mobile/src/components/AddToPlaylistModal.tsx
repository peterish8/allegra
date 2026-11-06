import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type FlatListProps,
  type ListRenderItem,
} from 'react-native';
import { displayPlaylistName } from '../utils/sentenceCase';

import { Glass, Radius, Signal } from '../constants/allegraTheme';
import * as playlistQueries from '../database/playlistQueries';
import { getOnlinePlaylistSongs } from '../database/syncQueries';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { RootStackParamList } from '../types/navigation';
import { Playlist, Song } from '../types/song';
import { Button, IconButton, Sheet, SheetScrollable, TactileRow } from '../ui';
import * as Haptics from '../utils/haptics';
import { safeGoBack } from '../utils/navigationService';
import Artwork from './allegra/Artwork';

type AddToPlaylistNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type AddToPlaylistRouteProp = RouteProp<RootStackParamList, 'AddToPlaylist'>;
type AddToPlaylistMode = 'ADD_SONGS_TO_PLAYLIST' | 'ADD_SONG_TO_PLAYLISTS';
type SelectableItem = Song | Playlist;

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_ITEM_WIDTH = (SCREEN_WIDTH - 48 - 12) / 3;

const isSongItem = (item: SelectableItem): item is Song => 'title' in item;

/** A FlatList inside the sheet: a drag down at its top moves the sheet. */
function SheetList<T>(props: FlatListProps<T>): React.ReactElement {
  return (
    <SheetScrollable>
      <FlatList<T> {...props} />
    </SheetScrollable>
  );
}

export const AddToPlaylistModal = () => {
  const navigation = useNavigation<AddToPlaylistNavigationProp>();
  const route = useRoute<AddToPlaylistRouteProp>();
  const params = route.params || {};

  const mode: AddToPlaylistMode = params.playlistId ? 'ADD_SONGS_TO_PLAYLIST' : 'ADD_SONG_TO_PLAYLISTS';
  const targetPlaylistId = params.playlistId;
  const targetSongId = params.songId;

  const playlists = usePlaylistStore(state => state.playlists);
  const fetchPlaylists = usePlaylistStore(state => state.fetchPlaylists);
  const addSongToPlaylist = usePlaylistStore(state => state.addSongToPlaylist);
  const addSongsToPlaylist = usePlaylistStore(state => state.addSongsToPlaylist);
  const songs = useSongsStore(state => state.songs);
  const fetchSongs = useSongsStore(state => state.fetchSongs);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [existingItems, setExistingItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        if (mode === 'ADD_SONGS_TO_PLAYLIST' && targetPlaylistId) {
          if (songs.length === 0) await fetchSongs();
          const currentSongs = await playlistQueries.getPlaylistSongs(targetPlaylistId);
          setExistingItems(new Set(currentSongs.map(s => s.id)));
        } else {
          await fetchPlaylists();
          if (targetSongId) {
            const memberships = await Promise.all(usePlaylistStore.getState().playlists.map(async playlist => {
              if (targetSongId.startsWith('stream:')) {
                const ref = targetSongId.slice(7);
                const exists = playlist.id === usePlaylistStore.getState().defaultPlaylistId
                  ? useOnlineLibraryStore.getState().likedRefs.has(ref as never)
                  : (await getOnlinePlaylistSongs(playlist.id)).some(song => song.ref === ref);
                return exists ? playlist.id : null;
              }
              return await playlistQueries.isSongInPlaylist(playlist.id, targetSongId) ? playlist.id : null;
            }));
            setExistingItems(new Set(memberships.filter((id): id is string => id !== null)));
          }
        }
      } catch (error) {
        console.error('Failed to init modal', error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [mode, targetPlaylistId, targetSongId, songs.length, fetchSongs, fetchPlaylists]);

  const dataToRender = useMemo<SelectableItem[]>(() => {
    if (mode === 'ADD_SONGS_TO_PLAYLIST') {
      if (!searchQuery) return songs;
      const lower = searchQuery.toLowerCase();
      return songs.filter(s => s.title.toLowerCase().includes(lower) || s.artist?.toLowerCase().includes(lower));
    }
    if (!searchQuery) return playlists;
    const lower = searchQuery.toLowerCase();
    return playlists.filter(p => p.name.toLowerCase().includes(lower));
  }, [mode, songs, playlists, searchQuery]);

  const toggleSelection = useCallback((id: string) => {
    if (existingItems.has(id)) return;
    Haptics.selectionAsync().catch(() => {});
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, [existingItems]);

  const handleDone = async () => {
    try {
      setLoading(true);
      if (mode === 'ADD_SONGS_TO_PLAYLIST' && targetPlaylistId) {
        await addSongsToPlaylist(targetPlaylistId, Array.from(selectedItems));
      } else if (targetSongId) {
        await Promise.all(Array.from(selectedItems).map(pid => addSongToPlaylist(pid, targetSongId)));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      safeGoBack(navigation);
    } catch (e) {
      console.error('Failed to save', e);
      setLoading(false);
    }
  };

  const renderSongItem = useCallback(({ item }: { item: Song }) => {
    const isSelected = selectedItems.has(item.id);
    const isExisting = existingItems.has(item.id);

    if (viewMode === 'grid') {
      return (
        <TactileRow
          style={[styles.gridItem, (isSelected || isExisting) && styles.gridItemSelected]}
          onPress={() => toggleSelection(item.id)}
          disabled={isExisting}
          accessibilityRole="checkbox"
          accessibilityLabel={item.title}
          accessibilityState={{ checked: isSelected || isExisting, disabled: isExisting }}
        >
          <View style={[styles.gridImage, isExisting && { opacity: 0.3 }]}>
            <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={GRID_ITEM_WIDTH} style={StyleSheet.absoluteFill} />
          </View>
          {isSelected && (
            <View style={styles.checkOverlay}>
              <Ionicons name="checkmark-circle" size={24} color={Signal.wave} />
            </View>
          )}
          {isExisting && (
            <View style={styles.checkOverlay}>
              <Ionicons name="checkmark-done-circle" size={24} color={Signal.inkMuted} />
            </View>
          )}
          <Text style={styles.gridText} numberOfLines={1}>{item.title}</Text>
        </TactileRow>
      );
    }

    return (
      <TactileRow
        style={[styles.listItem, (isSelected || isExisting) && styles.listItemSelected]}
        onPress={() => toggleSelection(item.id)}
        disabled={isExisting}
        accessibilityRole="checkbox"
        accessibilityLabel={item.title}
        accessibilityState={{ checked: isSelected || isExisting, disabled: isExisting }}
      >
        <View style={styles.listLeft}>
          <View style={[styles.listImage, isExisting && { opacity: 0.5 }]}>
            <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={48} style={StyleSheet.absoluteFill} />
          </View>
          <View style={styles.listTextContainer}>
            <Text style={[styles.listTitle, isExisting && styles.listTitleExisting]} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.listSubtitle} numberOfLines={1}>{item.artist}</Text>
          </View>
        </View>
        <View style={styles.listCheckbox}>
          {isSelected && <Ionicons name="checkmark-circle" size={24} color={Signal.wave} />}
          {isExisting && <Ionicons name="checkmark-done-circle" size={24} color={Signal.inkMuted} />}
          {!isSelected && !isExisting && <View style={styles.emptyCircle} />}
        </View>
      </TactileRow>
    );
  }, [selectedItems, existingItems, viewMode, toggleSelection]);

  const renderPlaylistItem = useCallback(({ item }: { item: Playlist }) => {
    const isExisting = existingItems.has(item.id);
    const isSelected = selectedItems.has(item.id) || isExisting;
    return (
      <TactileRow
        style={[styles.listItem, isSelected && styles.listItemSelected]}
        onPress={() => toggleSelection(item.id)}
        accessibilityRole="checkbox"
        accessibilityLabel={displayPlaylistName(item.name)}
        accessibilityState={{ checked: isSelected, disabled: isExisting }}
      >
        <View style={styles.listLeft}>
          <View style={[styles.listImage, styles.placeholderList]}>
            <Ionicons name="musical-notes" size={20} color={Signal.inkMuted} />
          </View>
          <View style={styles.listTextContainer}>
            <Text style={styles.listTitle} numberOfLines={1}>{displayPlaylistName(item.name)}</Text>
            <Text style={styles.listSubtitle} numberOfLines={1}>{isExisting ? 'Already in playlist' : item.songCount === 1 ? '1 song' : `${item.songCount} songs`}</Text>
          </View>
        </View>
        <View style={styles.listCheckbox}>
          {isSelected
            ? <Ionicons name="checkmark-circle" size={24} color={Signal.wave} />
            : <View style={styles.emptyCircle} />}
        </View>
      </TactileRow>
    );
  }, [selectedItems, existingItems, toggleSelection]);

  const renderSelectableItem = useCallback<ListRenderItem<SelectableItem>>(({ item }) => {
    if (mode === 'ADD_SONGS_TO_PLAYLIST' && isSongItem(item)) return renderSongItem({ item });
    if (mode === 'ADD_SONG_TO_PLAYLISTS' && !isSongItem(item)) return renderPlaylistItem({ item });
    return null;
  }, [mode, renderSongItem, renderPlaylistItem]);

  return (
    <Sheet
      visible
      presentation="inline"
      keyboard
      tall
      title={mode === 'ADD_SONGS_TO_PLAYLIST' ? 'Add songs' : 'Add to playlist'}
      onClose={() => safeGoBack(navigation)}
    >
      {mode === 'ADD_SONGS_TO_PLAYLIST' ? (
        <View style={styles.subHeader}>
          <Text style={styles.subtitle}>{selectedItems.size} selected</Text>
          <IconButton
            icon={viewMode === 'grid' ? 'list' : 'grid'}
            label={viewMode === 'grid' ? 'Show as list' : 'Show as grid'}
            size="sm"
            onPress={() => setViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
          />
        </View>
      ) : null}

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Signal.inkMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={mode === 'ADD_SONGS_TO_PLAYLIST' ? 'Search your songs' : 'Search playlists'}
          placeholderTextColor={Signal.inkFaint}
          selectionColor={Signal.wave}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={Signal.wave} size="large" style={styles.loading} />
      ) : (
        <SheetList<SelectableItem>
          key={viewMode}
          data={dataToRender}
          keyExtractor={(item) => item.id}
          numColumns={mode === 'ADD_SONGS_TO_PLAYLIST' && viewMode === 'grid' ? 3 : 1}
          renderItem={renderSelectableItem}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={mode === 'ADD_SONGS_TO_PLAYLIST' && viewMode === 'grid' ? { gap: 6 } : undefined}
          initialNumToRender={20}
        />
      )}

      <View style={styles.footer}>
        <Button
          label={mode !== 'ADD_SONGS_TO_PLAYLIST'
            ? 'Done'
            : selectedItems.size === 1 ? 'Add 1 song' : selectedItems.size > 1 ? `Add ${selectedItems.size} songs` : 'Add songs'}
          variant="primary"
          block
          disabled={selectedItems.size === 0}
          onPress={handleDone}
        />
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  subtitle: { fontSize: 14, color: Signal.inkMuted },
  searchBar: { flexDirection: 'row', backgroundColor: Glass.fillLight, borderRadius: Radius.pill, paddingHorizontal: 14, height: 44, alignItems: 'center', marginBottom: 20 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: Signal.ink, fontSize: 16 },
  loading: { marginVertical: 32 },
  listContent: { paddingBottom: 12 },
  gridItem: { width: GRID_ITEM_WIDTH, marginBottom: 12, alignItems: 'center', borderRadius: Radius.thumb },
  gridItemSelected: { opacity: 0.8 },
  gridImage: { width: GRID_ITEM_WIDTH, height: GRID_ITEM_WIDTH, borderRadius: Radius.thumb, overflow: 'hidden', marginBottom: 6 },
  gridText: { color: Signal.inkSoft, fontSize: 12, textAlign: 'center', width: '100%' },
  checkOverlay: { position: 'absolute', top: 4, right: 4, backgroundColor: Glass.scrimHeavy, borderRadius: 12 },
  // The border is always there (clear at rest) so selecting never shifts the row.
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, backgroundColor: Glass.fillLight, padding: 8, borderRadius: Radius.well, borderWidth: 1, borderColor: 'transparent' },
  listItemSelected: { backgroundColor: Glass.selected, borderColor: Glass.selectedRim },
  listLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  listImage: { width: 48, height: 48, borderRadius: Radius.thumb, overflow: 'hidden', marginRight: 12 },
  placeholderList: { justifyContent: 'center', alignItems: 'center', backgroundColor: Glass.fillPressed },
  listTextContainer: { flex: 1 },
  listTitle: { color: Signal.ink, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  listTitleExisting: { color: Signal.inkFaint },
  listSubtitle: { color: Signal.inkMuted, fontSize: 13 },
  listCheckbox: { marginLeft: 12 },
  emptyCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Signal.inkFaint },
  footer: { marginTop: 12 },
});

export default AddToPlaylistModal;
