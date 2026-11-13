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
import { ActivityIndicator, Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { heroHeight, heroImageUrl } from '../components/playlist/heroFade';
import { ImmersiveHero, ImmersiveTopBar, useHeroScroll } from '../components/playlist/ImmersiveHero';
import { RiseIn, Tactile } from '../components/allegra/motion';
import { BrowseShelf } from '../components/browse/BrowseShelf';
import { Glass, Radius, Signal, TypeScale } from '../constants/allegraTheme';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { playEndpoint, playYTSongs } from '../services/stream/browsePlay';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { ArtistPage, Shelf, YTItem } from '../services/ytmusic/browse';
import { YTSong } from '../services/ytmusic/parsers';
import { useFollowedArtistsStore } from '../store/followedArtistsStore';
import { BrowseStackParamList } from '../types/navigation';
import * as Haptics from '../utils/haptics';
import { Button, TextButton, Surface } from '../ui';

type Props = NativeStackScreenProps<BrowseStackParamList, 'Artist'>;

/** The room every part of the page sits in. */
const ROOM = Surface.immersive;



const ArtistScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const { width, height } = useWindowDimensions();
  const scroll = useHeroScroll();
  const hero = heroHeight(width, height);

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
    if (!page) return;
    const categories = page.sections.filter(section => section.more || section === shelf);
    navigation.push('ArtistReleases', { artistId: page.browseId, artistName: page.name,
      selected: Math.max(0, categories.indexOf(shelf)), categories });
  }, [navigation, page]);



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
    <AppScreen staticGlow={false} style={[styles.fill, { backgroundColor: ROOM }]}>
      <Animated.ScrollView onScroll={scroll.onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
        <ImmersiveHero uri={heroImageUrl(page.thumbnail)} title={page.name}
          lines={[page.monthlyListeners ?? '', page.subscribers ?? '']} width={width} height={hero} scrollY={scroll.y} />

        <RiseIn index={0}>
          {/* Round 7 item 4: Play is the one filled capsule; Shuffle is a smaller frosted capsule (40 drawn, 48 touch);
              Radio and Follow stay text. */}
          <View style={styles.actions}>
            <Button label="Play" icon="play" variant="primary" haptic="select" disabled={!topSongs.length && !page.radio}
              onPress={() => { if (topSongs.length) play(topSongs, 0); else if (page.radio) playEndpoint(page.radio); }} />
            <Button label="Shuffle" icon="shuffle" size="compact" haptic="select"
              onPress={() => {
                if (page.shuffle) playEndpoint(page.shuffle, { shuffle: true });
                else if (topSongs.length) playYTSongs(topSongs, 0, { shuffle: true });
              }} />
          </View>
          <View style={styles.textActions}>
            <TextButton label="Radio" icon="radio-outline"
              onPress={() => { Haptics.selectionAsync().catch(() => {}); if (page.radio) playEndpoint(page.radio); else if (topSongs.length) play(topSongs, 0); }} />
            <TextButton label={followed ? 'Following' : 'Follow'} icon={followed ? 'checkmark' : 'person-add-outline'}
              accessibilityLabel={followed ? 'Following, tap to unfollow' : 'Follow'}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                useFollowedArtistsStore.getState().toggle({ browseId: page.browseId, name: page.name, thumbnail: page.thumbnail });
              }} />
          </View>
        </RiseIn>

        {page.description ? (
          <RiseIn index={1}>
            <Tactile onPress={() => setAboutOpen(o => !o)} pressScale={0.985} style={styles.about} accessibilityRole="button" accessibilityLabel={aboutOpen ? 'About, tap to collapse' : 'About, tap to read more'}>
              <View style={styles.aboutHead}>
                <Text style={styles.aboutTitle}>About</Text>
                <Ionicons name={aboutOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Signal.inkMuted} />
              </View>
              <Text style={styles.aboutText} numberOfLines={aboutOpen ? undefined : 3}>{page.description}</Text>
            </Tactile>
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
      </Animated.ScrollView>

      <ImmersiveTopBar title={page.name} height={hero} scrollY={scroll.y} topInset={insets.top} onBack={() => navigation.goBack()} />
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginTop: 18 },
  textActions: { flexDirection: 'row', gap: 16, paddingHorizontal: 20 },
  actionWrap: { flex: 1 },
  action: { minHeight: 48, borderRadius: Radius.control, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primary: { backgroundColor: Signal.wave },
  glass: { backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  follow: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  followOn: { borderColor: Glass.selectedRim, backgroundColor: Glass.selected },
  actionText: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '700' },
  about: {
    marginHorizontal: 16,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: Radius.sheet,
    backgroundColor: Surface.divider,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairline,
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
    backgroundColor: Glass.scrim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairlineStrong,
  },
});

export default ArtistScreen;
