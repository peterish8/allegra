/**
 * A playlist as a folder of its covers, as on the website: three of its songs' artwork fanned out
 * of a frosted pocket that names its first songs. The pocket is tinted glass rather than a live
 * blur, so a grid of folders scrolls smoothly on any phone.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Artwork from './Artwork';
import { Song } from '../../types/song';

/**
 * Each cover's place in the fan (its left edge, as a share of the folder's width), and which of the
 * playlist's songs it shows: the lead in the middle, the next two tucked behind either side.
 */
const SLOTS = [
  { index: 1, left: 0.05, y: 0.1, rotate: '-10deg' },
  { index: 0, left: 0.3, y: 0, rotate: '0deg' },
  { index: 2, left: 0.55, y: 0.1, rotate: '10deg' },
] as const;

interface PlaylistFolderProps {
  /** Up to four songs; the first three with covers become the fan, the first three are named. */
  songs: Song[];
  /** Width of the folder; its height follows. */
  width: number;
}

export const PlaylistFolder: React.FC<PlaylistFolderProps> = React.memo(({ songs, width }) => {
  const height = Math.round(width * 0.84);
  const coverW = Math.round(width * 0.4);
  const coverH = Math.round(coverW * 1.25);
  const pocketH = Math.round(height * 0.54);
  return (
    <View style={{ width, height }}>
      <View style={[styles.back, { top: height * 0.07, left: width * 0.12, right: width * 0.12, bottom: height * 0.34 }]} />
      {SLOTS.map(({ index, left, y, rotate }) => {
        const song = songs[index];
        return (
          <View
            key={index}
            style={[
              styles.cover,
              {
                width: coverW,
                height: coverH,
                left: width * left,
                top: height * (0.05 + y),
                zIndex: index === 0 ? 1 : 0,
                transform: [{ rotate }],
              },
            ]}
          >
            {song ? (
              <Artwork uri={song.coverImageUri} title={song.title} artist={song.artist} size={coverH} style={{ width: coverH, height: coverH, marginLeft: (coverW - coverH) / 2 }} />
            ) : (
              <Ionicons name="musical-notes-outline" size={20} color="rgba(255, 255, 255, 0.5)" />
            )}
          </View>
        );
      })}
      {/* The folder's tab and pocket: one tinted glass, lit from above. */}
      <View style={[styles.glass, styles.tab, { bottom: pocketH - 1, width: width * 0.46 }]} />
      <View style={[styles.glass, styles.pocket, { height: pocketH }]}>
        <LinearGradient colors={['rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0)']} style={StyleSheet.absoluteFill} />
        {songs.length > 0 ? songs.slice(0, 3).map((song, line) => (
          <View key={song.id} style={[styles.line, line === 2 && styles.fading]}>
            <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text>
          </View>
        )) : (
          <View style={styles.line}>
            <Text style={styles.title} numberOfLines={1}>Empty for now</Text>
            <Text style={styles.artist} numberOfLines={2}>Add songs from any song's menu</Text>
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  back: { position: 'absolute', borderRadius: 16, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  cover: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  glass: {
    position: 'absolute',
    left: 0,
    zIndex: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    backgroundColor: 'rgba(40, 42, 50, 0.94)',
  },
  tab: { height: 14, borderTopLeftRadius: 14, borderTopRightRadius: 18, borderBottomWidth: 0 },
  pocket: {
    right: 0,
    bottom: 0,
    gap: 6,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 11,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  line: { minWidth: 0 },
  fading: { opacity: 0.4 },
  title: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  artist: { color: 'rgba(255, 255, 255, 0.58)', fontSize: 11, marginTop: 1 },
});

export default PlaylistFolder;
