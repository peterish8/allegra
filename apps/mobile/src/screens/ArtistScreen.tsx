import { AppScreen } from '../components/AppScreen';
/**
 * An artist, laid out like YouTube Music's artist page and drawn in our own
 * language (Allegra: ink on near-black, the wave colour for the one primary
 * action, dark glass for everything else):
 *
 *   full-bleed photo (the top song's motion canvas plays over it when one
 *   exists) melting into the room, the name, a quiet line of audience
 *   numbers, Shuffle · Radio · Follow, About on a glass panel, then top
 *   songs, albums, singles, videos and "Fans might also like".
 *
 * The photo's colour only reaches the page as a low glow under the hero.
 * Songs play through the catalog (browsePlay), like every YouTube Music list
 * in the app.
 */
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Artwork from '../components/allegra/Artwork';
import { RiseIn, Tactile } from '../components/allegra/motion';
import { BrowseShelf } from '../components/browse/BrowseShelf';
import { Radius, Signal, TypeScale } from '../constants/allegraTheme';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { playEndpoint, playYTSongs } from '../services/stream/browsePlay';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { ArtistPage, Shelf, YTItem } from '../services/ytmusic/browse';
import { YTSong } from '../services/ytmusic/parsers';
import { useFollowedArtistsStore } from '../store/followedArtistsStore';
import { BrowseStackParamList } from '../types/navigation';
import * as Haptics from '../utils/haptics';

type Props = NativeStackScreenProps<BrowseStackParamList, 'Artist'>;

/** The room every part of the page sits in. */
const ROOM = Signal.bgDeep;



const ArtistScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();

  const [page, setPage] = useState<ArtistPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPage(null);
    setFailed(false);
    (async () => {
      const id = route.params.browseId ?? (route.params.name ? await YTMusicClient.findArtist(route.params.name) : null);
      const next = id ? await YTMusicClient.artist(id) : null;
      if (!alive) return;
      if (next) setPage(next);
      else setFailed(true);
    })().catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [route.params.browseId, route.params.name]);



  const topShelf = page?.sections.find(s => s.items.every(i => i.kind === 'song'));
  const topSongs = useMemo(() => (topShelf ? topShelf.items.flatMap(i => (i.kind === 'song' ? [i.song] : [])) : []), [topShelf]);


  const followed = useFollowedArtistsStore(s => (page ? s.artists.some(a => a.browseId === page.browseId) : false));

  const play = useCallback(async (songs: YTSong[], index: number) => {
    Haptics.selectionAsync().catch(() => {});
    setPending(songs[index]?.videoId ?? null);
    await playYTSongs(songs, index);
    setPending(null);
  }, []);

  const open = useCallback((item: Exclude<YTItem, { kind: 'song' }>) => {
    if (item.kind === 'artist') navigation.push('Artist', { browseId: item.browseId });
    else navigation.push('Collection', { browseId: item.browseId, title: item.title, thumbnail: item.thumbnail });
  }, [navigation]);

  const openMore = useCallback((shelf: Shelf) => {
    if (shelf.more?.browseId.startsWith('VL') || shelf.more?.browseId.startsWith('MPRE')) {
      navigation.push('Collection', { browseId: shelf.more.browseId, title: shelf.title });
    }
  }, [navigation]);



  if (!page) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: ROOM }]}>
        {failed ? (
          <>
            <Text style={styles.empty}>This artist could not be loaded.</Text>
            <Tactile onPress={() => navigation.goBack()} accessibilityRole="button" style={[styles.action, styles.glass, styles.retry]}>
              <Text style={styles.actionText}>Go back</Text>
            </Tactile>
          </>
        ) : <ActivityIndicator color={Signal.wave} />}
      </View>
    );
  }

  return (
    <AppScreen style={[styles.fill, { backgroundColor: ROOM }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingTop: insets.top + 64, alignItems: 'center' }}>
          <Artwork uri={page.thumbnail} title={page.name} size={184} priority="high" style={{ width: 184, height: 184, borderRadius: 92, overflow: 'hidden' }} />
          <View style={styles.heroText}>
            <Text style={styles.name} numberOfLines={2} adjustsFontSizeToFit>{page.name}</Text>
            {page.subscribers || page.monthlyListeners ? (
              <View style={styles.stats}>
                {page.monthlyListeners ? (
                  <View style={styles.stat}>
                    <View style={styles.statDot} />
                    <Text style={styles.statText}>{page.monthlyListeners} monthly</Text>
                  </View>
                ) : null}
                {page.subscribers ? <Text style={styles.statText}>{page.subscribers} subscribers</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        <RiseIn index={0}>
          <View style={styles.actions}>
            <Tactile
              wrapperStyle={styles.actionWrap}
              style={[styles.action, styles.primary]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                if (page.shuffle) playEndpoint(page.shuffle, { shuffle: true });
                else if (topSongs.length) playYTSongs(topSongs, 0, { shuffle: true });
              }}
              accessibilityRole="button"
              accessibilityLabel="Shuffle"
            >
              <Ionicons name="shuffle" size={19} color={Signal.waveInk} />
              <Text style={[styles.actionText, { color: Signal.waveInk }]}>Shuffle</Text>
            </Tactile>
            <Tactile
              wrapperStyle={styles.actionWrap}
              style={[styles.action, styles.glass]}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); if (page.radio) playEndpoint(page.radio); else if (topSongs.length) play(topSongs, 0); }}
              accessibilityRole="button"
              accessibilityLabel="Radio"
            >
              <Ionicons name="radio-outline" size={19} color={Signal.ink} />
              <Text style={styles.actionText}>Radio</Text>
            </Tactile>
            <Tactile
              style={[styles.follow, styles.glass, followed && styles.followOn]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                useFollowedArtistsStore.getState().toggle({ browseId: page.browseId, name: page.name, thumbnail: page.thumbnail });
              }}
              accessibilityRole="button"
              accessibilityLabel={followed ? 'Following, tap to unfollow' : 'Follow'}
            >
              <Ionicons name={followed ? 'checkmark' : 'person-add-outline'} size={19} color={followed ? Signal.wave : Signal.ink} />
            </Tactile>
          </View>
        </RiseIn>

        {page.description ? (
          <RiseIn index={1}>
            <Pressable onPress={() => setAboutOpen(o => !o)} style={styles.about} accessibilityRole="button" accessibilityLabel={aboutOpen ? 'About, tap to collapse' : 'About, tap to read more'}>
              <View style={styles.aboutHead}>
                <Text style={styles.aboutTitle}>About</Text>
                <Ionicons name={aboutOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Signal.inkMuted} />
              </View>
              <Text style={styles.aboutText} numberOfLines={aboutOpen ? undefined : 3}>{page.description}</Text>
            </Pressable>
          </RiseIn>
        ) : null}

        {page.sections.map((shelf, i) => (
          <RiseIn key={`${shelf.title}-${i}`} index={i + 2}>
            <BrowseShelf
              shelf={shelf}
              rows={shelf === topShelf}
              onOpen={open}
              onPlay={play}
              pendingId={pending}
              onMore={shelf.more ? () => openMore(shelf) : undefined}
            />
          </RiseIn>
        ))}
      </ScrollView>

      <Tactile onPress={() => navigation.goBack()} wrapperStyle={[styles.backWrap, { top: insets.top + 8 }]} style={styles.back} hitSlop={10} pressScale={0.9} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={22} color={Signal.ink} />
      </Tactile>
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  empty: { color: Signal.inkSoft, fontSize: TypeScale.body },
  retry: { marginTop: 16, paddingHorizontal: 22 },
  heroText: { alignItems: 'center', paddingHorizontal: 16, marginTop: 16 },
  name: { color: Signal.ink, fontSize: TypeScale.detail, fontWeight: '700' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4, marginTop: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Signal.wave },
  statText: { color: Signal.inkSoft, fontSize: TypeScale.body, fontWeight: '400', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 18 },
  actionWrap: { flex: 1 },
  action: { minHeight: 48, borderRadius: Radius.control, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primary: { backgroundColor: Signal.wave },
  glass: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  follow: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  followOn: { borderColor: 'rgba(217, 230, 106, 0.5)', backgroundColor: 'rgba(217, 230, 106, 0.1)' },
  actionText: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '700' },
  about: {
    marginHorizontal: 16,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: Radius.sheet,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },
  aboutHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  aboutTitle: { color: Signal.ink, fontSize: TypeScale.section, fontWeight: '700' },
  aboutText: { color: Signal.inkSoft, fontSize: TypeScale.body, lineHeight: 21 },
  backWrap: { position: 'absolute', left: 14 },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radius.sheet,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
});

export default ArtistScreen;
