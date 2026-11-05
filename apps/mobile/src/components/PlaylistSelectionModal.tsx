import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Glass, Signal } from '../constants/allegraTheme';
import { usePlaylistStore } from '../store/playlistStore';
import { Playlist } from '../types/song';
import { Button, IconButton, Sheet, SheetScrollable, TactileRow, TextButton } from '../ui';

interface PlaylistSelectionModalProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (playlistId: string, playlistName: string) => void;
    onSkip?: () => void;
}

export const PlaylistSelectionModal = ({ visible, onClose, onSelect, onSkip }: PlaylistSelectionModalProps) => {
    const playlists = usePlaylistStore(state => state.playlists);
    const fetchPlaylists = usePlaylistStore(state => state.fetchPlaylists);
    const createPlaylist = usePlaylistStore(state => state.createPlaylist);
    const storeLoading = usePlaylistStore(state => state.isLoading);
    const [searchQuery, setSearchQuery] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [localLoading, setLocalLoading] = useState(false);

    useEffect(() => {
        if (visible) { fetchPlaylists(); setIsCreating(false); setNewPlaylistName(''); setSearchQuery(''); }
    }, [visible, fetchPlaylists]);

    const filteredPlaylists = useMemo(() => {
        const needle = searchQuery.toLowerCase();
        return needle ? playlists.filter(p => p.name.toLowerCase().includes(needle)) : playlists;
    }, [playlists, searchQuery]);

    const handleCreate = async () => {
        if (!newPlaylistName.trim()) return;
        setLocalLoading(true);
        try {
            const id = await createPlaylist(newPlaylistName.trim());
            onSelect(id, newPlaylistName.trim());
            onClose();
        } catch (e) { console.error(e); }
        finally { setLocalLoading(false); }
    };

    const renderItem = ({ item }: { item: Playlist }) => (
        <TactileRow
            onPress={() => { onSelect(item.id, item.name); onClose(); }}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.songCount} songs`}
            style={styles.item}
        >
            <View style={styles.iconContainer}>
                <Ionicons name="musical-notes" size={20} color={Signal.inkMuted} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.itemCount}>{item.songCount} songs</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Signal.inkFaint} />
        </TactileRow>
    );

    return (
        <Sheet visible={visible} onClose={onClose} keyboard>
            <View style={styles.header}>
                <Text style={styles.title} accessibilityRole="header">{isCreating ? 'New playlist' : 'Add to playlist'}</Text>
                <IconButton icon="close" size="sm" label="Close" onPress={onClose} />
            </View>

            {isCreating ? (
                <View>
                    <Text style={styles.subtitle}>Name it</Text>
                    <TextInput
                        style={styles.input} value={newPlaylistName} onChangeText={setNewPlaylistName}
                        placeholder="Late night drive" placeholderTextColor={Signal.inkFaint} autoFocus selectionColor={Signal.wave}
                    />
                    <View style={styles.createActions}>
                        <TextButton label="Back to the list" onPress={() => setIsCreating(false)} />
                        <Button
                            label="Create and add"
                            variant="primary"
                            busy={localLoading}
                            disabled={!newPlaylistName.trim()}
                            onPress={handleCreate}
                        />
                    </View>
                </View>
            ) : (
                <>
                    {onSkip && (
                        <TactileRow
                            onPress={() => { onSkip?.(); onClose(); }}
                            haptic="select"
                            accessibilityRole="button"
                            accessibilityLabel="Download to the library only"
                            style={styles.skipBtn}
                        >
                            <View style={styles.skipIcon}>
                                <Ionicons name="download-outline" size={20} color={Signal.waveInk} />
                            </View>
                            <Text style={styles.skipText}>Download to the library only</Text>
                            <Ionicons name="chevron-forward" size={16} color={Signal.inkMuted} />
                        </TactileRow>
                    )}
                    <View style={styles.searchRow}>
                        <View style={styles.searchBar}>
                            <Ionicons name="search" size={16} color={Signal.inkMuted} style={{ marginRight: 8 }} />
                            <TextInput
                                style={styles.searchInput} placeholder="Search playlists"
                                placeholderTextColor={Signal.inkFaint} selectionColor={Signal.wave} value={searchQuery} onChangeText={setSearchQuery}
                            />
                        </View>
                        <IconButton icon="add" size="lg" variant="primary" label="New playlist" onPress={() => setIsCreating(true)} />
                    </View>
                    {storeLoading ? (
                        <ActivityIndicator size="large" color={Signal.wave} style={{ margin: 20 }} />
                    ) : (
                        <SheetScrollable>
                            <FlatList
                                data={filteredPlaylists} keyExtractor={item => item.id} renderItem={renderItem}
                                style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}
                                ListEmptyComponent={<Text style={styles.emptyText}>No playlists found</Text>}
                            />
                        </SheetScrollable>
                    )}
                </>
            )}
        </Sheet>
    );
};

const styles = StyleSheet.create({
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    title: { color: Signal.ink, fontSize: 20, fontWeight: '700' },
    skipBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline, padding: 12, borderRadius: 16, marginBottom: 16 },
    skipIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: Signal.wave },
    skipText: { flex: 1, color: Signal.ink, fontSize: 15, fontWeight: '600' },
    searchRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
    searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: Glass.fillLight, borderRadius: 999, paddingHorizontal: 14, height: 44, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
    searchInput: { flex: 1, color: Signal.ink, fontSize: 15 },
    list: { maxHeight: 400, flexGrow: 0 },
    item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Glass.hairline },
    iconContainer: { width: 44, height: 44, borderRadius: 10, backgroundColor: Glass.fillLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    itemName: { color: Signal.ink, fontSize: 15, fontWeight: '600', marginBottom: 2 },
    itemCount: { color: Signal.inkMuted, fontSize: 12 },
    emptyText: { color: Signal.inkMuted, textAlign: 'center', marginTop: 20 },
    subtitle: { color: Signal.inkSoft, marginBottom: 12 },
    input: { backgroundColor: Glass.fillLight, color: Signal.ink, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong, fontSize: 16, marginBottom: 24 },
    createActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
});
