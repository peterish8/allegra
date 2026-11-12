/**
 * YouTube Music shelves, drawn the way Echo Music draws them: a heading
 * (with its small strapline), then either song rows or a horizontal run of
 * cards — square covers for songs, albums and playlists, round photos for
 * artists.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Shelf, YTItem } from '../../services/ytmusic/browse';
import { YTSong } from '../../services/ytmusic/parsers';
import { sentenceCase } from '../../utils/sentenceCase';
import Artwork from '../allegra/Artwork';
import { Tactile } from '../allegra/motion';
import { Control, Signal } from '../../constants/allegraTheme';
import { SongRow as SharedSongRow } from '../../ui/SongRow';

const CARD = 150;
const ARTIST = 124;

export interface ShelfActions {
  /** Open an artist, album or playlist page. */
  onOpen: (item: Exclude<YTItem, { kind: 'song' }>) => void;
  /** Play these songs starting at `index`. */
  onPlay: (songs: YTSong[], index: number) => void;
  /** The song currently being resolved (spinner on its row). */
  pendingId?: string | null;
}

const songsOf = (items: YTItem[]): YTSong[] =>
  items.flatMap(i => (i.kind === 'song' ? [i.song] : []));

/** The shared song row (56 tall, 44 cover, one-line title and artist), so artist and album pages match every list. */
export const SongRow: React.FC<{ song: YTSong; onPress: () => void; pending?: boolean; index?: number }> = memo(({ song, onPress, pending }) => (
  <SharedSongRow title={song.title} artist={song.artists.join(', ')} artwork={song.thumbnail} meta={song.album || undefined} onPress={onPress}
    trailing={pending ? <View style={styles.pending} accessibilityLabel="Loading"><Ionicons name="ellipsis-horizontal" size={18} color={Signal.inkSoft} /></View> : undefined} />
));
SongRow.displayName = 'SongRow';

const Card: React.FC<{ item: YTItem; onPress: () => void }> = memo(({ item, onPress }) => {
  const { fontScale } = useWindowDimensions();
  const round = item.kind === 'artist';
  const title = item.kind === 'song' ? item.song.title : item.title;
  const sub = item.kind === 'playlist' ? undefined : item.kind === 'song' ? item.song.artists.join(', ') : item.subtitle;
  const art = item.kind === 'song' ? item.song.thumbnail : item.thumbnail;
  const size = round ? ARTIST : CARD;
  return (
    <Tactile onPress={onPress} pressScale={0.98} wrapperStyle={{ width: size }} accessibilityRole="button" accessibilityLabel={title}>
      <Artwork uri={art} title={title} size={size} style={[styles.cardArt, { width: size, height: size, borderRadius: round ? size / 2 : 10 }]} />
      <Text style={[styles.cardTitle, !round && { minHeight: 40 * fontScale }, round && styles.center]} numberOfLines={round ? 1 : 2}>{title}</Text>
      {sub && !round ? <Text style={styles.cardSub} numberOfLines={1}>{sub}</Text> : null}
    </Tactile>
  );
});
Card.displayName = 'Card';

export const ShelfHeader: React.FC<{ title: string; strapline?: string; onMore?: () => void }> = ({ title, strapline, onMore }) => (
  <View style={styles.header}>
    <View style={styles.flex}>
      {strapline ? <Text style={styles.strapline} numberOfLines={1}>{sentenceCase(strapline)}</Text> : null}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View>
    {onMore ? (
      <Tactile onPress={onMore} hitSlop={12} pressScale={0.9} accessibilityRole="button" accessibilityLabel={`More ${title}`}>
        <Ionicons name="arrow-forward" size={22} color="rgba(255,255,255,0.8)" />
      </Tactile>
    ) : null}
  </View>
);

/** One shelf. `rows` draws song lists vertically (an artist's top songs). */
export const BrowseShelf: React.FC<{ shelf: Shelf; rows?: boolean; maxRows?: number; onMore?: () => void } & ShelfActions> = ({
  shelf, rows = false, maxRows = 5, onMore, onOpen, onPlay, pendingId,
}) => {
  const songs = songsOf(shelf.items);
  const allSongs = songs.length === shelf.items.length;
  if (rows && allSongs) {
    return (
      <View style={styles.shelf}>
        <ShelfHeader title={shelf.title} strapline={shelf.strapline} onMore={onMore} />
        {songs.slice(0, maxRows).map((song, i) => (
          <SongRow key={`${song.videoId}-${i}`} song={song} pending={pendingId === song.videoId} onPress={() => onPlay(songs, i)} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.shelf}>
      <ShelfHeader title={shelf.title} strapline={shelf.strapline} onMore={onMore} />
      <FlatList
        horizontal
        data={shelf.items}
        keyExtractor={(item, i) => `${item.kind === 'song' ? item.song.videoId : item.browseId}-${i}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
        initialNumToRender={4}
        windowSize={5}
        renderItem={({ item }) => (
          <Card
            item={item}
            onPress={() => {
              if (item.kind === 'song') onPlay(songs, Math.max(0, songs.findIndex(s => s.videoId === item.song.videoId)));
              else onOpen(item);
            }}
          />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shelf: { marginTop: 26 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, marginBottom: 12, gap: 12 },
  strapline: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  carousel: { paddingHorizontal: 20, gap: 14 },
  cardArt: { overflow: 'hidden' },
  cardTitle: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 8 },
  cardSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 },
  center: { textAlign: 'center' },
  pending: { width: Control.target, minHeight: Control.row, alignItems: 'center', justifyContent: 'center' },
});
