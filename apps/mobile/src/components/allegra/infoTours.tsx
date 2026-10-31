/**
 * What each screen's small "i" walks through (InfoTour), and the scene that acts it out. Every screen
 * has its own object: Stream plays a cover, Luvs stacks its lanes, Library fans its sleeves, Search
 * splits phone and cloud, Playlists tiles its grid, Settings turns its dials, Import moves songs between
 * two places, Blends orbits its lights, a Blend opens its collage. Only what the screen really does:
 * a step that names a control must match that control.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';

import { BLEND_MAX_MEMBERS } from '@shared/blendLimits';

import { Glass, Motion, Signal } from '../../constants/allegraTheme';
import { Loop, Part, useTick, type TourScene, type TourStep } from './InfoTour';

const TILES = [
  [Signal.accent, Signal.accentDeep], [Signal.wave, '#5a6a1e'], [Signal.vibeBlue, '#2f4d66'], ['#c58bd8', '#4d2f66'], ['#f2b66d', '#7a4a1e'],
] as const;

/** A cover-like tile in one of the scene colours. */
const Tile: React.FC<{ i: number; size: number; radius?: number }> = ({ i, size, radius = size * 0.18 }) => {
  const [a, b] = TILES[i % TILES.length]!;
  return <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong }} />;
};
const Badge: React.FC<{ icon: React.ComponentProps<typeof Ionicons>['name']; size?: number; tone?: string }> = ({ icon, size = 54, tone = Signal.ink }) => (
  <View style={[s.badge, { width: size, height: size, borderRadius: size / 2 }]}><Ionicons name={icon} size={size * 0.44} color={tone} /></View>
);
const Row: React.FC<{ i: number; width?: number; tick?: boolean }> = ({ i, width = 170, tick }) => (
  <View style={[s.row, { width }]}>
    {tick !== undefined ? <View style={[s.tick, !tick && s.tickOff]}>{tick ? <Ionicons name="checkmark" size={11} color={Signal.waveInk} /> : null}</View> : null}
    <Tile i={i} size={18} radius={5} />
    <View style={s.rowLine} />
  </View>
);

// ─── Stream ────────────────────────────────────────────────────────────────

export const STREAM_TOUR: readonly TourStep[] = [
  { title: 'Listen to anything', body: 'Tap any song to stream it straight away. Nothing downloads unless you ask.' },
  { title: 'Save it for offline', body: 'The arrow beside a song saves it to your Library, lyrics included.' },
  { title: 'Play it next', body: 'Long-press a song and it plays right after this one.' },
  { title: 'Made from your taste', body: 'Mood chips and Quick picks up top come from what you play.' },
  { title: 'It keeps going', body: 'When your queue runs out, similar songs carry on.' },
];

export const streamScene: TourScene = (step) => {
  if (step === 0) return <>
    <Loop kind="ripple" amount={1.1} duration={1700} style={s.ripple} />
    <Part from={{ y: 40, scale: 0.8 }}><Tile i={1} size={96} /></Part>
    <Part delay={0.2}><View style={s.play}><Ionicons name="play" size={20} color={Signal.ink} /></View></Part>
  </>;
  if (step === 1) return <>
    <Part y={-18}><Tile i={2} size={74} /></Part>
    <Part y={20} delay={0.15}><Loop kind="float" amount={6} duration={1100}><View style={s.arrow}><Ionicons name="arrow-down" size={18} color={Signal.waveInk} /></View></Loop></Part>
    <Part y={64} delay={0.1} from={{ y: 20 }}><View style={s.tray} /></Part>
  </>;
  if (step === 2) return <>
    {[0, 1, 2].map((i) => <Part key={i} y={-30 + i * 30} delay={i * 0.08}><Row i={i + 2} /></Part>)}
    <Part y={56} delay={0.3} from={{ y: 40 }}><Loop kind="float" amount={8} duration={1400}><View style={[s.row, s.rowLit]}><Tile i={1} size={18} radius={5} /><View style={s.rowLine} /></View></Loop></Part>
  </>;
  if (step === 3) return <>{[{ x: -96, y: -36, t: 'Chill' }, { x: 4, y: -48, t: 'Focus' }, { x: 98, y: -30, t: 'Workout' }, { x: -70, y: 22, t: 'Rain' }, { x: 38, y: 16, t: 'Late night' }, { x: 104, y: 50, t: 'Party' }].map((m, i) => (
    <Part key={m.t} x={m.x} y={m.y} delay={i * 0.06} from={{ x: -m.x, y: -m.y, scale: 0.2 }}>
      <View style={[s.pill, m.t === 'Late night' && s.pillOn]}><Text style={[s.pillText, m.t === 'Late night' && s.pillTextOn]}>{m.t}</Text></View>
    </Part>
  ))}</>;
  return <>
    {[0, 1, 2, 3].map((i) => <Loop key={i} kind="travel" amount={130} duration={3200} delay={i * 800} style={s.abs}><Tile i={i} size={46} /></Loop>)}
    <Part y={58}><Badge icon="radio-outline" size={40} /></Part>
  </>;
};

// ─── Luvs ──────────────────────────────────────────────────────────────────

export const LUVS_TOUR: readonly TourStep[] = [
  { title: 'Lanes of taste', body: 'Swipe sideways between lanes: For you, one for each artist you love, and your mixes.' },
  { title: 'Go deeper', body: 'Swipe up for the next song in the same taste. The lane keeps growing as you go.' },
  { title: 'Hear the best part', body: 'Each card plays the song’s hook. Tap the card to pause.' },
  { title: 'Keep what you like', body: 'Under the card: luv it, save it, play the full song or share it.' },
];

export const luvsScene: TourScene = (step) => {
  if (step === 0) return <>{[-1, 0, 1].map((d) => (
    <Part key={d} x={d * 104} y={d === 0 ? -4 : 6} delay={Math.abs(d) * 0.1} from={{ x: d * 40 }}>
      <Loop kind="sway" amount={d === 0 ? 2 : 4} duration={3000} delay={Math.abs(d) * 300}><View style={{ opacity: d === 0 ? 1 : 0.55 }}><Tile i={d + 2} size={d === 0 ? 108 : 82} /></View></Loop>
    </Part>
  ))}</>;
  if (step === 1) return <>
    <Part y={-12} style={{ opacity: 0.5 }}><Tile i={4} size={86} /></Part>
    <Part y={0}><Tile i={3} size={96} /></Part>
    <Loop kind="rise" amount={46} duration={1800} style={s.abs}><Ionicons name="chevron-up" size={30} color={Signal.ink} /></Loop>
  </>;
  if (step === 2) return <>
    <Part from={{ scale: 0.8 }}><Tile i={0} size={110} /></Part>
    <Part delay={0.2}><Loop kind="pulse" amount={0.12} duration={1500}><View style={s.play}><Ionicons name="pause" size={22} color={Signal.ink} /></View></Loop></Part>
  </>;
  return <>{(['heart', 'bookmark-outline', 'musical-notes-outline', 'share-social-outline'] as const).map((icon, i) => (
    <Part key={icon} x={-96 + i * 64} delay={i * 0.09} from={{ y: 30 }}>
      {i === 0 ? <Loop kind="beat" amount={0.2} duration={1300}><Badge icon={icon} size={50} tone={Signal.accent} /></Loop> : <Badge icon={icon} size={50} />}
    </Part>
  ))}</>;
};

// ─── Library ───────────────────────────────────────────────────────────────

export const LIBRARY_TOUR: readonly TourStep[] = [
  { title: 'Songs on this phone', body: 'Everything you save plays offline here, lyrics included.' },
  { title: 'The deck', body: 'Drag along the cards and tap the middle one to play it.' },
  { title: 'Your artists', body: 'Tap an artist to see only their songs, and tap again to see everyone.' },
  { title: 'Find it fast', body: 'Filter, sort, and on long lists jump with the A to Z rail. Long-press a song for more.' },
  { title: 'The four icons', body: 'Beside the title: Blends, Import from Spotify, downloads in progress and your playlists.' },
];

type Pose = readonly [number, number, number, number, number]; // x, y, rotate, scale, opacity
const SLEEVE_POSES: readonly (readonly [Pose, Pose, Pose])[] = [
  [[-10, 8, -6, 0.94, 0.8], [0, 0, 0, 1, 1], [10, -8, 6, 0.94, 0.8]],
  [[-62, 10, -16, 0.9, 0.9], [0, -4, 0, 1, 1], [62, 10, 16, 0.9, 0.9]],
  [[-74, -24, -10, 0.66, 0.85], [0, 30, 0, 0.66, 0.85], [74, -24, 10, 0.66, 0.85]],
  [[-100, 0, 0, 0.8, 0.85], [0, 0, 0, 0.8, 1], [100, 0, 0, 0.8, 0.85]],
  [[-40, 10, -8, 0.6, 0.3], [0, 0, 0, 0.6, 0.3], [40, 10, 8, 0.6, 0.3]],
];

const Sleeve: React.FC<{ i: number; pose: Pose }> = ({ i, pose }) => {
  const reduce = useReducedMotion();
  const x = useSharedValue(0); const y = useSharedValue(40); const r = useSharedValue(0); const sc = useSharedValue(0.7); const o = useSharedValue(0);
  useEffect(() => {
    const go = (v: typeof x, to: number) => { v.value = reduce ? withTiming(to, { duration: 0 }) : withSpring(to, Motion.spring.hero); };
    go(x, pose[0]); go(y, pose[1]); go(r, pose[2]); go(sc, pose[3]);
    o.value = withTiming(pose[4], { duration: Motion.duration.base });
  }, [o, pose, r, reduce, sc, x, y]);
  const anim = useAnimatedStyle((): ViewStyle => ({ opacity: o.value, transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${r.value}deg` }, { scale: sc.value }] }));
  return <Animated.View style={[s.abs, anim, { zIndex: i === 1 ? 2 : 1 }]}><Tile i={i} size={100} /><View style={s.groove} /></Animated.View>;
};

export const librarySleeves: TourScene = (step) => <>{[0, 1, 2].map((i) => <Sleeve key={i} i={i} pose={SLEEVE_POSES[Math.min(step, SLEEVE_POSES.length - 1)]![i]!} />)}</>;

export const libraryScene: TourScene = (step) => {
  if (step === 0) return <Part y={2}><Badge icon="cloud-done-outline" size={50} tone={Signal.wave} /></Part>;
  if (step === 1) return <Part y={62} delay={0.3}><Loop kind="glide" amount={34} duration={2600}><Ionicons name="hand-left-outline" size={22} color={Signal.ink} /></Loop></Part>;
  if (step === 2) return <Part><Badge icon="person" size={46} /></Part>;
  if (step === 3) return <Part x={136} delay={0.1} from={{ x: 30 }}><View style={s.rail}>{['A', 'F', 'M', 'S', 'Z'].map((l) => <Text key={l} style={s.railText}>{l}</Text>)}</View></Part>;
  return <>{(['people-outline', 'cloud-download-outline', 'download-outline', 'albums-outline'] as const).map((icon, i) => (
    <Part key={icon} x={-84 + i * 56} delay={i * 0.08} from={{ y: -24, scale: 0.4 }}><Badge icon={icon} size={44} /></Part>
  ))}</>;
};

// ─── Search ────────────────────────────────────────────────────────────────

export const SEARCH_TOUR: readonly TourStep[] = [
  { title: 'One field for everything', body: 'Songs on this phone and the online catalog, in a single search.' },
  { title: 'Your phone answers first', body: 'Downloaded songs and playlists show as you type, and play offline.' },
  { title: 'Then the catalog', body: 'Stream anything online, or save it with the arrow.' },
  { title: 'Before you type', body: 'Your recent searches and moods are waiting under the field.' },
];

export const searchScene: TourScene = (step) => {
  if (step === 0) return <Part from={{ y: 20, scale: 0.9 }}>
    <View style={s.search}><Ionicons name="search" size={16} color={Signal.inkSoft} /><Text style={s.searchText}>late night drive</Text><Loop kind="blink" duration={900}><View style={s.caret} /></Loop></View>
  </Part>;
  if (step === 1) return <>
    <Part x={-104}><Badge icon="phone-portrait-outline" size={50} tone={Signal.wave} /></Part>
    {[0, 1, 2].map((i) => <Part key={i} x={36} y={-30 + i * 30} delay={0.1 + i * 0.08} from={{ x: -60 }}><Row i={i} width={150} /></Part>)}
  </>;
  if (step === 2) return <>
    <Part y={-50}><Badge icon="cloud-outline" size={50} /></Part>
    {[0, 1].map((i) => <Loop key={i} kind="rise" amount={-30} duration={1700} delay={i * 850} style={[s.abs, { top: 104 }]}><Row i={i + 3} width={150} /></Loop>)}
  </>;
  return <>{['Arijit', 'Lofi', 'Road trip', 'Rain'].map((t, i) => (
    <Part key={t} x={i % 2 ? 64 : -64} y={i < 2 ? -24 : 24} delay={i * 0.08} from={{ scale: 0.3 }}>
      <View style={s.pill}><Ionicons name="time-outline" size={12} color={Signal.inkMuted} /><Text style={s.pillText}>{t}</Text></View>
    </Part>
  ))}</>;
};

// ─── Playlists ─────────────────────────────────────────────────────────────

export const PLAYLISTS_TOUR: readonly TourStep[] = [
  { title: 'All your playlists', body: 'Every playlist you made, here or on the website, in one grid.' },
  { title: 'Liked Songs first', body: 'Every heart you tap collects in Liked Songs, always at the top.' },
  { title: 'Make a new one', body: 'The plus button at the top starts a new playlist.' },
  { title: 'Hold for more', body: 'Long-press a playlist for its options, like rename and delete.' },
];

export const playlistsScene: TourScene = (step) => {
  if (step === 0) return <>{[0, 1, 2, 3].map((i) => <Part key={i} x={i % 2 ? 40 : -40} y={i < 2 ? -38 : 38} delay={i * 0.08} from={{ scale: 0.4, x: 0, y: 0 }}><Tile i={i} size={70} /></Part>)}</>;
  if (step === 1) return <Part from={{ scale: 0.5 }}>
    <LinearGradient colors={[Signal.accentDeep, Signal.accent, Signal.vibeBlue]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={s.liked}>
      <Loop kind="beat" amount={0.18} duration={1300}><Ionicons name="heart" size={40} color={Signal.ink} /></Loop>
    </LinearGradient>
  </Part>;
  if (step === 2) return <>
    <Loop kind="ripple" amount={1.4} duration={1800} style={[s.ripple, s.rippleRound]} />
    <Part from={{ scale: 0.3, rotate: -90 }}><Badge icon="add" size={60} tone={Signal.wave} /></Part>
  </>;
  return <>
    <Part><Tile i={3} size={90} /></Part>
    <Part x={64} y={-40} delay={0.3}><Loop kind="pulse" amount={0.2} duration={1200}><View style={s.touch} /></Loop></Part>
    {(['create-outline', 'trash-outline'] as const).map((icon, i) => <Part key={icon} x={-90} y={-30 + i * 56} delay={0.55 + i * 0.1} from={{ x: 30 }}><Badge icon={icon} size={40} /></Part>)}
  </>;
};

// ─── Settings ──────────────────────────────────────────────────────────────

export const SETTINGS_TOUR: readonly TourStep[] = [
  { title: 'Jump around', body: 'The chips at the top take you straight to a section.' },
  { title: 'Your player', body: 'Pick the backdrop, the mini player and the moving light behind the app.' },
  { title: 'Playback and lyrics', body: 'Decide what plays next, and how lyrics look and keep time.' },
  { title: 'LuvLink', body: 'Share a room with friends and hear the same song at the same moment.' },
  { title: 'Your library and data', body: 'Downloads, sync and what is kept on this phone.' },
];

const KNOBS = [[-40, 30, 0], [50, -24, 22], [10, 40, -36]] as const;
const Knob: React.FC<{ to: number }> = ({ to }) => {
  const reduce = useReducedMotion();
  const x = useSharedValue(to);
  useEffect(() => { x.value = reduce ? to : withSpring(to, Motion.spring.hero); }, [reduce, to, x]);
  const anim = useAnimatedStyle((): ViewStyle => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View style={[s.knob, anim]} />;
};

export const settingsDials: TourScene = (step) => step > 2 ? null : <>
  {[0, 1, 2].map((i) => <View key={i} style={[s.abs, s.slider, { transform: [{ translateX: -24 }, { translateY: -36 + i * 36 }] }]}><Knob to={KNOBS[step]![i]!} /></View>)}
  <View style={[s.abs, s.switch, { transform: [{ translateX: 112 }] }]}><Knob to={step === 1 ? 10 : -10} /></View>
</>;

export const settingsScene: TourScene = (step) => {
  if (step === 0) return <Part y={-66} from={{ x: 40, y: 0 }}><View style={s.chips}>{['Player', 'Lyrics', 'Data'].map((t, i) => <View key={t} style={[s.pill, i === 0 && s.pillOn]}><Text style={[s.pillText, i === 0 && s.pillTextOn]}>{t}</Text></View>)}</View></Part>;
  if (step <= 2) return null;
  if (step === 3) return <>
    <Part x={-96} from={{ x: -30 }}><Ionicons name="phone-portrait-outline" size={46} color={Signal.ink} /></Part>
    <Part x={96} from={{ x: 30 }}><Ionicons name="phone-portrait-outline" size={46} color={Signal.ink} /></Part>
    {[0, 1, 2].map((i) => <Loop key={i} kind="travel" amount={64} duration={1600} delay={i * 530} style={s.abs}><Ionicons name="musical-note" size={18} color={Signal.wave} /></Loop>)}
  </>;
  return <>
    <Loop kind="ripple" amount={1.3} duration={2200} style={[s.ripple, s.rippleRound]} />
    <Part from={{ scale: 0.4 }}><Badge icon="server-outline" size={58} tone={Signal.wave} /></Part>
  </>;
};

// ─── Import ────────────────────────────────────────────────────────────────

export const IMPORT_TOUR: readonly TourStep[] = [
  { title: 'Connect Spotify', body: 'Bring your Liked Songs and playlists straight from your Spotify account. Tick as many as you like.' },
  { title: 'Or use a file', body: 'Spotify’s data export (ZIP or JSON) or any CSV works too.' },
  { title: 'Your file stays here', body: 'It never leaves this phone. Only titles, artists, albums and lengths are sent to find the songs.' },
  { title: 'Daily top-ups', body: 'Switch on the daily check and new songs in those playlists keep arriving.' },
];

export const importScene: TourScene = (step) => {
  if (step === 0) return <>
    <Part x={-112} from={{ x: -30 }}><Badge icon="musical-notes" size={50} /></Part>
    <Part x={112} from={{ x: 30 }}><View style={s.home}><Text style={s.homeText}>A</Text></View></Part>
    <View style={[s.abs, s.line]} />
    {[0, 1, 2, 3].map((i) => <Loop key={i} kind="travel" amount={88} duration={1700} delay={i * 425} style={s.abs}><View style={[s.dot, { backgroundColor: TILES[i % 3]![0] }]} /></Loop>)}
  </>;
  if (step === 1) return <>
    <Part y={52} from={{ y: 20 }}><View style={s.tray} /></Part>
    <Part y={4} delay={0.15} from={{ x: -110, y: -80, rotate: -35, scale: 0.9 }}><View style={s.file}><Ionicons name="document-text-outline" size={24} color={Signal.ink} /><Text style={s.fileText}>CSV</Text></View></Part>
  </>;
  if (step === 2) return <>
    <Part x={-118}><View style={[s.file, { opacity: 0.6 }]}><Ionicons name="document-text-outline" size={20} color={Signal.ink} /></View></Part>
    <Part from={{ scale: 0.4 }}><Badge icon="shield-checkmark-outline" size={54} tone={Signal.wave} /></Part>
    {['Title', 'Artist'].map((t, i) => <Loop key={t} kind="travel" amount={100} duration={2200} delay={i * 700} style={[s.abs, { top: 56 + i * 40 }]}><View style={s.chip}><Text style={s.chipText}>{t}</Text></View></Loop>)}
  </>;
  return <>
    <Part y={-44} from={{ scale: 0.5 }}><Loop kind="spin" duration={3000}><Ionicons name="sync" size={30} color={Signal.wave} /></Loop></Part>
    {[0, 1].map((i) => <Part key={i} y={14 + i * 30} delay={0.3 + i * 0.25} from={{ x: 50, y: 0 }}><Row i={i} tick /></Part>)}
  </>;
};

// ─── Blends ────────────────────────────────────────────────────────────────

export const BLENDS_TOUR: readonly TourStep[] = [
  { title: 'One playlist, two tastes', body: 'A Blend mixes what you love with what a friend loves into one shared playlist.' },
  { title: 'Fresh every day', body: 'It rebuilds each day from what you both play and like, so it keeps up with you.' },
  { title: 'Bring your friends', body: `Share the invite link. Up to ${BLEND_MAX_MEMBERS} people can be in one Blend.` },
  { title: 'Your Spotify counts', body: 'Import your Liked Songs and playlists, and your Blends learn from them too.' },
];

const TURN = Math.PI * 2;
type Orbit = readonly [number, number, number, number]; // radius, angle, lift, size
const ORBITS: readonly (readonly (Orbit | null)[])[] = [
  [[40, 0, 0, 1], [40, TURN / 2, 0, 1], null],
  [[28, 0, 0, 1.05], [28, TURN / 2, 0, 1.05], null],
  [[44, 0, 4, 0.86], [44, TURN / 3, 4, 0.86], [44, (TURN * 2) / 3, 4, 0.86]],
  [[28, 0, -26, 0.9], [28, TURN / 2, -26, 0.9], null],
];
const LIGHTS = [Signal.wave, Signal.accent, Signal.vibeBlue] as const;

/** One light on a tilted orbit: the near side larger and lower. They add together where they cross. */
const OrbitLight: React.FC<{ tone: string; at: Orbit | null; start: number }> = ({ tone, at, start }) => {
  const reduce = useReducedMotion();
  const r = useSharedValue(110); const phase = useSharedValue(start); const lift = useSharedValue(0); const size = useSharedValue(0.7); const o = useSharedValue(0);
  const spin = useSharedValue(0);
  useEffect(() => {
    const target = at ?? [110, start, 0, 0.7] as const;
    const go = (v: typeof r, to: number) => { v.value = reduce ? withTiming(to, { duration: 0 }) : withSpring(to, Motion.spring.hero); };
    go(r, target[0]); go(phase, target[1]); go(lift, target[2]); go(size, target[3]);
    o.value = withTiming(at ? 0.85 : 0, { duration: Motion.duration.slow });
  }, [at, lift, o, phase, r, reduce, size, start]);
  useEffect(() => {
    if (reduce) return undefined;
    spin.value = withRepeat(withTiming(TURN, { duration: 9000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(spin);
  }, [reduce, spin]);
  const anim = useAnimatedStyle((): ViewStyle => {
    const a = spin.value + phase.value;
    const depth = Math.sin(a) * Math.min(1, r.value / 40);
    return { opacity: o.value, transform: [{ translateX: r.value * Math.cos(a) }, { translateY: lift.value + r.value * Math.sin(a) * 0.3 }, { scale: size.value * (1 + 0.16 * depth) }] };
  });
  return <Animated.View style={[s.abs, s.light, { backgroundColor: tone }, anim]} />;
};

export const blendsLights: TourScene = (step) => <>{LIGHTS.map((tone, i) => <OrbitLight key={tone} tone={tone} at={ORBITS[Math.min(step, 3)]![i] ?? null} start={(i * TURN) / 3} />)}</>;

export const blendsScene: TourScene = (step) => {
  if (step === 1) return <><Part from={{ scale: 0.8, y: 0 }}><Loop kind="spin" duration={6000}><View style={s.dayRing}><View style={s.daySun} /></View></Loop></Part></>;
  if (step === 3) return <>
    <Part y={58} from={{ y: 40 }}><View style={s.playlistCard}><LinearGradient colors={[Signal.accentDeep, Signal.accent, Signal.vibeBlue]} style={s.playlistArt}><Ionicons name="heart" size={12} color={Signal.ink} /></LinearGradient><View style={{ flex: 1, gap: 5 }}><View style={s.rowLine} /><View style={[s.rowLine, { width: '60%', opacity: 0.5 }]} /></View></View></Part>
    {[-30, 10, -8, 26, -20].map((x, i) => <Part key={i} x={x} y={8} from={{ scale: 1, y: 0 }}><Loop kind="rise" amount={34} duration={1500} delay={300 + i * 260}><View style={[s.dot, { backgroundColor: LIGHTS[i % 2] }]} /></Loop></Part>)}
  </>;
  return null;
};

// ─── One Blend ─────────────────────────────────────────────────────────────

export const BLEND_TOUR: readonly TourStep[] = [
  { title: 'Watch your story', body: 'Tap the cover or the story card: your match, the songs that join you and who brought what, played like a video.' },
  { title: 'Your taste match', body: 'How much your listening overlaps, worked out from what each of you likes and plays.' },
  { title: 'Whose pick is it', body: 'The coloured discs show whose taste a song came from. Use the chips to hear one person’s picks.' },
  { title: 'Fresh every day', body: 'The Blend rebuilds daily, so it moves with what you both play.' },
];

function LensRows() {
  const tick = useTick(1500);
  const lens = tick % 3;
  return <>
    {[0, 2, 1, 0].map((tone, i) => {
      const on = lens === 0 || (lens === 1 && tone === 0) || (lens === 2 && tone === 2);
      return <Part key={i} x={on ? 10 : 22} y={-45 + i * 30} delay={i * 0.06}><View style={{ opacity: on ? 1 : 0.2 }}><Row i={tone} width={160} /></View></Part>;
    })}
    {[0, 2].map((tone, i) => <Part key={tone} x={-118} y={-16 + i * 36}><View style={[s.lens, { backgroundColor: TILES[tone]![0], transform: [{ scale: lens === i + 1 ? 1.3 : 1 }] }]} /></Part>)}
  </>;
}

export const blendScene: TourScene = (step) => {
  if (step === 0) return <>
    <Part from={{ y: 30, scale: 0.8 }}><View style={s.collage}>{[0, 1, 2, 3].map((i) => <Tile key={i} i={i} size={48} radius={0} />)}</View></Part>
    <Part x={36} y={36} delay={0.3}><Loop kind="pulse" amount={0.18} duration={1400}><View style={s.storyPlay}><Ionicons name="play" size={14} color={Signal.waveInk} /></View></Loop></Part>
  </>;
  if (step === 1) return <>{Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * TURN - Math.PI / 2;
    return <Part key={i} x={Math.cos(a) * 62} y={Math.sin(a) * 62} delay={0.1 + i * 0.05} from={{ x: 0, y: 0, scale: 0.2 }}><View style={[s.ringDot, i > 15 && { opacity: 0.2 }]} /></Part>;
  })}
    <Part x={-11}><View style={[s.disc, { backgroundColor: Signal.accent }]} /></Part>
    <Part x={11}><View style={[s.disc, { backgroundColor: Signal.vibeBlue, opacity: 0.85 }]} /></Part>
  </>;
  if (step === 2) return <LensRows />;
  return <>
    <Part y={-26} from={{ scale: 0.5 }}><Loop kind="spin" duration={2600}><Ionicons name="refresh" size={34} color={Signal.wave} /></Loop></Part>
    {[0, 1, 2].map((i) => <Part key={i} x={-90 + i * 90} y={48} delay={0.15 + i * 0.12} from={{ y: 30 }}><Tile i={i + 2} size={44} /></Part>)}
  </>;
};

const s = StyleSheet.create({
  abs: { position: 'absolute' },
  badge: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12, 13, 16, 0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  ripple: { position: 'absolute', width: 96, height: 96, borderRadius: 18, borderWidth: 2, borderColor: Signal.wave },
  rippleRound: { width: 66, height: 66, borderRadius: 33, borderColor: Glass.hairlineStrong },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12, 13, 16, 0.6)' },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  tray: { width: 130, height: 16, borderWidth: 1.5, borderTopWidth: 0, borderColor: Glass.hairlineStrong, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 26, paddingHorizontal: 8, borderRadius: 9, backgroundColor: Glass.fillLight },
  rowLit: { width: 170, borderWidth: 1, borderColor: Signal.wave },
  rowLine: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.32)' },
  tick: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  tickOff: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Glass.hairlineStrong },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  pillOn: { backgroundColor: Signal.wave, borderColor: Signal.wave },
  pillText: { color: Signal.inkSoft, fontSize: 12, fontWeight: '600' },
  pillTextOn: { color: Signal.waveInk },
  groove: { position: 'absolute', top: 18, left: 18, right: 18, bottom: 18, borderRadius: 40, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.14)' },
  rail: { gap: 4, paddingVertical: 8, paddingHorizontal: 5, borderRadius: 10, backgroundColor: Glass.fillLight },
  railText: { color: Signal.inkSoft, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 240, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  searchText: { color: Signal.ink, fontSize: 15 },
  caret: { width: 2, height: 18, backgroundColor: Signal.wave },
  liked: { width: 104, height: 104, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  touch: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255, 255, 255, 0.35)' },
  chips: { flexDirection: 'row', gap: 6 },
  slider: { width: 150, height: 4, borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.2)' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: Signal.ink },
  switch: { width: 46, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  home: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  homeText: { color: Signal.waveInk, fontSize: 18, fontWeight: '800' },
  line: { width: 190, height: 2, backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  file: { width: 58, height: 72, borderRadius: 10, borderTopRightRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: Glass.hairlineStrong },
  fileText: { color: Signal.ink, fontSize: 11, fontWeight: '800' },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(255, 255, 255, 0.14)' },
  chipText: { color: Signal.ink, fontSize: 11, fontWeight: '700' },
  light: { width: 86, height: 86, borderRadius: 43, mixBlendMode: 'screen' },
  dayRing: { width: 160, height: 160, borderRadius: 80, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255, 255, 255, 0.45)' },
  daySun: { position: 'absolute', top: -6, left: 74, width: 10, height: 10, borderRadius: 5, backgroundColor: Signal.ink },
  playlistCard: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 150, padding: 8, borderRadius: 14, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  playlistArt: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  collage: { width: 96, height: 96, flexDirection: 'row', flexWrap: 'wrap', borderRadius: 16, overflow: 'hidden' },
  storyPlay: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  ringDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Signal.wave },
  disc: { width: 36, height: 36, borderRadius: 18 },
  lens: { width: 20, height: 20, borderRadius: 10 },
});
