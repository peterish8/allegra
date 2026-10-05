/**
 * One Blend on the phone: who is in it, the match, the story cards and the day's tracks. Playing
 * goes through the phone's own playback path (StreamService.play) with the Blend as the queue.
 * The first visit to each day's build opens with a short reveal (transform and opacity only;
 * reduced motion shows it without movement).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion, useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BLEND_TEXT, changeText, artistName, learningOffText } from '@shared/blendCopy';
import { utcDay } from '@shared/blendLimits';
import type { BlendDetail } from '@shared/blendView';

import { blendStyles as s, MemberDisc, MemberDiscs, StoryCards } from '../components/blend/BlendParts';
import { Motion, Signal } from '../constants/allegraTheme';
import { useAccount } from '../services/account/AccountProvider';
import { blendTrackSong, getBlend, getInvite, inviteUrl, leaveBlend } from '../services/blend/blendApi';
import { StreamService } from '../services/stream/StreamService';
import type { LibraryStackParamList } from '../types/navigation';

const revealKey = (detail: BlendDetail): string => `blend-revealed:${detail.members.find(member => member.isYou)?.userId ?? 'guest'}:${detail.id}:${detail.builtFor}:${detail.buildVersion ?? 0}`;

/** Two (or more) discs slide in from the edges and meet; then the match. Tap anywhere to continue. */
const Reveal: React.FC<{ detail: BlendDetail; onDone: () => void }> = ({ detail, onDone }) => {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    progress.value = reduced ? withTiming(1, { duration: Motion.duration.base }) : withSpring(1, Motion.spring.sheet);
  }, [progress, reduced]);
  const left = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateX: reduced ? 0 : (1 - progress.value) * -240 }] }));
  const right = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateX: reduced ? 0 : (1 - progress.value) * 240 }] }));
  const match = detail.members.length > 2 && detail.pairs.length > 0
    ? Math.round(detail.pairs.reduce((total, pair) => total + pair.match, 0) / detail.pairs.length)
    : detail.pairs[0]?.match ?? 0;
  return (
    <Pressable style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: Signal.bgDeep, alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 10 }} onPress={onDone} accessibilityRole="button" accessibilityLabel={`Taste match ${match} percent. Tap to see your Blend.`}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {detail.members.map((member, index) => (
          <Animated.View key={member.userId} style={index % 2 === 0 ? left : right}>
            <MemberDisc member={member} size={detail.members.length > 2 ? 48 : 72} />
          </Animated.View>
        ))}
      </View>
      <Text style={{ color: Signal.inkSoft, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{detail.members.length > 2 ? 'Group match' : 'Taste match'}</Text>
      <Animated.Text entering={FadeIn.duration(Motion.duration.slow)} style={{ color: Signal.ink, fontSize: 96, fontWeight: '800' }}>{match}%</Animated.Text>
      {detail.members.length <= 2 && detail.pairs[0]?.confidence === 'low' ? <Text style={{ color: Signal.ink }}>{BLEND_TEXT.lowconfidence}</Text> : null}
      <Text style={{ color: Signal.inkMuted }}>Tap to see your Blend</Text>
    </Pressable>
  );
};

export const BlendScreen: React.FC = () => {
  const route = useRoute<RouteProp<LibraryStackParamList, 'Blend'>>();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const account = useAccount();
  const token = account.signedIn ? account.token : null;
  const [detail, setDetail] = useState<BlendDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const activeToken = useRef(token);
  activeToken.current = token;
  useEffect(() => { setDetail(null); setError(null); setRevealing(false); setFilter(null); }, [account.profile?.userId, route.params.blendId]);

  const load = useCallback(async () => {
    if (!token) return;
    const result = await getBlend(token, route.params.blendId);
    if (activeToken.current !== token) return;
    if (result.ok === false) {
      setError(result.status === 404 ? BLEND_TEXT.notfound : result.error);
      return;
    }
    setDetail(result.data);
    setError(null);
    if (result.data.state === 'ready' && result.data.members.length >= 2) {
      const seen = await AsyncStorage.getItem(revealKey(result.data)).catch(() => null);
      if (activeToken.current !== token) return;
      if (seen !== '1') setRevealing(true);
    }
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
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <FlatList
        data={detail.state === 'ready' ? tracks : []}
        keyExtractor={(track) => track.song.ref}
        ListHeaderComponent={
          <View>
            <View style={[s.row, { paddingTop: 16 }]}>
              <MemberDiscs members={detail.members} size={40} />
              <View style={s.rowText}>
                <Text style={[s.title, { padding: 0 }]} numberOfLines={2} accessibilityRole="header">{detail.name}</Text>
                <Text style={s.rowMeta}>
                  {match !== undefined && detail.members.length >= 2 ? `${match}% ${group ? 'group match' : 'taste match'}` : 'Waiting for your friend'}
                  {!group && pair?.confidence === 'low' ? ` · ${BLEND_TEXT.lowconfidence}` : ''}
                  {!detail.stale && detail.builtFor === utcDay(Date.now()) ? ' · Updated today' : ''}
                </Text>
              </View>
            </View>
            {detail.change ? <Text style={s.note}>{changeText(detail.change, artistName(detail.change.artist, detail.tracks))}</Text> : null}
            {detail.stale && detail.members.length >= 2 ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={s.note}>Your Blend is waiting to refresh. Tap to refresh.</Text></Pressable> : null}
            {detail.members.filter((member) => !member.learning).map((member) => (
              <Text key={member.userId} style={s.note}>{member.isYou ? 'Your picks come from likes and playlists.' : learningOffText(member.displayName)}</Text>
            ))}
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {songs.length > 0 ? <Pressable style={s.primary} onPress={() => StreamService.play(songs, 0)} accessibilityRole="button"><Text style={s.primaryText}>Play</Text></Pressable> : null}
              <Pressable style={s.secondary} onPress={() => void invite()} accessibilityRole="button"><Text style={s.secondaryText}>Invite</Text></Pressable>
              <Pressable style={s.secondary} onPress={leave} accessibilityRole="button"><Text style={s.secondaryText}>Leave</Text></Pressable>
            </View>
            {detail.state === 'not_enough' ? <View style={s.panel}><Text style={s.panelBody}>{BLEND_TEXT.notenough}</Text></View> : <StoryCards detail={detail} />}
            {detail.state === 'ready' ? (
              <View style={[s.row, { flexWrap: 'wrap' }]} accessibilityRole="radiogroup">
                {[{ userId: null, label: 'All' }, ...detail.members.map((member) => ({ userId: member.userId, label: member.isYou ? 'You' : member.displayName }))].map((chip) => (
                  <Pressable key={chip.userId ?? 'all'} style={filter === chip.userId ? s.primary : s.secondary} onPress={() => setFilter(chip.userId)} accessibilityRole="radio" accessibilityState={{ checked: filter === chip.userId }}>
                    <Text style={filter === chip.userId ? s.primaryText : s.secondaryText}>{chip.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const holders = detail.members.filter((member) => item.for.includes(member.userId));
          return (
            <Pressable style={s.row} onPress={() => StreamService.play(songs, index)} accessibilityRole="button" accessibilityLabel={`Play ${item.song.title} by ${item.song.artist}`}>
              <View style={s.rowText}>
                <Text style={s.rowTitle} numberOfLines={1}>{item.song.title}</Text>
                <Text style={s.rowMeta} numberOfLines={1}>{item.song.artist}</Text>
              </View>
              {item.kind === 'discovery' ? <Text style={s.rowMeta}>{BLEND_TEXT.newForYou}</Text> : <MemberDiscs members={holders} size={22} />}
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: 160 }}
      />
      {revealing ? <Reveal detail={detail} onDone={finishReveal} /> : null}
    </SafeAreaView>
  );
};

export default BlendScreen;
