import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { getDjSlashSuggestions, parseDjSlashCommand } from '@shared/dj';
import type { DjGoal, DjProvider, DjSessionState, DjTrackContext, DjTurnRequest } from '@shared/dj';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import { fromAllegraSong } from '@shared/songRef';
import type { UnifiedSong as CatalogSong } from '@shared/types';
import { useSongsStore } from '../store/songsStore';
import { usePlayerStore } from '../store/playerStore';
import { useStreamHistoryStore } from '../store/streamHistoryStore';
import { usePlaylistStore } from '../store/playlistStore';
import { StreamService } from '../services/stream/StreamService';
import { STREAM_QUEUE_ID } from '../services/stream/streamSong';
import { Signal, Space } from '../constants/allegraTheme';
import Artwork from '../components/allegra/Artwork';
import { actWhereMusicIs } from '../services/connect/playbackIntents';
import { requestDjTurn } from '../services/dj/djApi';
import { hasDownloadedDjModel, prepareDjModel, requestLocalDjTurn } from '../services/dj/localDj';
import { addOnlineSongsToPlaylist } from '../services/sync/onlinePlaylist';

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

function DjMascot({ vibing, emotion, tone, onPet }: { readonly vibing: boolean; readonly emotion: Emotion; readonly tone: string[]; readonly onPet: () => void }) {
  const reduce = useReducedMotion();
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
    <Pressable accessible accessibilityRole="button" accessibilityLabel={vibing ? 'Tap your DJ to say hi' : 'Tap your DJ to wake it up'} onPress={onPet} style={styles.mascot}>
      <Animated.View style={[styles.glow, { backgroundColor: tone[0] }, outerAura]} />
      <Animated.View style={[styles.glowSoft, { backgroundColor: tone[1] }, softAura]} />
      <Animated.View style={[styles.glowCore, { backgroundColor: tone[2] }, coreAura]} />
      <Animated.View style={[styles.eyes, eyeGroup]}>
        <Animated.View style={[styles.eye, styles.eyeLeft, leftEye]} />
        <Animated.View style={[styles.eye, styles.eyeRight, rightEye]} />
      </Animated.View>
    </Pressable>
  );
}

export const DjScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const currentSong = usePlayerStore(state => state.currentSong);
  const isPlaying = usePlayerStore(state => state.isPlaying);
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, Space.md), paddingBottom: Math.max(insets.bottom, Space.xl) + 128 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <DjMascot vibing={vibing} emotion={emotion} tone={tone} onPet={petMascot} />

        <View style={styles.composeCard}>
          <View style={[styles.inputRow, emotion === 'listening' && styles.inputRowFocused]}>
            <BlurView intensity={28} tint="light" pointerEvents="none" style={StyleSheet.absoluteFillObject} />
            <TextInput ref={promptInputRef} value={prompt} onChangeText={value => { setPrompt(value); setStatus(''); }} onFocus={() => setEmotion('listening')} onBlur={() => setEmotion(current => current === 'listening' ? 'idle' : current)} onSubmitEditing={submitPrompt} returnKeyType="send" maxLength={500} placeholder="Ask for a mood, song, or type /…" placeholderTextColor="#89919a" style={styles.input} accessibilityLabel="Ask your DJ for music or type a slash command" accessibilityHint="Type slash to browse music and playlist shortcuts" />
            <Pressable onPress={submitPrompt} disabled={working || !prompt.trim()} style={[styles.sendButton, (!prompt.trim() || working) && styles.dimmed]} accessibilityRole="button" accessibilityLabel="Ask the DJ">
              {working ? <ActivityIndicator size="small" color="#34312d" /> : <Ionicons name="arrow-up" size={19} color="#34312d" />}
            </Pressable>
          </View>
          {commandSuggestions.length ? <ScrollView style={styles.commandMenu} contentContainerStyle={styles.commandMenuContent} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} accessibilityLabel="DJ shortcuts">
            {commandSuggestions.map(suggestion => <Pressable key={suggestion.command} onPress={() => { setPrompt(suggestion.command); setStatus(''); requestAnimationFrame(() => promptInputRef.current?.focus()); }} style={styles.commandItem} accessibilityRole="button" accessibilityLabel={`${suggestion.command}, ${suggestion.detail}`}>
              <View style={styles.commandCopy}><Text style={styles.commandLabel}>{suggestion.label}</Text><Text style={styles.commandDetail}>{suggestion.detail}</Text></View><Text style={styles.commandName}>{suggestion.command}</Text>
            </Pressable>)}
          </ScrollView> : null}
          {settingsOpen ? (
            <View style={styles.settingsPanel}>
              <Text style={styles.settingsTitle}>Choose your DJ brain</Text>
              <View style={styles.providerRow}>
                {(['openai', 'openrouter', 'gemini', 'local'] as const).map(value => <Pressable key={value} onPress={() => setProvider(value)} style={[styles.providerChip, provider === value && styles.providerChipActive]}><Text style={[styles.providerText, provider === value && styles.providerTextActive]}>{value === 'openrouter' ? 'OpenRouter' : value === 'local' ? 'On-device' : value === 'openai' ? 'OpenAI' : 'Gemini'}</Text></Pressable>)}
              </View>
              {provider === 'local' ? <>
                <Text style={styles.settingsNote}>Qwen3 0.6B runs on this phone. First download is about 390 MB; it stays in app storage for later offline interpretation. Catalog search still needs a connection.</Text>
                <Pressable onPress={() => { prepareLocalModel(); }} disabled={working || modelDownloaded} style={[styles.downloadButton, (working || modelDownloaded) && styles.dimmed]}><Text style={styles.downloadText}>{modelDownloaded ? 'Model ready on this device' : working ? 'Preparing model…' : 'Download model once'}</Text></Pressable>
              </> : <>
                <TextInput value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} placeholder="Tool-calling model ID" placeholderTextColor="#89919a" style={styles.settingsInput} accessibilityLabel="AI model" />
                <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="none" placeholder={`${provider === 'gemini' ? 'Gemini' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API key`} placeholderTextColor="#89919a" style={styles.settingsInput} accessibilityLabel="AI provider API key" />
                <Text style={styles.settingsNote}>Your key is sent for each request only. It is not saved by Allegra.</Text>
                {apiKey ? <Pressable onPress={() => setApiKey('')}><Text style={styles.forgetLink}>Forget key</Text></Pressable> : null}
              </>}
            </View>
          ) : null}
        </View>

        {currentSong ? <View style={styles.currentCard}>
          <Artwork uri={currentSong.coverImageUri ?? currentSong.coverRemoteUri} title={currentSong.title} artist={currentSong.artist ?? ''} size={54} style={styles.artwork} />
          <View style={styles.trackCopy}><Text style={styles.overline}>{isLive ? 'RIGHT NOW' : 'CURRENT TRACK'}</Text><Text style={styles.trackTitle} numberOfLines={1}>{currentSong.title}</Text><Text style={styles.trackArtist} numberOfLines={1}>{currentSong.artist}</Text></View>
          <Pressable onPress={async () => { const result = await toggleLike(currentSong.id); if (result === 'liked' && streamSeed) StreamService.love(streamSeed.id); }} style={styles.iconButton} accessibilityLabel={currentSongLiked ? 'Unlike song' : 'Like song'}><Ionicons name={currentSongLiked ? 'heart' : 'heart-outline'} size={20} color={currentSongLiked ? Signal.accentBright : Signal.inkSoft} /></Pressable>
          <Pressable onPress={() => { actWhereMusicIs({ kind: isPlaying ? 'pause' : 'play' }, () => requestPlayback(!isPlaying)).catch(() => undefined); }} style={styles.iconButton} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}><Ionicons name={isPlaying ? 'pause' : 'play'} size={19} color={Signal.inkSoft} /></Pressable>
          <Pressable onPress={skipCurrent} style={styles.iconButton} accessibilityLabel="Skip song"><Ionicons name="play-skip-forward" size={20} color={Signal.inkSoft} /></Pressable>
        </View> : null}

        {goal === 'mix' && canStart ? <Pressable onPress={startSet} style={styles.startButton}><Ionicons name="play" size={18} color="#fff" /><Text style={styles.startText}>Start this set</Text></Pressable> : null}

        {goal === 'playlist' ? <View style={styles.draftCard}>
          <View style={styles.draftHeading}><View><Text style={styles.overline}>YOUR PLAYLIST</Text><Text style={styles.sectionTitle}>Shape the draft</Text></View><Text style={styles.draftCount}>{draft.length}/{songLimit}</Text></View>
          <TextInput value={draftName} onChangeText={setDraftName} maxLength={100} placeholder="Playlist name" placeholderTextColor="#89919a" style={styles.nameInput} accessibilityLabel="Playlist name" />
          {draft.length ? draft.map(({ song, reason }, index) => <View key={song.id} style={styles.draftTrack}>
            <Text style={styles.queueIndex}>{String(index + 1).padStart(2, '0')}</Text><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={42} style={styles.artwork} />
            <View style={styles.trackCopy}><Text style={styles.trackTitle} numberOfLines={1}>{song.title}</Text><Text style={styles.trackArtist} numberOfLines={1}>{song.artist}</Text><Text style={styles.reason} numberOfLines={2}>{reason}</Text></View>
            <Pressable onPress={() => setDraft(items => items.filter(item => item.song.id !== song.id))} style={styles.removeButton} accessibilityLabel={`Remove ${song.title}`}><Ionicons name="close" size={18} color={Signal.inkSoft} /></Pressable>
          </View>) : <Text style={styles.emptyNote}>Tell the DJ a mood, a few songs, or a starting point to build your first draft.</Text>}
          {draft.length ? <Pressable onPress={() => { savePlaylist(); }} disabled={saving} style={[styles.startButton, saving && styles.dimmed]}>{saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={19} color="#fff" />}<Text style={styles.startText}>{saving ? 'Saving…' : 'Save playlist'}</Text></Pressable> : null}
        </View> : draft.length > 0 ? <View style={styles.draftCard}>
          <View style={styles.draftHeading}><View><Text style={styles.overline}>READY WHEN YOU ARE</Text><Text style={styles.sectionTitle}>Coming up</Text></View><Text style={styles.draftCount}>{draft.length} songs</Text></View>
          {draft.map(({ song, reason }, index) => <View key={song.id} style={styles.draftTrack}><Text style={styles.queueIndex}>{String(index + 1).padStart(2, '0')}</Text><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={42} style={styles.artwork} /><View style={styles.trackCopy}><Text style={styles.trackTitle} numberOfLines={1}>{song.title}</Text><Text style={styles.trackArtist} numberOfLines={1}>{song.artist}</Text>{reason ? <Text style={styles.reason} numberOfLines={2}>{reason}</Text> : null}</View></View>)}
        </View> : null}

        {goal === 'mix' && nextUp.length > 0 ? <View style={styles.queueCard}><Text style={styles.sectionTitle}>Already in your queue</Text>{nextUp.map((song, index) => <View key={`${song.id}:${index}`} style={styles.draftTrack}><Text style={styles.queueIndex}>{String(index + 1).padStart(2, '0')}</Text><Artwork uri={song.coverImageUri} title={song.title} artist={song.artist ?? ''} size={42} style={styles.artwork} /><View style={styles.trackCopy}><Text style={styles.trackTitle} numberOfLines={1}>{song.title}</Text><Text style={styles.trackArtist} numberOfLines={1}>{song.artist}</Text></View></View>)}</View> : null}

        {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f6f2' },
  content: { paddingHorizontal: 18, gap: 13 },
  mascot: { height: 274, borderRadius: 29, overflow: 'hidden', backgroundColor: '#fffaf2', alignItems: 'center', justifyContent: 'center', position: 'relative', borderWidth: 1, borderColor: 'rgba(97,77,52,0.06)' },
  glow: { position: 'absolute', width: '112%', height: '100%', bottom: -12, borderRadius: 200, opacity: 0.55 },
  glowSoft: { position: 'absolute', width: '78%', height: '65%', bottom: -18, borderRadius: 180, opacity: 0.68 },
  glowCore: { position: 'absolute', width: '48%', height: '40%', bottom: 4, borderRadius: 180, opacity: 0.48 },
  eyes: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 72 },
  eye: { width: 38, height: 54, backgroundColor: '#fff', borderRadius: 28, shadowColor: '#ae773c', shadowOpacity: 0.1, shadowRadius: 10, elevation: 2 },
  eyeLeft: { transform: [{ rotate: '-9deg' }] }, eyeRight: { height: 45, transform: [{ rotate: '8deg' }, { translateY: 5 }] },
  composeCard: { backgroundColor: 'transparent', borderRadius: 0, padding: 0, borderWidth: 0, borderColor: 'transparent' },
  promptLine: { fontSize: 18, fontWeight: '600', letterSpacing: -0.2, color: '#252b31', marginBottom: 13 },
  goalTabs: { flexDirection: 'row', gap: 4, backgroundColor: '#f1f0ed', padding: 4, borderRadius: 15, marginBottom: 13 },
  goalTab: { flex: 1, minHeight: 44, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, goalTabActive: { backgroundColor: '#fff', shadowColor: '#5b4631', shadowOpacity: 0.08, shadowRadius: 7, elevation: 1 },
  goalTabText: { color: '#777f86', fontSize: 13, fontWeight: '600' }, goalTabTextActive: { color: '#262c31' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 10, marginBottom: 13 }, chip: { minHeight: 40, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 13, borderRadius: 20, backgroundColor: '#f4f3ef' }, chipText: { color: '#59616a', fontSize: 12, fontWeight: '500' },
  inputRow: { minHeight: 52, borderWidth: 1, borderColor: 'rgba(255,255,255,0.84)', backgroundColor: 'rgba(255,255,255,0.52)', borderRadius: 999, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingLeft: 17, paddingRight: 7, shadowColor: '#62594e', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 2 }, inputRowFocused: { borderColor: 'rgba(108,96,80,0.28)', shadowColor: '#62594e', shadowOpacity: 0.12, shadowRadius: 20, elevation: 3 },
  input: { flex: 1, minHeight: 48, color: '#302d29', fontSize: 14, paddingVertical: 7 }, sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' }, dimmed: { opacity: 0.48 },
  commandMenu: { maxHeight: 260, flexGrow: 0, marginTop: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.82)' }, commandMenuContent: { padding: 6, gap: 2 }, commandItem: { minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, commandCopy: { flex: 1, minWidth: 0, gap: 3 }, commandLabel: { color: '#30363c', fontSize: 13, fontWeight: '600' }, commandDetail: { color: '#858c92', fontSize: 11 }, commandName: { color: '#776f64', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  setupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, minHeight: 48 }, smallHint: { color: '#858c92', fontSize: 11, flex: 1 }, setupAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12 }, setupLink: { color: '#383f45', fontSize: 12, fontWeight: '600' },
  settingsPanel: { marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: '#f7f6f3', gap: 10 }, settingsTitle: { fontSize: 14, color: '#30363c', fontWeight: '700' }, providerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, providerChip: { borderWidth: 1, borderColor: '#e5e2dc', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7 }, providerChipActive: { backgroundColor: '#30363c', borderColor: '#30363c' }, providerText: { color: '#626a70', fontSize: 11, fontWeight: '600' }, providerTextActive: { color: '#fff' },
  settingsInput: { color: '#252b31', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e7e4df', paddingHorizontal: 12, minHeight: 43, fontSize: 13 }, settingsNote: { fontSize: 11, lineHeight: 16, color: '#7d858b' }, forgetLink: { color: '#8a5444', fontSize: 12, fontWeight: '600' }, downloadButton: { backgroundColor: '#30363c', borderRadius: 12, padding: 11, alignItems: 'center' }, downloadText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  limitRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, limitLabel: { color: '#777f86', fontSize: 12 }, limitControls: { flexDirection: 'row', alignItems: 'center', gap: 9 }, limitButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#f1f0ec', alignItems: 'center', justifyContent: 'center' }, limitNumber: { minWidth: 20, textAlign: 'center', color: '#30363c', fontSize: 13, fontWeight: '700' },
  currentCard: { backgroundColor: '#fffefa', borderRadius: 19, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: 'rgba(34,43,52,0.05)' }, artwork: { borderRadius: 10 }, trackCopy: { flex: 1, minWidth: 0 }, overline: { color: '#9a8e7a', fontSize: 9, letterSpacing: 1.05, fontWeight: '700', marginBottom: 3 }, trackTitle: { color: '#30363c', fontWeight: '600', fontSize: 13 }, trackArtist: { color: '#858c92', fontSize: 11, marginTop: 2 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  startButton: { minHeight: 48, borderRadius: 16, backgroundColor: '#30363c', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, startText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  draftCard: { backgroundColor: '#fff', borderRadius: 22, padding: 15, gap: 11, borderWidth: 1, borderColor: 'rgba(34,43,52,0.05)' }, draftHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: '#30363c', fontSize: 17, fontWeight: '700', marginTop: 2 }, draftCount: { color: '#92989c', fontSize: 11, fontWeight: '600' }, nameInput: { color: '#30363c', fontSize: 15, fontWeight: '600', borderBottomWidth: 1, borderColor: '#eeece7', paddingVertical: 7 },
  draftTrack: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 48 }, queueIndex: { color: '#a4a8aa', fontSize: 10, width: 18, fontVariant: ['tabular-nums'] }, reason: { color: '#95999b', fontSize: 10, marginTop: 3 }, removeButton: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' }, emptyNote: { color: '#8b9195', fontSize: 12, lineHeight: 18, paddingVertical: 4 },
  queueCard: { backgroundColor: '#fff', borderRadius: 21, padding: 15, gap: 11 }, status: { color: '#727b82', textAlign: 'center', fontSize: 11, paddingBottom: 4 },
});

export default DjScreen;
