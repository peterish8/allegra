/**
 * A song's actions (the long press on any row of a song on the phone): Play next first, then lyrics, version,
 * cover, details, and the ones that remove something last. The app's one `Sheet`, so it drags and closes like
 * every other sheet.
 */
import { Image } from 'expo-image';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Song } from '../types/song';
import { Artwork, Glass, Radius, Sheet, SheetOption, SheetScrollView, Space, Tactile, Text } from '../ui';

interface LibraryBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  selectedSong: Song | null;
  /** Shown only while this phone has a queue the song can join. */
  onPlayNext?: () => void;
  onFindLyrics: () => void;
  /** Shown when the sheet was opened from a playlist. */
  onRemoveFromPlaylist?: () => void;
  onShare: () => void;
  onOpenVersionSearch: () => void;
  onPickImage: () => void;
  onOpenCoverSearch: () => void;
  recentArts: string[];
  onSelectRecentArt: (uri: string) => void;
  onRemoveCover: () => void;
  onHideSong: () => void;
  onEditInfo: () => void;
  onDelete: () => void;
}

const LibraryBottomSheet: React.FC<LibraryBottomSheetProps> = ({
  visible,
  onClose,
  selectedSong,
  onPlayNext,
  onFindLyrics,
  onRemoveFromPlaylist,
  onShare,
  onOpenVersionSearch,
  onPickImage,
  onOpenCoverSearch,
  recentArts,
  onSelectRecentArt,
  onRemoveCover,
  onHideSong,
  onEditInfo,
  onDelete,
}) => (
  <Sheet visible={visible} onClose={onClose} tall>
    {selectedSong ? (
      <View style={styles.head}>
        <View style={styles.art}>
          <Artwork uri={selectedSong.coverImageUri} title={selectedSong.title} artist={selectedSong.artist} size={52} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.headText}>
          <Text variant="row" numberOfLines={1}>{selectedSong.title}</Text>
          {selectedSong.artist ? <Text variant="secondary" tone="muted" numberOfLines={1}>{selectedSong.artist}</Text> : null}
        </View>
      </View>
    ) : null}

    <SheetScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
      {onPlayNext ? <SheetOption label="Play next" icon="return-down-forward" onPress={onPlayNext} /> : null}
      <SheetOption label="Find lyrics" icon="text-outline" onPress={onFindLyrics} />
      <SheetOption label="Another language or version" icon="language-outline" onPress={onOpenVersionSearch} />
      <SheetOption label="Share the audio" icon="share-social-outline" onPress={onShare} />

      <Text variant="meta" tone="muted" style={styles.group}>Cover</Text>
      <SheetOption label="Cover from your photos" icon="image-outline" onPress={onPickImage} />
      <SheetOption label="Find a cover online" icon="globe-outline" onPress={onOpenCoverSearch} />
      {recentArts.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recent}>
          {recentArts.map((uri, index) => (
            <Tactile key={`${uri}-${index}`} onPress={() => onSelectRecentArt(uri)} pressScale={0.96} haptic="select" accessibilityRole="button" accessibilityLabel={`Use recent cover ${index + 1}`}>
              <Image source={{ uri }} style={styles.recentImage} contentFit="cover" />
            </Tactile>
          ))}
        </ScrollView>
      ) : null}
      <SheetOption label="Remove the cover" icon="close-circle-outline" onPress={onRemoveCover} />

      <Text variant="meta" tone="muted" style={styles.group}>Song</Text>
      <SheetOption label="Edit title and artist" icon="create-outline" onPress={onEditInfo} />
      {onRemoveFromPlaylist ? <SheetOption label="Remove from this playlist" icon="remove-circle-outline" onPress={onRemoveFromPlaylist} /> : null}
      <SheetOption label="Hide this song" icon="eye-off-outline" onPress={onHideSong} />
      <SheetOption label="Delete song" icon="trash-outline" destructive onPress={onDelete} />
    </SheetScrollView>
  </Sheet>
);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.xxs, paddingBottom: Space.sm },
  art: { width: 52, height: 52, borderRadius: Space.xs, overflow: 'hidden' },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  scroll: { flexGrow: 0 },
  group: { marginTop: Space.md, marginBottom: Space.xxs, marginLeft: Space.xs },
  recent: { gap: Space.xs, paddingHorizontal: Space.xs, paddingVertical: Space.xs },
  recentImage: { width: 64, height: 64, borderRadius: Radius.thumb, backgroundColor: Glass.fillLight },
});

export default React.memo(LibraryBottomSheet);
