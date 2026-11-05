import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type FlatListProps
} from 'react-native';
import { Artwork } from '../components/allegra/Artwork';
import { Glass, Signal, TypeScale } from '../constants/allegraTheme';
import { ImageSearchResult, ImageSearchService } from '../services/ImageSearchService';
import { IconButton, Sheet, SheetScrollable, TactileRow } from '../ui';

/**
 * Pick a new cover for a song: a tall frosted sheet with a search field and a
 * two-column grid of covers. Tapping one uses it.
 */

type Props = {
    visible: boolean;
    initialQuery: string;
    onClose: () => void;
    onSelect: (uri: string) => void;
};

const GAP = 12;
const SIDE = 16;

/** The covers grid inside the sheet: a drag down at its top moves the sheet. */
function SheetList<T>(props: FlatListProps<T>): React.ReactElement {
    return (
        <SheetScrollable>
            <FlatList<T> {...props} />
        </SheetScrollable>
    );
}

export const CoverArtSearchScreen: React.FC<Props> = ({ visible, initialQuery, onClose, onSelect }) => {
    const { width } = useWindowDimensions();
    const column = (width - SIDE * 2 - GAP) / 2;
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState<ImageSearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleSearch = useCallback(async (text: string) => {
        if (!text.trim()) return;
        setIsLoading(true);
        const images = await ImageSearchService.searchImages(text);
        setResults(images);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        if (visible && initialQuery) {
            setQuery(initialQuery);
            handleSearch(initialQuery);
        }
    }, [visible, initialQuery, handleSearch]);

    const renderItem = ({ item }: { item: ImageSearchResult }) => (
        <TactileRow
            style={[styles.gridItem, { width: column }]}
            onPress={() => onSelect(item.uri)}
            accessibilityRole="button"
            accessibilityLabel={`Use the cover of ${item.title}`}
        >
            <Artwork uri={item.uri} title={item.title} artist={item.artist} size={column} style={{ width: column, height: column, borderRadius: 10 }} />
            <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.itemArtist} numberOfLines={1}>{item.artist}</Text>
        </TactileRow>
    );

    return (
        <Sheet visible={visible} onClose={onClose} title="Change cover" tall keyboard>
            <View style={styles.searchBar}>
                <Ionicons name="search" size={16} color={Signal.inkMuted} />
                <TextInput
                    style={styles.input}
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={() => handleSearch(query)}
                    placeholder="Song or album"
                    placeholderTextColor={Signal.inkFaint}
                    selectionColor={Signal.wave}
                    returnKeyType="search"
                />
                {query.length > 0 && (
                    <IconButton icon="close-circle" size="sm" variant="plain" label="Clear" onPress={() => setQuery('')} />
                )}
            </View>

            {isLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={Signal.wave} />
                    <Text style={styles.hint}>Looking for covers</Text>
                </View>
            ) : (
                <SheetList<ImageSearchResult>
                    data={results}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    numColumns={2}
                    contentContainerStyle={styles.listContent}
                    columnWrapperStyle={styles.columnWrapper}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={
                        <View style={styles.center}>
                            <Ionicons name="images-outline" size={40} color={Signal.inkFaint} />
                            <Text style={styles.hint}>No covers for that. Try the album name.</Text>
                        </View>
                    }
                />
            )}
        </Sheet>
    );
};

const styles = StyleSheet.create({
    searchBar: {
        flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginBottom: 8, paddingHorizontal: 14,
        height: 44, borderRadius: 999, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline,
    },
    input: { flex: 1, color: Signal.ink, fontSize: TypeScale.body, paddingVertical: 0 },
    listContent: { paddingHorizontal: SIDE, paddingTop: 8, flexGrow: 1 },
    columnWrapper: { justifyContent: 'space-between', marginBottom: 16 },
    gridItem: { borderRadius: 12 },
    itemTitle: { color: Signal.ink, fontSize: TypeScale.meta, fontWeight: '600', marginTop: 8 },
    itemArtist: { color: Signal.inkMuted, fontSize: TypeScale.caption, marginTop: 2 },
    center: { justifyContent: 'center', alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
    hint: { color: Signal.inkMuted, marginTop: 12, fontSize: TypeScale.body, textAlign: 'center' },
});
