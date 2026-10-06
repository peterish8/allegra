/**
 * One Blend on the phone: its cover (the first four songs), who is in it, the match, a story you can
 * watch full screen (components/blend/BlendStoryPlayer) and the day's tracks with their covers. Playing
 * goes through the phone's own playback path (StreamService.play) with the Blend as the queue.
 * The hero is the Blend as light (components/blend/BlendStage): the orbs drift together until they
 * overlap by the match. The first visit to each day's build plays that as the reveal, in the hero
 * itself; the lens chips light the chosen person's orb. Transform and opacity only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BLEND_TEXT, changeText, artistName, learningOffText } from '@shared/blendCopy';
import { utcDay } from '@shared/blendLimits';
import type { BlendDetail } from '@shared/blendView';
import type { SongSnapshot } from '@shared/songRef';

import { blendStyles as s, discColour, MemberDiscs } from '../components/blend/BlendParts';
import { BlendStage } from '../components/blend/BlendStage';
import { BlendStoryPlayer } from '../components/blend/BlendStoryPlayer';
import { Artwork } from '../components/allegra/Artwork';
import { RiseIn, Tactile } from '../components/allegra/motion';
import { Glass, Motion, Radius, Signal, Space } from '../constants/allegraTheme';
import { shuffled } from '../utils/shuffle';
import { useAccount } from '../services/account/AccountProvider';
import { blendTrackSong, getBlend, getInvite, inviteUrl, leaveBlend } from '../services/blend/blendApi';
import { StreamService } from '../services/stream/StreamService';
import type { LibraryStackParamList } from '../types/navigation';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { BLEND_TOUR, blendScene } from '../components/allegra/infoTours';

const revealKey = (detail: BlendDetail): string => `blend-revealed:${detail.members.find(member => member.isYou)?.userId ?? 'guest'}:${detail.id}:${detail.builtFor}:${detail.buildVersion ?? 0}`;

export const BlendScreen: React.FC = () => {
  const route = useRoute<RouteProp<LibraryStackParamList, 'Blend'>>();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const account = useAccount();
  const token = account.signedIn ? account.token : null;
  const [detail, setDetail] = useState<BlendDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [pulse, setPulse] = useState(0);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const closeStory = useCallback(() => setWatching(false), []);
  const activeToken = useRef(token);
  activeToken.current = token;
  useEffect(() => { setDetail(null); setError(null); setRevealing(false); setFilter(null); setWatching(false); }, [account.profile?.userId, route.params.blendId]);

  const load = useCallback(async () => {
    if (!token) return;
    const result = await getBlend(token, route.params.blendId);
    if (activeToken.current !== token) return;
    if (result.ok === false) {
      setError(result.status === 404 ? BLEND_TEXT.notfound : result.error);
      return;
    }
    // Decide the reveal before the first paint of the hero, so the orbs never jump back apart.
    let reveal = false;
    if (result.data.state === 'ready' && result.data.members.length >= 2) {
      const seen = await AsyncStorage.getItem(revealKey(result.data)).catch(() => null);
      if (activeToken.current !== token) return;
      reveal = seen !== '1';
    }
    setDetail(result.data);
    setError(null);
    setRevealing(reveal);
    setPulse((count) => count + 1);
  }, [route.params.blendId, token]);

  useEffect(() => { void load(); }, [load]);

  const tracks = useMemo(() => (detail ? (filter ? detail.tracks.filter((track) => track.for.includes(filter)) : detail.tracks) : []), [detail, filter]);
  const songs = useMemo(() => tracks.map(blendTrackSong), [tracks]);

  const finishReveal = (): void => {
    setRevealing(false);
    if (detail) AsyncStorage.setItem(revealKey(detail), '1').catch(() => undefined);
  };

  const invite = async (): Promise<void> => {
    if (!token || !detail) return;
    const result = await getInvite(token, detail.id);
    if (result.ok === true) await Share.share({ message: `Blend with me on Allegra: ${inviteUrl(result.data)}` }).catch(() => undefined);
    else Alert.alert('Invite unavailable', result.error);
  };

  const leave = (): void => {
    if (!token || !detail) return;
    Alert.alert(`Leave ${detail.name}?`, "You'll stop seeing it, and it refreshes without your songs.", [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          void leaveBlend(token, detail.id).then((result) => {
            if (result.ok === true) navigation.navigate('Blends');
            else Alert.alert('That did not work', result.error);
          });
        },
      },
    ]);
  };

  if (error || !detail) {
    return (
      <SafeAreaView style={s.screen} edges={['top']}>
        <View style={s.panel}><Text style={s.panelBody}>{error ?? 'Loading your Blend…'}</Text></View>
      </SafeAreaView>
    );
  }

  const group = detail.members.length > 2;
  const pair = detail.pairs[0];
  const match = group && detail.pairs.length > 0 ? Math.round(detail.pairs.reduce((total, item) => total + item.match, 0) / detail.pairs.length) : pair?.match;
  const ready = detail.state === 'ready' && detail.members.length >= 2;
  const playFromStory = (song: SongSnapshot | null): void => {
    const all = detail.tracks.map(blendTrackSong);
    if (!song) { if (all.length) StreamService.play(all, 0); return; }
    const at = detail.tracks.findIndex((track) => track.song.ref === song.ref);
    if (at >= 0) StreamService.play(all, at);
    else StreamService.play([blendTrackSong({ song, for: [], kind: 'pick' })], 0);
  };
  const meta = [
    match !== undefined && detail.members.length >= 2 ? `${match}% ${group ? 'group match' : 'taste match'}` : 'Waiting for your friend',
    !group && pair?.confidence === 'low' ? BLEND_TEXT.lowconfidence : null,
    ready ? `${detail.tracks.length} songs` : null,
    !detail.stale && detail.builtFor === utcDay(Date.now()) ? 'Updated today' : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={s.screen}>
      <FlatList
        data={detail.state === 'ready' ? tracks : []}
        // Keyed by the lens too: switching person re-deals the list (rows rise in, a 40ms stagger).
        keyExtractor={(track) => `${filter ?? 'all'}:${track.song.ref}`}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + Space.sm }}>
            <RiseIn style={styles.hero}>
              <BlendStage
                key={revealing ? 'reveal' : 'stage'}
                members={detail.members}
                match={detail.members.length >= 2 ? match : undefined}
                group={group}
                intro={revealing}
                onIntroDone={finishReveal}
                focus={filter}
                onInvite={() => void invite()}
                pulse={pulse}
              />
              <InfoTitleRow style={{ justifyContent: 'center', marginTop: Space.sm }}><Text style={[styles.name, { marginTop: 0 }]} numberOfLines={2} accessibilityRole="header">{detail.name}</Text><InfoTour label="How this Blend works" steps={BLEND_TOUR} scene={blendScene} /></InfoTitleRow>
              <Text style={styles.meta}>{meta}</Text>
              <View style={styles.actions}>
                <Tactile onPress={() => void invite()} haptic="select" accessibilityRole="button" accessibilityLabel="Invite someone" style={styles.round}><Ionicons name="person-add-outline" size={20} color={Signal.ink} /></Tactile>
                <Tactile onPress={() => setWatching(true)} disabled={!ready} haptic="select" accessibilityRole="button" accessibilityLabel="Watch your Blend story" style={[styles.round, !ready && styles.dim]}><Ionicons name="film-outline" size={20} color={Signal.ink} /></Tactile>
                <Tactile onPress={() => { if (songs.length) StreamService.play(songs, 0); }} disabled={songs.length === 0} haptic="light" accessibilityRole="button" accessibilityLabel={`Play ${detail.name}`} style={[styles.play, songs.length === 0 && styles.dim]}><Ionicons name="play" size={28} color={Signal.waveInk} /></Tactile>
                <Tactile onPress={() => { if (songs.length) StreamService.play(shuffled(songs), 0); }} disabled={songs.length === 0} haptic="select" accessibilityRole="button" accessibilityLabel="Shuffle" style={[styles.round, songs.length === 0 && styles.dim]}><Ionicons name="shuffle" size={20} color={Signal.ink} /></Tactile>
                <Tactile onPress={leave} haptic="select" accessibilityRole="button" accessibilityLabel="Leave this Blend" style={styles.round}><Ionicons name="exit-outline" size={20} color={Signal.ink} /></Tactile>
              </View>
            </RiseIn>
            {detail.change ? <Text style={styles.note}>{changeText(detail.change, artistName(detail.change.artist, detail.tracks))}</Text> : null}
            {detail.stale && detail.members.length >= 2 ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.note}>Your Blend is waiting to refresh. Tap to refresh.</Text></Pressable> : null}
            {detail.members.filter((member) => !member.learning).map((member) => (
              <Text key={member.userId} style={styles.note}>{member.isYou ? 'Your picks come from likes and playlists.' : learningOffText(member.displayName)}</Text>
            ))}
            {detail.state === 'not_enough' ? <View style={s.panel}><Text style={s.panelBody}>{BLEND_TEXT.notenough}</Text></View> : null}
            {ready ? (
              <RiseIn index={1}>
                <Tactile onPress={() => setWatching(true)} pressScale={0.98} haptic="select" accessibilityRole="button" accessibilityLabel="Watch your Blend story" style={styles.storyTile}>
                  <View style={styles.storyStack}>
                    {detail.tracks.slice(0, 3).map((track, i) => (
                      <Artwork key={track.song.ref} uri={track.song.artwork} title={track.song.title} artist={track.song.artist} size={40} style={[styles.storyThumb, { marginLeft: i === 0 ? 0 : -18, transform: [{ rotate: `${(i - 1) * 8}deg` }] }]} />
                    ))}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.storyTitle}>Your Blend story</Text>
                    <Text style={styles.storySub} numberOfLines={1}>Your match, shared songs and who brought what</Text>
                  </View>
                  <Ionicons name="play-circle" size={34} color={Signal.wave} />
                </Tactile>
              </RiseIn>
            ) : null}
            {detail.state === 'ready' ? (
              <View style={styles.chips} accessibilityRole="radiogroup">
                {[{ userId: null, label: 'Everyone' }, ...detail.members.map((member) => ({ userId: member.userId, label: member.isYou ? 'You' : member.displayName }))].map((chip) => {
                  const on = filter === chip.userId;
                  return (
                    <Tactile key={chip.userId ?? 'all'} onPress={() => setFilter(chip.userId)} pressScale={0.96} haptic="select" accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.chip, on && styles.chipOn]}>
                      {chip.userId ? <View style={[styles.chipDot, { backgroundColor: discColour(chip.userId) }]} /> : null}
                      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{chip.label}</Text>
                    </Tactile>
                  );
                })}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const holders = detail.members.filter((member) => item.for.includes(member.userId));
          return (
            <Animated.View entering={reducedMotion ? FadeIn.duration(Motion.duration.fast) : FadeInDown.duration(Motion.duration.base).delay(Math.min(index, 6) * 40)}>
            <Tactile onPress={() => StreamService.play(songs, index)} pressScale={0.98} accessibilityRole="button" accessibilityLabel={`Play ${item.song.title} by ${item.song.artist}`} style={styles.track}>
              <Artwork uri={item.song.artwork} title={item.song.title} artist={item.song.artist} size={TRACK_ART} style={styles.trackArt} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.trackTitle} numberOfLines={1}>{item.song.title}</Text>
                <Text style={styles.trackArtist} numberOfLines={1}>{item.song.artist}</Text>
              </View>
              {item.kind === 'discovery' ? <Text style={styles.newTag}>{BLEND_TEXT.newForYou}</Text> : <MemberDiscs members={holders} size={22} />}
            </Tactile>
            </Animated.View>
          );
        }}
        contentContainerStyle={{ paddingBottom: 220 }}
      />
      <BlendStoryPlayer detail={detail} visible={watching} onClose={closeStory} onPlay={playFromStory} />
    </View>
  );
};

const TRACK_ART = 48;

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: Space.md, paddingBottom: Space.sm },
  name: { color: Signal.ink, fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: Space.sm },
  meta: { color: Signal.inkMuted, fontSize: 13, textAlign: 'center', marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.md },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  play: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  dim: { opacity: 0.45 },
  note: { color: Signal.inkMuted, fontSize: 13, paddingHorizontal: Space.md, textAlign: 'center', marginTop: 4 },
  storyTile: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginHorizontal: Space.md, marginTop: Space.md, padding: Space.sm, paddingLeft: Space.md, borderRadius: Radius.panel, backgroundColor: Glass.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  storyStack: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  storyThumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 1.5, borderColor: Signal.bg },
  storyTitle: { color: Signal.ink, fontSize: 16, fontWeight: '700' },
  storySub: { color: Signal.inkMuted, fontSize: 12, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, paddingHorizontal: Space.md, marginTop: Space.md, marginBottom: Space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline, maxWidth: 180 },
  chipOn: { backgroundColor: Signal.ink, borderColor: Signal.ink },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: Signal.inkSoft, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: Signal.bg },
  track: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 64, paddingHorizontal: Space.md, paddingVertical: 8 },
  trackArt: { width: TRACK_ART, height: TRACK_ART, borderRadius: Radius.thumb },
  trackTitle: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  trackArtist: { color: Signal.inkMuted, fontSize: 13, marginTop: 2 },
  newTag: { color: Signal.wave, fontSize: 12, fontWeight: '700' },
});

export default BlendScreen;
