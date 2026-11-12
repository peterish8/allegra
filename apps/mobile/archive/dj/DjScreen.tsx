import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';

import { useIsFocused } from '@react-navigation/native';
import type { DjGoal, DjProvider, DjSessionState, DjTrackContext, DjTurnRequest } from '@shared/dj';
import { getDjSlashSuggestions, parseDjSlashCommand } from '@shared/dj';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import { fromAllegraSong } from '@shared/songRef';
import type { UnifiedSong as CatalogSong } from '@shared/types';
import Artwork from '../components/allegra/Artwork';
import { useAppActive } from '../hooks/useAppActive';
import { actWhereMusicIs } from '../services/connect/playbackIntents';
import { requestDjTurn } from '../services/dj/djApi';
import { hasDownloadedDjModel, prepareDjModel, requestLocalDjTurn } from '../services/dj/localDj';
import { StreamService } from '../services/stream/StreamService';
import { STREAM_QUEUE_ID } from '../services/stream/streamSong';
import { addOnlineSongsToPlaylist } from '../services/sync/onlinePlaylist';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { useStreamHistoryStore } from '../store/streamHistoryStore';
import {
  Button, Chip, ChipRow, Glass, GUTTER, Haptics, IconButton, OnMedia, Panel, Radius, SheetOption, Signal, Space,
  Tactile,
  TextButton, TypeScale,
  Text as UIText,
  useBottomClearance,
} from '../ui';
import { countOf } from '../utils/formatters';

type Pick = { readonly song: CatalogSong; readonly reason: string };
type Emotion = 'idle' | 'listening' | 'thinking' | 'curious' | 'happy' | 'error';
const EMPTY_SESSION: DjSessionState = { vibe: '', energy: 3, language: null, constraints: [] };

function contextSong(song: { readonly id: string; readonly title: string; readonly artist?: string; readonly language?: string }): DjTrackContext {
  return { id: song.id, title: song.title, artist: song.artist ?? '', ...(song.language ? { language: song.language } : {}) };
}

function toneFor(vibe: string, energy: number): string[] {
  if (energy >= 4 || /hype|upbeat|energetic|workout/i.test(vibe)) return ['#fff0de', '#ffbf86', '#ff875b'];
  if (/late|night|dream|melanchol|romantic/i.test(vibe)) return ['#f0ecff', '#b1a4ff', '#766fe0'];
  if (/focus|calm|chill|easy/i.test(vibe)) return ['#e8f5ff', '#9bd9ee', '#62b9dd'];
  return ['#fff4dc', '#ffd072', '#ff9b35'];
}

function DjMascot({ vibing, emotion, tone, onPet, visible }: { readonly vibing: boolean; readonly emotion: Emotion; readonly tone: string[]; readonly onPet: () => void; readonly visible: boolean }) {
  // The DJ is a tab that stays mounted behind other screens; its endless loops run on the UI thread, which
  // freezing the screen does not stop. Hidden or in the background, the mascot rests like reduced motion.
  const reduce = useReducedMotion() || !visible;
  const roam = useSharedValue(0);
  const float = useSharedValue(0);
  const blink = useSharedValue(1);
  const bounce = useSharedValue(0);
  const shape = useSharedValue(170);
  const beat = useSharedValue(0);
  const listening = useSharedValue(0);
  const squint = useSharedValue(1);
  const curious = useSharedValue(0);
  useEffect(() => {
    if (reduce || emotion === 'thinking') {
      roam.value = withTiming(0, { duration: 300 });
      float.value = withTiming(0, { duration: 300 });
      return () => { cancelAnimation(roam); cancelAnimation(float); };
    }
    const pace = vibing ? 1800 : 3400;
    roam.value = withRepeat(withSequence(
      withTiming(0.6, { duration: pace }), withTiming(-0.8, { duration: pace + 300 }),
      withTiming(0.25, { duration: pace - 200 }), withTiming(0, { duration: pace + 200 }),
    ), -1);
    float.value = withRepeat(withSequence(withTiming(-0.4, { duration: pace }), withTiming(0.5, { duration: pace + 200 }), withTiming(0, { duration: pace })), -1);
    return () => { cancelAnimation(roam); cancelAnimation(float); };
  }, [emotion, float, reduce, roam, vibing]);
  useEffect(() => {
    if (reduce) { blink.value = 1; return undefined; }
    blink.value = withRepeat(withSequence(withTiming(0.08, { duration: 85 }), withTiming(1, { duration: 130 }), withTiming(1, { duration: 3700 })), -1);
    return () => cancelAnimation(blink);
  }, [blink, reduce]);
  useEffect(() => {
    if (reduce || emotion !== 'happy') { bounce.value = withTiming(0, { duration: 180 }); return undefined; }
    bounce.value = withSequence(withTiming(-1, { duration: 110 }), withTiming(0.25, { duration: 170 }), withTiming(0, { duration: 240 }));
    return () => cancelAnimation(bounce);
  }, [bounce, emotion, reduce]);
  useEffect(() => {
    if (reduce || emotion !== 'curious') { curious.value = withTiming(0, { duration: reduce ? 0 : 180 }); return undefined; }
    curious.value = withSequence(withTiming(0.9, { duration: 170 }), withTiming(-0.3, { duration: 260 }), withTiming(0, { duration: 430 }));
    return () => cancelAnimation(curious);
  }, [curious, emotion, reduce]);
  const toneKey = tone[2];
  useEffect(() => {
    const paletteShape = toneKey === '#766fe0' ? 176 : toneKey === '#62b9dd' ? 198 : toneKey === '#ff875b' ? 118 : 154;
    const target = emotion === 'thinking' ? 208 : emotion === 'curious' ? 188 : emotion === 'happy' ? 112 : emotion === 'error' ? 132 : vibing ? 140 : paletteShape;
    shape.value = withTiming(target, { duration: reduce ? 0 : 850 });
  }, [emotion, reduce, shape, toneKey, vibing]);
  useEffect(() => {
    if (reduce || !vibing) { beat.value = withTiming(0, { duration: 350 }); return undefined; }
    beat.value = withRepeat(withSequence(withTiming(1, { duration: 180 }), withTiming(0.12, { duration: 620 })), -1);
    return () => cancelAnimation(beat);
  }, [beat, reduce, vibing]);
  useEffect(() => { listening.value = withTiming(emotion === 'listening' ? 1 : 0, { duration: reduce ? 0 : 320 }); }, [emotion, listening, reduce]);
  useEffect(() => { squint.value = withTiming(emotion === 'error' ? 0.88 : 1, { duration: reduce ? 0 : 220 }); }, [emotion, reduce, squint]);
  const eyeGroup = useAnimatedStyle(() => ({ transform: [{ translateX: roam.value * 9 + curious.value * 8 }, { translateY: float.value * 6 + bounce.value * 8 + listening.value * 5 - curious.value * 4 }, { rotate: `${roam.value * 1.5 + curious.value * 2}deg` }] as const }));
  const leftEye = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value * squint.value }, { rotate: '-9deg' }] as const }));
  const rightEye = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value * Math.min(1, squint.value + 0.025) }, { rotate: '8deg' }, { translateY: 5 }] as const }));
  const outerAura = useAnimatedStyle(() => ({ borderRadius: shape.value, transform: [{ scaleX: 1 + beat.value * 0.018 }, { scaleY: 1 + beat.value * 0.026 }] as const }));
  const softAura = useAnimatedStyle(() => ({ borderRadius: shape.value + 38, transform: [{ scaleX: 1 + beat.value * 0.024 }, { scaleY: 1 + beat.value * 0.034 }] as const }));
  const coreAura = useAnimatedStyle(() => ({ borderRadius: shape.value * 0.72, transform: [{ scaleX: 1 + beat.value * 0.04 }, { scaleY: 1 + beat.value * 0.05 }] as const }));
  return (
    <Tactile accessible accessibilityRole="button" accessibilityLabel={vibing ? 'Tap your DJ to say hi' : 'Tap your DJ to wake it up'} onPress={onPet} style={styles.mascot}>
      <Animated.View style={[styles.glow, { backgroundColor: tone[0] }, outerAura]} />
      <Animated.View style={[styles.glowSoft, { backgroundColor: tone[1] }, softAura]} />
      <Animated.View style={[styles.glowCore, { backgroundColor: tone[2] }, coreAura]} />
      <Animated.View style={[styles.eyes, eyeGroup]}>
        <Animated.View style={[styles.eye, styles.eyeLeft, leftEye]} />
        <Animated.View style={[styles.eye, styles.eyeRight, rightEye]} />
      </Animated.View>
    </Tactile>
  );
}

export const DjScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const currentSong = usePlayerStore(state => state.currentSong);
  const isPlaying = usePlayerStore(state => state.isPlaying);
  const focused = useIsFocused();
  const appActive = useAppActive();
  const playlistQueue = usePlayerStore(state => state.playlistQueue);
  const currentQueueIndex = usePlayerStore(state => state.currentQueueIndex);
  const currentPlaylistId = usePlayerStore(state => state.currentPlaylistId);
  const requestPlayback = usePlayerStore(state => state.requestPlayback);
  const plays = useStreamHistoryStore(state => state.plays);
  const toggleLike = useSongsStore(state => state.toggleLike);
  const librarySongs = useSongsStore(state => state.songs);
  const createPlaylist = usePlaylistStore(state => state.createPlaylist);
  const deletePlaylist = usePlaylistStore(state => state.deletePlaylist);
  const [provider, setProvider] = useState<DjProvider>('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goal, setGoal] = useState<DjGoal>('mix');
  const [songLimit, setSongLimit] = useState(8);
  const [prompt, setPrompt] = useState('');
  const promptInputRef = useRef<TextInput>(null);
  const [session, setSession] = useState<DjSessionState>(EMPTY_SESSION);
  const [history, setHistory] = useState<DjTurnRequest['history'][number][]>([]);
  const [skipped, setSkipped] = useState<DjTrackContext[]>([]);
  const [draft, setDraft] = useState<Pick[]>([]);
  const [draftName, setDraftName] = useState('A little mix');
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emotion, setEmotion] = useState<Emotion>('idle');
  const [status, setStatus] = useState('');
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [djStarted, setDjStarted] = useState(false);
  const streamSeed = currentSong ? StreamService.catalogFor(currentSong.id) : undefined;
  const isLive = djStarted && currentPlaylistId === STREAM_QUEUE_ID;
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return plays.flatMap(({ song }) => {
      const catalog = StreamService.catalogFor(song.id);
      if (!catalog || seen.has(catalog.id)) return [];
      seen.add(catalog.id);
      return [catalog];
    }).slice(0, 8);
  }, [plays]);
  const favorites = useMemo(() => librarySongs.filter(song => song.isLiked && !song.isHidden).slice(0, 8), [librarySongs]);
  const nextUp = useMemo(() => playlistQueue?.slice(currentQueueIndex + 1, currentQueueIndex + 1 + songLimit) ?? [], [playlistQueue, currentQueueIndex, songLimit]);
  const currentContext = streamSeed ? contextSong(streamSeed) : currentSong ? contextSong(currentSong) : null;
  const tone = toneFor(session.vibe, session.energy);

  useEffect(() => {
    if (provider === 'openai') setModel('gpt-4o-mini');
    else if (provider === 'openrouter') setModel('openai/gpt-4o-mini');
    else if (provider === 'gemini') setModel('gemini-3.8-flash');
    else setModel('Qwen3 0.6B (on-device)');
  }, [provider]);
  useEffect(() => { hasDownloadedDjModel().then(setModelDownloaded); }, []);
  useEffect(() => { if (currentPlaylistId !== STREAM_QUEUE_ID) setDjStarted(false); }, [currentPlaylistId]);
  useEffect(() => {
    if (emotion !== 'curious') return undefined;
    const timer = setTimeout(() => setEmotion(current => current === 'curious' ? 'idle' : current), 1100);
    return () => clearTimeout(timer);
  }, [emotion]);

  const prepareLocalModel = useCallback(async () => {
    setWorking(true);
    setStatus('Preparing the on-device DJ…');
    setEmotion('thinking');
    try {
      await prepareDjModel(setStatus);
      setModelDownloaded(true);
      setStatus('The on-device model is ready and saved on this device.');
      setEmotion('happy');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The local model could not be downloaded.');
      setEmotion('error');
    } finally { setWorking(false); }
  }, []);

  const send = useCallback(async (override?: string, options?: { readonly goal?: DjGoal; readonly songLimit?: number }) => {
    const message = (override ?? prompt).trim();
    if (!message || working) return;
    const selectedGoal = options?.goal ?? goal;
    const selectedSongLimit = options?.songLimit ?? songLimit;
    if (provider !== 'local' && !apiKey.trim()) {
      setSettingsOpen(true);
      setStatus('Add your AI key to start a DJ conversation.');
      return;
    }
    if (provider !== 'local' && !model.trim()) {
      setSettingsOpen(true);
      setStatus('Choose a model that supports tool calling.');
      return;
    }
    setWorking(true);
    setEmotion('thinking');
    setStatus(provider === 'local' && !modelDownloaded ? 'First use downloads the local model once…' : 'Reading your set and searching the music catalog…');
    try {
      const draftContext = draft.map(({ song }) => contextSong(song));
      const common = {
        goal: selectedGoal, songLimit: selectedGoal === 'mix' ? Math.min(selectedSongLimit, 8) : selectedSongLimit, message,
        history: history.slice(-8), current: currentContext,
        queue: nextUp.map(contextSong), draft: draftContext, draftName,
        recent: recent.map(contextSong), liked: favorites.map(contextSong), skipped, session,
      };
      const result = provider === 'local'
        ? await requestLocalDjTurn({ ...common, draft, onProgress: setStatus })
        : await requestDjTurn({ ...common, provider, apiKey: apiKey.trim(), model: model.trim() });
      setSession(result.session);
      setHistory(current => [...current, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: result.reply }].slice(-8));

      if (selectedGoal === 'playlist') {
        const removed = new Set(result.removeTrackIds);
        const remaining = draft.filter(({ song }) => !removed.has(song.id));
        const nextDraft = result.draftOperation === 'replace' ? result.queue
          : result.draftOperation === 'extend' ? [...remaining, ...result.queue]
            : remaining;
        setDraft([...nextDraft].slice(0, selectedSongLimit));
        if (result.playlistName) setDraftName(result.playlistName);
        setStatus(result.reply);
        setEmotion(result.reaction === 'excited' || result.reaction === 'dreamy' ? 'happy' : 'idle');
      } else {
        setDraft([]);
        if (result.operation === 'replace_upcoming' || result.operation === 'insert') {
          const songs = result.queue.map(item => item.song);
          if (currentSong && StreamService.applyDjUpcoming(songs, result.operation, result.insertAfter)) {
            setStatus(result.reply);
            setEmotion(result.reaction === 'excited' || result.reaction === 'dreamy' ? 'happy' : 'idle');
          } else {
            setStatus(result.queue.length ? 'Your set is ready. Press Play to start it.' : result.reply);
            setEmotion(result.queue.length ? 'happy' : 'idle');
          }
        } else {
          setStatus(result.reply);
          setEmotion(result.reaction === 'confused' ? 'error' : 'idle');
        }
      }
      setPrompt('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The DJ could not finish that request. Try again.');
      setEmotion('error');
    } finally { setWorking(false); }
  }, [apiKey, currentContext, currentSong, draft, draftName, favorites, goal, history, model, modelDownloaded, nextUp, prompt, provider, recent, session, skipped, songLimit, working]);

  const submitPrompt = useCallback(() => {
    const value = prompt.trim();
    const parsed = parseDjSlashCommand(value);
    if (!parsed) {
      if (value.startsWith('/')) { setStatus('Unknown shortcut. Type / to see the DJ commands.'); return; }
      send(value);
      return;
    }

    const { command, remainder } = parsed;
    setPrompt('');
    setEmotion('idle');
    if (command.action === 'settings') { setSettingsOpen(true); setStatus('Choose your AI provider or set up a key below.'); return; }
    if (command.action === 'help') { setStatus('Try /late-night, /tamil, /energy, /focus, /similar, /keep, /mix, /playlist, /size, or /settings.'); return; }
    if (command.action === 'size') {
      if (!parsed.size) { setPrompt('/size '); setStatus('Choose a song count from the suggestions.'); return; }
      const minimum = goal === 'playlist' ? 5 : 1;
      const maximum = goal === 'playlist' ? 30 : 8;
      const selectedSongLimit = Math.max(minimum, Math.min(maximum, parsed.size));
      setSongLimit(selectedSongLimit);
      if (remainder) { send(remainder, { songLimit: selectedSongLimit }); return; }
      setStatus(`I’ll line up ${selectedSongLimit} songs.`);
      return;
    }
    if (command.action === 'goal' && command.goal) {
      const selectedSongLimit = command.goal === 'mix' ? Math.min(songLimit, 8) : Math.max(songLimit, 10);
      setGoal(command.goal);
      setSongLimit(selectedSongLimit);
      if (remainder) { send(remainder, { goal: command.goal, songLimit: selectedSongLimit }); return; }
      setStatus(command.goal === 'playlist' ? 'Playlist draft ready. Tell me the mood or first song.' : 'Live mix ready. What are we feeling?');
      return;
    }
    if (command.action === 'prompt') send([command.prompt, remainder].filter(Boolean).join(' '));
  }, [goal, prompt, send, songLimit]);

  const skipCurrent = useCallback(() => {
    if (!currentSong) return;
    setEmotion('curious');
    if (streamSeed) setSkipped(current => [contextSong(streamSeed), ...current.filter(song => song.id !== streamSeed.id)].slice(0, 8));
    // Where the music is: another device's queue when this phone is its remote, else this phone's.
    actWhereMusicIs({ kind: 'next' }, () => { usePlayerStore.getState().nextInPlaylist().catch(() => undefined); }).catch(() => undefined);
  }, [currentSong, streamSeed]);

  const savePlaylist = useCallback(async () => {
    if (!draft.length || saving) return;
    setSaving(true);
    setStatus('Saving your playlist…');
    try {
      const snapshots = draft.flatMap(({ song }): SongSnapshot[] => {
        const ref: SongRef | null = fromAllegraSong(song);
        return ref ? [{ ref, title: song.title, artist: song.artist, ...(song.album ? { album: song.album } : {}), artwork: song.artwork, duration: song.duration }] : [];
      });
      if (snapshots.length !== draft.length) throw new Error('One of these songs cannot be saved to your synced playlist. Remove it and try again.');
      const id = await createPlaylist(draftName.trim() || 'A little mix', 'Made with Allegra DJ');
      const saved = await addOnlineSongsToPlaylist(id, snapshots);
      if (!saved) {
        await deletePlaylist(id).catch(() => undefined);
        throw new Error('The playlist could not be saved. Your draft is still here to retry.');
      }
      setStatus(`Saved “${draftName.trim() || 'A little mix'}” to your playlists.`);
      setEmotion('happy');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The playlist could not be saved.');
      setEmotion('error');
    } finally { setSaving(false); }
  }, [createPlaylist, deletePlaylist, draft, draftName, saving]);

  const startSet = useCallback(() => {
    if (goal === 'playlist') return;
    const songs = draft.length ? draft.map(item => item.song) : [];
    const count = StreamService.startDjCatalog(songs);
    if (count) { setDjStarted(true); setStatus('Your mix is playing. I’ll keep learning as we go.'); }
  }, [draft, goal]);

  const petMascot = useCallback(() => {
    if (!working) setEmotion('happy');
  }, [working]);

  const vibing = Boolean(currentSong && isPlaying);
  const currentSongLiked = Boolean(currentSong?.isLiked);
  const canStart = goal === 'mix' && draft.length > 0;
  const commandSuggestions = getDjSlashSuggestions(prompt, goal);

  return (
    <AppScreen><KeyboardAvoidingView style={[styles.screen, { backgroundColor: 'transparent' }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, Space.md), paddingBottom: bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DjMascot vibing={vibing} emotion={emotion} tone={tone} onPet={petMascot} visible={focused && appActive} />

        <View>
          <View style={[styles.inputRow, emotion === 'listening' && styles.inputRowFocused]}>
            <TextInput ref={promptInputRef} value={prompt} onChangeText={value => { setPrompt(value); setStatus(''); }} onFocus={() => setEmotion('listening')} onBlur={() => setEmotion(current => current === 'listening' ? 'idle' : current)} onSubmitEditing={submitPrompt} returnKeyType="send" maxLength={500} placeholder="Ask for a mood, a song, or type /" placeholderTextColor={OnMedia.muted} style={styles.input} accessibilityLabel="Ask your DJ for music or type a slash command" accessibilityHint="Type slash to browse music and playlist shortcuts" />
            <IconButton icon="arrow-up" label="Ask the DJ" variant="primary" size="sm" disabled={working || !prompt.trim()} onPress={submitPrompt}>
              {working ? <ActivityIndicator size="small" color={Signal.waveInk} /> : undefined}
            </IconButton>
          </View>
          {commandSuggestions.length ? (
            <Panel style={styles.commandMenu} padding={Space.xxs}>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} accessibilityLabel="DJ shortcuts">
                {commandSuggestions.map(suggestion => (
                  <SheetOption
                    key={suggestion.command}
                    label={suggestion.label}
                    hint={suggestion.detail}
                    trailing={<UIText variant="caption" tone="muted">{suggestion.command}</UIText>}
                    onPress={() => { setPrompt(suggestion.command); setStatus(''); requestAnimationFrame(() => promptInputRef.current?.focus()); }}
                  />
                ))}
              </ScrollView>
            </Panel>
          ) : null}
          {settingsOpen ? (
            <Panel style={styles.settingsPanel}>
              <UIText variant="row">Choose your DJ brain</UIText>
              <ChipRow gutter={0}>
                {(['openai', 'openrouter', 'gemini', 'local'] as const).map(value => (
                  <Chip key={value} label={value === 'openrouter' ? 'OpenRouter' : value === 'local' ? 'On this phone' : value === 'openai' ? 'OpenAI' : 'Gemini'} selected={provider === value} onPress={() => setProvider(value)} />
                ))}
              </ChipRow>
              {provider === 'local' ? <>
                <UIText variant="caption" tone="muted">Qwen3 0.6B runs on this phone. The first download is about 390 MB and stays in app storage, so later requests are understood offline. Finding songs still needs a connection.</UIText>
                <Button label={modelDownloaded ? 'Model ready on this phone' : working ? 'Preparing the model…' : 'Download the model'} icon={modelDownloaded ? 'checkmark' : 'arrow-down'} block disabled={working || modelDownloaded} onPress={() => { prepareLocalModel(); }} />
              </> : <>
                <TextInput value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} placeholder="Tool-calling model ID" placeholderTextColor={OnMedia.muted} style={styles.settingsInput} accessibilityLabel="AI model" />
                <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="none" placeholder={`${provider === 'gemini' ? 'Gemini' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API key`} placeholderTextColor={OnMedia.muted} style={styles.settingsInput} accessibilityLabel="AI provider API key" />
                <UIText variant="caption" tone="muted">Your key goes with each request only. Allegra doesn’t save it.</UIText>
                {apiKey ? <TextButton label="Forget key" tone="danger" onPress={() => setApiKey('')} /> : null}
              </>}
            </Panel>
          ) : null}
        </View>

        {currentSong ? (
          <Panel style={styles.currentCard} padding={Space.sm}>
            <View style={styles.art54}><Artwork uri={currentSong.coverImageUri ?? currentSong.coverRemoteUri} title={currentSong.title} artist={currentSong.artist ?? ''} size={54} style={StyleSheet.absoluteFill} /></View>
            <View style={styles.trackCopy}>
              <UIText variant="meta" tone="muted">{isLive ? 'Right now' : 'Playing'}</UIText>
              <UIText variant="row" numberOfLines={1}>{currentSong.title}</UIText>
              <UIText variant="secondary" tone="muted" numberOfLines={1}>{currentSong.artist}</UIText>
            </View>
            <IconButton icon={currentSongLiked ? 'heart' : 'heart-outline'} label={currentSongLiked ? 'Unlike song' : 'Like song'} variant="plain" haptic="light" onPress={async () => { const result = await toggleLike(currentSong.id); if (result === 'liked' && streamSeed) StreamService.love(streamSeed.id); }}>
              <Ionicons name={currentSongLiked ? 'heart' : 'heart-outline'} size={20} color={currentSongLiked ? Signal.accent : OnMedia.secondary} />
            </IconButton>
            <IconButton icon={isPlaying ? 'pause' : 'play'} label={isPlaying ? 'Pause' : 'Play'} variant="plain" onPress={() => { Haptics.commit(); actWhereMusicIs({ kind: isPlaying ? 'pause' : 'play' }, () => requestPlayback(!isPlaying)).catch(() => undefined); }} />
            <IconButton icon="play-skip-forward" label="Skip song" variant="plain" onPress={skipCurrent} />
          </Panel>
        ) : null}

        {goal === 'mix' && canStart ? <Button label="Start this set" icon="play" variant="primary" block onPress={startSet} haptic="light" /> : null}

        {goal === 'playlist' ? (
          <Panel style={styles.draftCard}>
            <View style={styles.draftHeading}>
              <View><UIText variant="meta" tone="muted">Your playlist</UIText><UIText variant="lead">Shape the draft</UIText></View>
              <UIText variant="caption" tone="muted" tabular>{draft.length}/{songLimit}</UIText>
            </View>
            <TextInput value={draftName} onChangeText={setDraftName} maxLength={100} placeholder="Playlist name" placeholderTextColor={OnMedia.muted} style={styles.nameInput} accessibilityLabel="Playlist name" />
            {draft.length ? draft.map(({ song, reason }, index) => (
              <View key={song.id} style={styles.draftTrack}>
                <UIText variant="caption" tone="muted" tabular style={styles.queueIndex}>{index + 1}</UIText>
                <View style={styles.art42}><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={42} style={StyleSheet.absoluteFill} /></View>
                <View style={styles.trackCopy}>
                  <UIText variant="row" numberOfLines={1}>{song.title}</UIText>
                  <UIText variant="secondary" tone="muted" numberOfLines={1}>{song.artist}</UIText>
                  {reason ? <UIText variant="caption" tone="muted" numberOfLines={2}>{reason}</UIText> : null}
                </View>
                <IconButton icon="close" label={`Remove ${song.title}`} variant="plain" size="sm" onPress={() => setDraft(items => items.filter(item => item.song.id !== song.id))} />
              </View>
            )) : <UIText variant="secondary" tone="muted">Tell the DJ a mood, a few songs or a starting point to build your first draft.</UIText>}
            {draft.length ? <Button label={saving ? 'Saving…' : 'Save playlist'} icon="checkmark" variant="primary" block busy={saving} onPress={() => { savePlaylist(); }} /> : null}
          </Panel>
        ) : draft.length > 0 ? (
          <Panel style={styles.draftCard}>
            <View style={styles.draftHeading}>
              <View><UIText variant="meta" tone="muted">Ready when you are</UIText><UIText variant="lead">Coming up</UIText></View>
              <UIText variant="caption" tone="muted" tabular>{countOf(draft.length, 'song')}</UIText>
            </View>
            {draft.map(({ song, reason }, index) => (
              <View key={song.id} style={styles.draftTrack}>
                <UIText variant="caption" tone="muted" tabular style={styles.queueIndex}>{index + 1}</UIText>
                <View style={styles.art42}><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={42} style={StyleSheet.absoluteFill} /></View>
                <View style={styles.trackCopy}>
                  <UIText variant="row" numberOfLines={1}>{song.title}</UIText>
                  <UIText variant="secondary" tone="muted" numberOfLines={1}>{song.artist}</UIText>
                  {reason ? <UIText variant="caption" tone="muted" numberOfLines={2}>{reason}</UIText> : null}
                </View>
              </View>
            ))}
          </Panel>
        ) : null}

        {goal === 'mix' && nextUp.length > 0 ? (
          <Panel style={styles.draftCard}>
            <UIText variant="lead">Already in your queue</UIText>
            {nextUp.map((song, index) => (
              <View key={`${song.id}:${index}`} style={styles.draftTrack}>
                <UIText variant="caption" tone="muted" tabular style={styles.queueIndex}>{index + 1}</UIText>
                <View style={styles.art42}><Artwork uri={song.coverImageUri} title={song.title} artist={song.artist ?? ''} size={42} style={StyleSheet.absoluteFill} /></View>
                <View style={styles.trackCopy}>
                  <UIText variant="row" numberOfLines={1}>{song.title}</UIText>
                  <UIText variant="secondary" tone="muted" numberOfLines={1}>{song.artist}</UIText>
                </View>
              </View>
            ))}
          </Panel>
        ) : null}

        {status ? <UIText variant="secondary" tone="muted" align="center" accessibilityLiveRegion="polite" style={styles.status}>{status}</UIText> : null}
      </ScrollView>
    </KeyboardAvoidingView></AppScreen>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bgDeep },
  content: { paddingHorizontal: GUTTER, gap: Space.sm },
  // The DJ lives in a dark room like the rest of the app; its colours are soft light behind the eyes.
  mascot: { height: 272, borderRadius: Radius.panel, overflow: 'hidden', backgroundColor: Signal.bgSubtle, alignItems: 'center', justifyContent: 'center', position: 'relative', borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  glow: { position: 'absolute', width: '112%', height: '100%', bottom: -12, borderRadius: 200, opacity: 0.18 },
  glowSoft: { position: 'absolute', width: '78%', height: '65%', bottom: -16, borderRadius: 180, opacity: 0.28 },
  glowCore: { position: 'absolute', width: '48%', height: '40%', bottom: 4, borderRadius: 180, opacity: 0.34 },
  eyes: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: 72 },
  eye: { width: 36, height: 52, backgroundColor: OnMedia.primary, borderRadius: 28 },
  eyeLeft: { transform: [{ rotate: '-9deg' }] }, eyeRight: { height: 44, transform: [{ rotate: '8deg' }, { translateY: 4 }] },
  inputRow: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong, backgroundColor: Glass.fillLight, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', paddingLeft: Space.md, paddingRight: Space.xs },
  inputRowFocused: { borderColor: 'rgba(255,255,255,0.32)' },
  input: { flex: 1, minHeight: 48, color: OnMedia.primary, fontSize: TypeScale.body, paddingVertical: Space.xs },
  commandMenu: { maxHeight: 260, marginTop: Space.xs },
  settingsPanel: { marginTop: Space.sm, gap: Space.sm },
  settingsInput: { color: OnMedia.primary, backgroundColor: Glass.fillLight, borderRadius: Space.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline, paddingHorizontal: Space.sm, minHeight: 44, fontSize: TypeScale.secondary },
  currentCard: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  art54: { width: 54, height: 54, borderRadius: Space.xs, overflow: 'hidden' },
  art42: { width: 42, height: 42, borderRadius: Space.xs, overflow: 'hidden' },
  trackCopy: { flex: 1, minWidth: 0, gap: 2 },
  draftCard: { gap: Space.sm },
  draftHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameInput: { color: OnMedia.primary, fontSize: TypeScale.body, fontWeight: '600', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong, paddingVertical: Space.xs },
  draftTrack: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 52 },
  queueIndex: { width: 20, textAlign: 'right' },
  status: { paddingBottom: Space.xxs },
});

export default DjScreen;
