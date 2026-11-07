/**
 * Listening stats' cards (1.45.0, owner: "premium, everything, better than Spotify's"). Built from src/ui and the
 * StatsTheme tokens. Every chart also says what it shows in words for TalkBack.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from 'react-native-reanimated';
import Artwork from '../allegra/Artwork';
import { Radius, Signal, Space, StatsTheme } from '../../constants/allegraTheme';
import { GUTTER, Tactile, Text } from '../../ui';
import {
  TEMPO_BANDS, WEEKDAYS, durationWords, hourWords, minutesOf, PERSONA_WORDS,
  type ListeningStats, type TempoSummary, type TopArtist, type TopSong,
} from '../../services/stats/listeningStats';
import { playlistWash, PLAYLIST_WASH_STOPS } from '../playlist/playlistPage';

/** "12,340": grouped by hand, so it reads the same on every Android version. */
export const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A number that counts up once when it changes (held still under Reduce Motion). */
export const CountUp: React.FC<{ value: number; style?: React.ComponentProps<typeof Text>['style']; variant?: React.ComponentProps<typeof Text>['variant'] }> = ({ value, style, variant = 'hero' }) => {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) { setShown(value); from.current = value; return; }
    const start = Date.now(), begin = from.current, span = 700;
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / span);
      const eased = 1 - (1 - t) ** 3;
      setShown(begin + (value - begin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);
  return <Text variant={variant} tabular style={style}>{grouped(shown)}</Text>;
};

export const Card: React.FC<{ title?: string; caption?: string; children: React.ReactNode; style?: object }> = ({ title, caption, children, style }) => (
  <View style={[styles.card, style]}>
    {title ? <Text variant="title" accessibilityRole="header">{title}</Text> : null}
    {caption ? <Text variant="secondary" tone="secondary" style={styles.caption}>{caption}</Text> : null}
    {children}
  </View>
);

// ── hero ─────────────────────────────────────────────────────────────────────

export const Hero: React.FC<{ stats: ListeningStats; tint: string; change: string | null }> = ({ stats, tint, change }) => {
  const up = (stats.change ?? 0) >= 0;
  return (
    <View style={styles.hero}>
      <LinearGradient colors={playlistWash(tint)} locations={PLAYLIST_WASH_STOPS} style={StyleSheet.absoluteFill} />
      <Text variant="label" tone="secondary">Minutes listened</Text>
      <CountUp value={minutesOf(stats.seconds)} />
      {change ? (
        <View style={styles.changePill} accessibilityLabel={change}>
          <Ionicons name={up ? 'trending-up' : 'trending-down'} size={14} color={up ? StatsTheme.up : StatsTheme.down} />
          <Text variant="caption" style={{ color: up ? StatsTheme.up : StatsTheme.down }}>{change}</Text>
        </View>
      ) : null}
      <View style={styles.heroRow}>
        <HeroFigure label="Plays" value={grouped(stats.plays)} />
        <HeroFigure label="Songs" value={grouped(stats.songs)} />
        <HeroFigure label="Artists" value={grouped(stats.artists)} />
        <HeroFigure label="A day" value={`${minutesOf(stats.dailyAverageSeconds)} min`} />
      </View>
    </View>
  );
};

const HeroFigure: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.heroFigure} accessible accessibilityLabel={`${label}: ${value}`}>
    <Text variant="lead" tabular numberOfLines={1}>{value}</Text>
    <Text variant="caption" tone="secondary">{label}</Text>
  </View>
);

// ── top artists ──────────────────────────────────────────────────────────────

export const TopArtists: React.FC<{ artists: readonly TopArtist[]; onOpen: (name: string) => void }> = ({ artists, onOpen }) => {
  const [first, ...rest] = artists;
  if (!first) return null;
  return (
    <Card title="Top artists">
      <Tactile onPress={() => onOpen(first.name)} accessibilityRole="button" style={styles.topArtist}
        accessibilityLabel={`Number 1, ${first.name}, ${durationWords(first.seconds)}, ${first.plays} plays`}>
        <View style={styles.bigAvatar}><Artwork uri={first.artwork} title={first.name} size={112} style={StyleSheet.absoluteFill} /></View>
        <View style={styles.topArtistText}>
          <Text variant="caption" style={styles.rankLabel}>Your number 1</Text>
          <Text variant="detail" numberOfLines={2}>{first.name}</Text>
          <Text variant="secondary" tone="secondary">{durationWords(first.seconds)} · {grouped(first.plays)} plays · {first.songs} {first.songs === 1 ? 'song' : 'songs'}</Text>
        </View>
      </Tactile>
      <View style={styles.artistRow}>
        {rest.map((artist, i) => (
          <Tactile key={artist.name} onPress={() => onOpen(artist.name)} accessibilityRole="button" style={styles.smallArtist}
            accessibilityLabel={`Number ${i + 2}, ${artist.name}, ${durationWords(artist.seconds)}`}>
            <View style={styles.smallAvatar}><Artwork uri={artist.artwork} title={artist.name} size={64} style={StyleSheet.absoluteFill} /></View>
            <Text variant="caption" style={styles.rankLabel}>{i + 2}</Text>
            <Text variant="caption" numberOfLines={1} align="center">{artist.name}</Text>
          </Tactile>
        ))}
      </View>
    </Card>
  );
};

// ── top songs ────────────────────────────────────────────────────────────────

export const TopSongs: React.FC<{ songs: readonly TopSong[]; onPlay: (song: TopSong) => void }> = ({ songs, onPlay }) => (
  <Card title="Top songs">
    {songs.map((song, i) => (
      <Tactile key={song.key} onPress={() => onPlay(song)} accessibilityRole="button" style={styles.songRow}
        accessibilityLabel={`Number ${i + 1}, ${song.title} by ${song.artist}, ${song.plays} plays, ${durationWords(song.seconds)}`}
        accessibilityHint="Plays the song">
        <Text variant="lead" tabular style={styles.rank}>{i + 1}</Text>
        <View style={styles.songArt}><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={48} style={StyleSheet.absoluteFill} /></View>
        <View style={styles.songText}>
          <Text variant="row" numberOfLines={1} style={styles.songTitle}>{song.title}</Text>
          <Text variant="secondary" tone="secondary" numberOfLines={1}>{song.artist}</Text>
        </View>
        <View style={styles.songNumbers}>
          <Text variant="label" tabular>{grouped(song.plays)}</Text>
          <Text variant="caption" tone="secondary">plays</Text>
        </View>
      </Tactile>
    ))}
  </Card>
);

// ── on repeat ────────────────────────────────────────────────────────────────

export const OnRepeat: React.FC<{ song: TopSong; tint: string; onPlay: () => void }> = ({ song, tint, onPlay }) => {
  const first = new Date(song.firstAt);
  const since = `${first.getDate()} ${first.toLocaleString('en', { month: 'short' })}`;
  return (
    <View style={styles.repeat}>
      <LinearGradient colors={playlistWash(tint)} locations={PLAYLIST_WASH_STOPS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text variant="label" tone="secondary">On repeat</Text>
      <View style={styles.repeatBody}>
        <View style={styles.repeatArt}><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={120} style={StyleSheet.absoluteFill} /></View>
        <View style={styles.repeatText}>
          <Text variant="detail" numberOfLines={2}>{song.title}</Text>
          <Text variant="secondary" tone="secondary" numberOfLines={1}>{song.artist}</Text>
        </View>
      </View>
      <Text variant="page" tabular style={styles.repeatTime} accessibilityLabel={`You listened for ${durationWords(song.seconds)}`}>{durationWords(song.seconds)}</Text>
      <Text variant="secondary" tone="secondary">{grouped(song.plays)} plays · first heard {since}</Text>
      <Tactile onPress={onPlay} accessibilityRole="button" accessibilityLabel={`Play ${song.title}`} style={styles.repeatPlay}>
        <Ionicons name="play" size={22} color={Signal.waveInk} style={styles.playGlyph} />
      </Tactile>
    </View>
  );
};

// ── when you listen ──────────────────────────────────────────────────────────

/** 24 bars round a clock face: midnight at the top, noon at the bottom. */
export const ListeningClock: React.FC<{ stats: ListeningStats }> = ({ stats }) => {
  const size = 220, c = size / 2, inner = 42, outer = 100;
  const max = Math.max(...stats.clock, 1);
  const persona = stats.persona ? PERSONA_WORDS[stats.persona] : null;
  return (
    <Card title="When you listen" caption={persona?.body}>
      <View style={styles.clockWrap} accessible
        accessibilityLabel={stats.peakHour !== null ? `You listen most around ${hourWords(stats.peakHour)}. ${persona?.title ?? ''}` : 'Not enough listening yet'}>
        <Svg width={size} height={size}>
          <Circle cx={c} cy={c} r={inner - 6} stroke={StatsTheme.track} strokeWidth={1} fill="none" />
          {stats.clock.map((seconds, hour) => {
            const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
            const length = 6 + (outer - inner - 6) * (seconds / max);
            const x1 = c + Math.cos(angle) * inner, y1 = c + Math.sin(angle) * inner;
            const x2 = c + Math.cos(angle) * (inner + length), y2 = c + Math.sin(angle) * (inner + length);
            return <Line key={hour} x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" strokeWidth={6}
              stroke={hour === stats.peakHour ? Signal.wave : seconds > 0 ? StatsTheme.bar : StatsTheme.track} />;
          })}
        </Svg>
        <View style={styles.clockCentre} pointerEvents="none">
          {stats.peakHour !== null ? <Text variant="lead">{hourWords(stats.peakHour)}</Text> : null}
          <Text variant="caption" tone="secondary">peak</Text>
        </View>
      </View>
      <View style={styles.clockLabels}>
        <Text variant="caption" tone="secondary">12 am top · 6 am right · 12 pm bottom · 6 pm left</Text>
      </View>
      {persona ? <Text variant="label" align="center" style={styles.persona}>{persona.title}</Text> : null}
    </Card>
  );
};

export const WeekBars: React.FC<{ stats: ListeningStats }> = ({ stats }) => {
  const max = Math.max(...stats.weekdays, 1);
  const top = stats.topWeekday;
  return (
    <Card title="Your week" caption={top !== null ? `${WEEKDAYS[top]}s are your biggest day.` : undefined}>
      <View style={styles.bars} accessible accessibilityLabel={stats.weekdays.map((s, i) => `${WEEKDAYS[i]} ${durationWords(s)}`).join(', ')}>
        {stats.weekdays.map((seconds, i) => (
          <View key={i} style={styles.barColumn}>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { height: `${Math.max(3, (seconds / max) * 100)}%`, backgroundColor: i === top ? Signal.wave : StatsTheme.barQuiet }]} />
            </View>
            <Text variant="caption" tone={i === top ? 'primary' : 'secondary'}>{WEEKDAYS[i].slice(0, 1)}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

export const DailyBars: React.FC<{ stats: ListeningStats }> = ({ stats }) => {
  const max = Math.max(...stats.daily.map(d => d.seconds), 1);
  const biggest = stats.biggestDay;
  const label = biggest ? new Date(biggest.day).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : null;
  return (
    <Card title="Day by day" caption={biggest && label ? `Your biggest day was ${label}: ${durationWords(biggest.seconds)}.` : undefined}>
      <View style={styles.daily} accessible accessibilityLabel={`Minutes each day for the last ${stats.daily.length} days`}>
        {stats.daily.map(d => (
          <View key={d.day} style={styles.dailyTrack}>
            <View style={[styles.dailyFill, { height: `${Math.max(2, (d.seconds / max) * 100)}%`, backgroundColor: biggest?.day === d.day ? Signal.wave : StatsTheme.barQuiet }]} />
          </View>
        ))}
      </View>
    </Card>
  );
};

// ── tempo ────────────────────────────────────────────────────────────────────

export const TempoCard: React.FC<{ tempo: TempoSummary | null; busy: boolean }> = ({ tempo, busy }) => (
  <Card title="Your tempo" caption={tempo ? `Across ${tempo.known} of your most-heard songs.` : busy ? 'Finding the tempo of your most-heard songs…' : 'Listen to a few more songs to see your tempo.'}>
    {tempo ? (
      <>
        <View style={styles.bpmRow} accessible accessibilityLabel={`Average ${tempo.averageBpm} beats per minute, ${TEMPO_BANDS.find(b => b.id === tempo.band)?.label}`}>
          <Text variant="hero" tabular>{tempo.averageBpm}</Text>
          <View>
            <Text variant="label">BPM</Text>
            <Text variant="secondary" style={{ color: StatsTheme.tempo[tempo.band] }}>{TEMPO_BANDS.find(b => b.id === tempo.band)?.label}</Text>
          </View>
        </View>
        <View style={styles.bandBar}>
          {TEMPO_BANDS.map(b => tempo.shares[b.id] > 0 ? <View key={b.id} style={{ flex: tempo.shares[b.id], backgroundColor: StatsTheme.tempo[b.id] }} /> : null)}
        </View>
        <View style={styles.bandLegend}>
          {TEMPO_BANDS.map(b => (
            <View key={b.id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: StatsTheme.tempo[b.id] }]} />
              <Text variant="caption" tone="secondary">{b.label} {Math.round(tempo.shares[b.id] * 100)}%</Text>
            </View>
          ))}
        </View>
        {tempo.fastest ? <TempoLine icon="flash-outline" label="Fastest" song={tempo.fastest} /> : null}
        {tempo.slowest ? <TempoLine icon="moon-outline" label="Slowest" song={tempo.slowest} /> : null}
      </>
    ) : null}
  </Card>
);

const TempoLine: React.FC<{ icon: React.ComponentProps<typeof Ionicons>['name']; label: string; song: { title: string; artist: string; bpm: number } }> = ({ icon, label, song }) => (
  <View style={styles.tempoLine} accessible accessibilityLabel={`${label}: ${song.title} by ${song.artist}, ${song.bpm} BPM`}>
    <Ionicons name={icon} size={18} color={Signal.inkSoft} />
    <View style={styles.songText}>
      <Text variant="caption" tone="secondary">{label}</Text>
      <Text variant="row" numberOfLines={1}>{song.title}</Text>
    </View>
    <Text variant="label" tabular>{song.bpm} BPM</Text>
  </View>
);

// ── habits ───────────────────────────────────────────────────────────────────

export const Habits: React.FC<{ stats: ListeningStats }> = ({ stats }) => (
  <View style={styles.tiles}>
    <Tile icon="flame-outline" value={`${stats.currentStreak}`} unit={stats.currentStreak === 1 ? 'day' : 'days'} label="Current streak" />
    <Tile icon="trophy-outline" value={`${stats.longestStreak}`} unit={stats.longestStreak === 1 ? 'day' : 'days'} label="Longest streak" />
    <Tile icon="checkmark-done-outline" value={`${Math.round(stats.finishedShare * 100)}%`} label="Heard to the end" />
    <Tile icon="play-skip-forward-outline" value={`${Math.round(stats.skipShare * 100)}%`} label="Skipped early" />
    <Tile icon="musical-note-outline" value={grouped(stats.newSongs)} label="New songs" />
    <Tile icon="person-add-outline" value={grouped(stats.newArtists)} label="New artists" />
  </View>
);

const Tile: React.FC<{ icon: React.ComponentProps<typeof Ionicons>['name']; value: string; unit?: string; label: string }> = ({ icon, value, unit, label }) => (
  <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}>
    <View style={styles.tileInner}>
      <Ionicons name={icon} size={20} color={Signal.inkSoft} />
      <View style={styles.tileValue}>
        <Text variant="detail" tabular>{value}</Text>
        {unit ? <Text variant="secondary" tone="secondary"> {unit}</Text> : null}
      </View>
      <Text variant="caption" tone="secondary">{label}</Text>
    </View>
  </View>
);

/** A soft ring for the empty page. */
export const EmptyRing: React.FC = () => (
  <Svg width={120} height={120}>
    <Circle cx={60} cy={60} r={52} stroke={StatsTheme.track} strokeWidth={10} fill="none" />
    <Path d="M60 8 A52 52 0 0 1 112 60" stroke={Signal.wave} strokeWidth={10} strokeLinecap="round" fill="none" />
  </Svg>
);

const styles = StyleSheet.create({
  card: { marginHorizontal: GUTTER, marginTop: Space.md, padding: Space.md, borderRadius: Radius.sheet, backgroundColor: StatsTheme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: StatsTheme.cardRim, gap: Space.sm, overflow: 'hidden' },
  caption: { marginTop: -Space.xs },
  hero: { marginHorizontal: GUTTER, marginTop: Space.sm, padding: Space.lg, borderRadius: Radius.sheet, overflow: 'hidden', gap: Space.xs, backgroundColor: StatsTheme.card },
  changePill: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs, alignSelf: 'flex-start', paddingHorizontal: Space.sm, paddingVertical: Space.xxs, borderRadius: Radius.pill, backgroundColor: StatsTheme.track },
  heroRow: { flexDirection: 'row', marginTop: Space.md, gap: Space.sm },
  heroFigure: { flex: 1, minWidth: 0 },
  topArtist: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  bigAvatar: { width: 112, height: 112, borderRadius: 56, overflow: 'hidden' },
  topArtistText: { flex: 1, minWidth: 0, gap: 2 },
  rankLabel: { color: StatsTheme.rank },
  artistRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Space.xs },
  smallArtist: { width: 72, alignItems: 'center', gap: 2 },
  smallAvatar: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 64 },
  rank: { width: 24, textAlign: 'center', color: StatsTheme.rank },
  songArt: { width: 48, height: 48, borderRadius: Radius.cover, overflow: 'hidden' },
  songText: { flex: 1, minWidth: 0 },
  songTitle: { fontWeight: '600' },
  songNumbers: { alignItems: 'flex-end' },
  repeat: { marginHorizontal: GUTTER, marginTop: Space.md, padding: Space.lg, borderRadius: Radius.sheet, overflow: 'hidden', gap: Space.xs, backgroundColor: StatsTheme.card },
  repeatBody: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: Space.xs },
  repeatArt: { width: 120, height: 120, borderRadius: Radius.cover, overflow: 'hidden' },
  repeatText: { flex: 1, minWidth: 0, gap: 2 },
  repeatTime: { marginTop: Space.sm },
  repeatPlay: { position: 'absolute', right: Space.lg, bottom: Space.lg, width: 48, height: 48, borderRadius: 24, backgroundColor: Signal.wave, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { marginLeft: 2 },
  clockWrap: { alignItems: 'center', justifyContent: 'center', marginTop: Space.xs },
  clockCentre: { position: 'absolute', alignItems: 'center' },
  clockLabels: { alignItems: 'center' },
  persona: { marginTop: Space.xxs },
  bars: { flexDirection: 'row', height: 120, gap: Space.xs, alignItems: 'flex-end' },
  barColumn: { flex: 1, alignItems: 'center', gap: Space.xxs, height: '100%' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', borderRadius: Radius.thumb, backgroundColor: StatsTheme.track, overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: Radius.thumb },
  daily: { flexDirection: 'row', height: 72, gap: 2, alignItems: 'flex-end' },
  dailyTrack: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  dailyFill: { width: '100%', borderRadius: 2 },
  bpmRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm },
  bandBar: { flexDirection: 'row', height: 10, borderRadius: Radius.pill, overflow: 'hidden', backgroundColor: StatsTheme.track },
  bandLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  tempoLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: GUTTER - Space.xxs, marginTop: Space.sm },
  tile: { width: '50%', padding: Space.xxs },
  tileInner: { padding: Space.md, borderRadius: Radius.sheet, backgroundColor: StatsTheme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: StatsTheme.cardRim },
  tileValue: { flexDirection: 'row', alignItems: 'baseline', marginTop: Space.xxs },
});
