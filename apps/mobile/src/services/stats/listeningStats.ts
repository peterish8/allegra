/**
 * Listening stats (1.45.0, owner): Spotify keeps its stats to a four-week glance; LuvLyrics shows everything, free, to
 * everyone. Pure: takes the phone's listen log (`listen_log`) and returns what the stats page shows. No React, no
 * database, so every rule is tested directly (listeningStats.test.ts).
 *
 * Counting follows the industry's rules so numbers mean what people expect:
 *  - minutes are audio actually heard (listenTracker counts forward progress only, never wall time);
 *  - a "play" is a listen of at least PLAY_SECONDS (Spotify's 30 s stream);
 *  - a skip is leaving a song before SKIP_SECONDS;
 *  - a song's artists share its time (every credited artist gets the full minutes, as Spotify credits features).
 */
import { creditedArtists } from '@shared/identity';
import type { ListenEntry } from '../../database/listenLogQueries';

export const PLAY_SECONDS = 30;
export const SKIP_SECONDS = 30;
const DAY_MS = 86_400_000;

export type StatsRange = 'week' | 'month' | 'half' | 'year' | 'all';
export const STATS_RANGES: readonly { id: StatsRange; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: '4 weeks' },
  { id: 'half', label: '6 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export interface RangeBounds {
  readonly from: number;
  readonly to: number;
  /** The period just before, for "up 12% on the previous 4 weeks". Null for all time. */
  readonly previousFrom: number | null;
  readonly days: number;
}

/** Local midnight of the day containing `ms`. */
export const startOfDay = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function rangeBounds(range: StatsRange, now: number, firstListen: number | null): RangeBounds {
  const today = startOfDay(now);
  const span = (days: number): RangeBounds => {
    const from = today - (days - 1) * DAY_MS;
    return { from, to: now, previousFrom: from - days * DAY_MS, days };
  };
  if (range === 'week') return span(7);
  if (range === 'month') return span(28);
  if (range === 'half') return span(182);
  if (range === 'year') {
    const jan1 = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    const days = Math.round((today - jan1) / DAY_MS) + 1;
    return { from: jan1, to: now, previousFrom: new Date(new Date(now).getFullYear() - 1, 0, 1).getTime(), days };
  }
  const from = firstListen === null ? today : startOfDay(firstListen);
  return { from, to: now, previousFrom: null, days: Math.round((today - from) / DAY_MS) + 1 };
}

export interface TopSong {
  readonly key: string; readonly title: string; readonly artist: string; readonly artwork: string | null;
  readonly ref: string | null; readonly songId: string;
  readonly seconds: number; readonly plays: number; readonly firstAt: number; readonly lastAt: number;
  /** Its place in the period before (1 = top), null when it was not heard then. See `rankMove`. */
  readonly previousRank: number | null;
}
export interface TopArtist {
  readonly name: string; readonly seconds: number; readonly plays: number; readonly songs: number;
  /** The cover of their most-heard song, for their tile. */
  readonly artwork: string | null;
  /** Their place in the period before (1 = top), null when they were not heard then. See `rankMove`. */
  readonly previousRank: number | null;
}

export type Persona = 'early bird' | 'daytime' | 'evening' | 'night owl';

/** "new": the song new to you this period that you played most. "repeat": another song you kept coming back to. */
export interface StatsHighlight { readonly kind: 'new' | 'repeat'; readonly song: TopSong }

/** A new find needs two plays and a repeat three, so one stray listen never becomes the page's highlight. */
export const HIGHLIGHT_NEW_PLAYS = 2;
export const HIGHLIGHT_REPEAT_PLAYS = 3;

/**
 * The highlight, from the songs ranked by time heard (`ranked[0]` is the top song, already on its tile): the
 * longest-heard song first heard in this range, else the most-replayed of the others. Null when neither qualifies.
 * `isNew` is false for every song in the all-time range, where everything is new.
 */
export function pickHighlight(ranked: readonly TopSong[], isNew: (song: TopSong) => boolean): StatsHighlight | null {
  const others = ranked.slice(1);
  const found = others.find(s => isNew(s) && s.plays >= HIGHLIGHT_NEW_PLAYS);
  if (found) return { kind: 'new', song: found };
  const repeat = others.filter(s => s.plays >= HIGHLIGHT_REPEAT_PLAYS)
    .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)[0];
  return repeat ? { kind: 'repeat', song: repeat } : null;
}

export interface ListeningStats {
  readonly range: StatsRange;
  readonly bounds: RangeBounds;
  readonly empty: boolean;
  readonly seconds: number;
  readonly plays: number;
  readonly songs: number;
  readonly artists: number;
  /** Change in minutes against the previous period, as a fraction (0.12 = up 12%); null when there is none. */
  readonly change: number | null;
  /** The period before had listening to rank against (a minute or more), so places can move. False for all time. */
  readonly ranked: boolean;
  readonly dailyAverageSeconds: number;
  readonly topSongs: readonly TopSong[];
  /** The card under the two tiles (Spotify's weekly highlight). Never the top song itself, which a tile already shows. */
  readonly highlight: StatsHighlight | null;
  /** The 25 songs heard longest: what the tempo card is measured over. */
  readonly heavyRotation: readonly TopSong[];
  readonly topArtists: readonly TopArtist[];
  /** The one song heard the longest: the "on repeat" card. */
  readonly onRepeat: TopSong | null;
  /** Seconds heard in each hour of the day, 0..23 (local time). */
  readonly clock: readonly number[];
  readonly peakHour: number | null;
  readonly persona: Persona | null;
  /** Seconds heard on each weekday, Monday first. */
  readonly weekdays: readonly number[];
  readonly topWeekday: number | null;
  /** Seconds per day across the range (oldest first); at most the last 31 days for long ranges. */
  readonly daily: readonly { day: number; seconds: number }[];
  readonly currentStreak: number;
  readonly longestStreak: number;
  /** Plays heard to the end, and listens left inside SKIP_SECONDS, as fractions of listens. */
  readonly finishedShare: number;
  readonly skipShare: number;
  readonly newSongs: number;
  readonly newArtists: number;
  /** The longest single day. */
  readonly biggestDay: { day: number; seconds: number } | null;
}

const add = <K>(map: Map<K, number>, key: K, value: number) => map.set(key, (map.get(key) ?? 0) + value);

/** Places by time heard (1 = most), for songs (by song key) and artists (by lower-case name), over `entries`. */
function placesOf(entries: readonly ListenEntry[]): { songs: Map<string, number>; artists: Map<string, number> } {
  const songSeconds = new Map<string, number>();
  const artistSeconds = new Map<string, number>();
  for (const e of entries) {
    if (e.heardSec <= 0) continue;
    add(songSeconds, e.songKey, e.heardSec);
    for (const name of creditedArtists(e.artist)) add(artistSeconds, name.toLowerCase(), e.heardSec);
  }
  const places = (m: Map<string, number>) =>
    new Map([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key], i) => [key, i + 1] as const));
  return { songs: places(songSeconds), artists: places(artistSeconds) };
}

/** Monday = 0 … Sunday = 6. */
const weekdayOf = (ms: number): number => (new Date(ms).getDay() + 6) % 7;

export function personaFor(clock: readonly number[]): Persona | null {
  const total = clock.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const sum = (hours: number[]) => hours.reduce((a, h) => a + clock[h], 0);
  const parts: [Persona, number][] = [
    ['early bird', sum([5, 6, 7, 8, 9])],
    ['daytime', sum([10, 11, 12, 13, 14, 15, 16])],
    ['evening', sum([17, 18, 19, 20, 21])],
    ['night owl', sum([22, 23, 0, 1, 2, 3, 4])],
  ];
  // Per hour of the window, so a long window doesn't win by size alone.
  const size: Record<Persona, number> = { 'early bird': 5, daytime: 7, evening: 5, 'night owl': 7 };
  return parts.sort((a, b) => b[1] / size[b[0]] - a[1] / size[a[0]])[0][0];
}

/** Consecutive days (with at least a minute heard) ending today or yesterday, and the longest run ever. */
export function streaks(dayStarts: readonly number[], now: number): { current: number; longest: number } {
  const days = [...new Set(dayStarts)].sort((a, b) => a - b);
  let longest = 0, run = 0, prev: number | null = null;
  for (const d of days) {
    run = prev !== null && Math.round((d - prev) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const today = startOfDay(now);
  const last = days[days.length - 1];
  const current = last !== undefined && Math.round((today - last) / DAY_MS) <= 1 ? run : 0;
  return { current, longest };
}

/** A pause longer than this is a new sitting with the song, not the same listen carried on. */
export const RESUME_GAP_MS = 30 * 60_000;

/**
 * The tracker closes a listen at every pause, so one sitting with a song reaches the log as several rows, each too
 * short to be a play and the early ones counted as neither finished nor skipped. A row that ended in a pause and is
 * followed by the same song soon after is the same listen: joined, its time summed and its ending the last one's.
 */
export function joinResumed(entries: readonly ListenEntry[]): ListenEntry[] {
  const sorted = [...entries].sort((a, b) => a.startedAt - b.startedAt);
  const out: ListenEntry[] = [];
  for (const e of sorted) {
    const prev = out[out.length - 1];
    const resumed = prev !== undefined && prev.exit === 'paused' && prev.songKey === e.songKey
      && e.startedAt - prev.startedAt <= prev.heardSec * 1000 + RESUME_GAP_MS;
    if (!resumed) { out.push(e); continue; }
    out[out.length - 1] = {
      ...prev,
      heardSec: Math.round((prev.heardSec + e.heardSec) * 10) / 10,
      exit: e.exit,
      artwork: e.artwork ?? prev.artwork,
    };
  }
  return out;
}

export function computeStats(
  raw: readonly ListenEntry[],
  range: StatsRange,
  now: number,
  /** When each song was first heard ever (song key -> ms), for "new to you". */
  firstHeard: ReadonlyMap<string, { at: number; artist: string }> = new Map(),
): ListeningStats {
  const all = joinResumed(raw);
  // A loop, not Math.min(...all): a long history would overflow the argument list.
  let firstListen: number | null = null;
  for (const e of all) if (firstListen === null || e.startedAt < firstListen) firstListen = e.startedAt;
  const bounds = rangeBounds(range, now, firstListen);
  const inRange = all.filter(e => e.startedAt >= bounds.from && e.startedAt <= bounds.to && e.heardSec > 0);
  const previous = bounds.previousFrom === null ? [] : all.filter(e => e.startedAt >= bounds.previousFrom! && e.startedAt < bounds.from);

  const songs = new Map<string, { entry: ListenEntry; seconds: number; plays: number; firstAt: number; lastAt: number }>();
  const artistSeconds = new Map<string, number>();
  const artistPlays = new Map<string, number>();
  const artistSongs = new Map<string, Set<string>>();
  const artistNames = new Map<string, string>();
  const clock = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  const perDay = new Map<number, number>();
  let seconds = 0, plays = 0, finished = 0, skipped = 0;

  for (const e of inRange) {
    seconds += e.heardSec;
    const played = e.heardSec >= PLAY_SECONDS;
    if (played) plays++;
    if (e.exit === 'ended') finished++;
    if (e.exit === 'skipped' && e.heardSec < SKIP_SECONDS) skipped++;
    const song = songs.get(e.songKey);
    if (song) {
      song.seconds += e.heardSec; song.plays += played ? 1 : 0;
      song.firstAt = Math.min(song.firstAt, e.startedAt);
      if (e.startedAt >= song.lastAt) { song.lastAt = e.startedAt; if (e.artwork) song.entry = e; }
    } else {
      songs.set(e.songKey, { entry: e, seconds: e.heardSec, plays: played ? 1 : 0, firstAt: e.startedAt, lastAt: e.startedAt });
    }
    for (const name of creditedArtists(e.artist)) {
      const key = name.toLowerCase();
      if (!artistNames.has(key)) artistNames.set(key, name);
      add(artistSeconds, key, e.heardSec);
      if (played) add(artistPlays, key, 1);
      (artistSongs.get(key) ?? artistSongs.set(key, new Set()).get(key)!).add(e.songKey);
    }
    const hour = new Date(e.startedAt).getHours();
    clock[hour] += e.heardSec;
    weekdays[weekdayOf(e.startedAt)] += e.heardSec;
    add(perDay, startOfDay(e.startedAt), e.heardSec);
  }

  const before = placesOf(previous);
  const topSongsAll: TopSong[] = [...songs.entries()].map(([key, s]) => ({
    key, title: s.entry.title, artist: s.entry.artist, artwork: s.entry.artwork, ref: s.entry.ref, songId: s.entry.songId,
    seconds: s.seconds, plays: s.plays, firstAt: s.firstAt, lastAt: s.lastAt, previousRank: before.songs.get(key) ?? null,
  })).sort((a, b) => b.seconds - a.seconds || b.plays - a.plays || a.title.localeCompare(b.title));

  const artworkFor = (artistKey: string): string | null =>
    topSongsAll.find(s => creditedArtists(s.artist).some(n => n.toLowerCase() === artistKey) && s.artwork)?.artwork ?? null;
  const topArtists: TopArtist[] = [...artistSeconds.entries()]
    .sort((a, b) => b[1] - a[1] || (artistPlays.get(b[0]) ?? 0) - (artistPlays.get(a[0]) ?? 0) || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key, secs]) => ({
      name: artistNames.get(key) ?? key, seconds: secs, plays: artistPlays.get(key) ?? 0,
      songs: artistSongs.get(key)?.size ?? 0, artwork: artworkFor(key), previousRank: before.artists.get(key) ?? null,
    }));

  const previousSeconds = previous.reduce((a, e) => a + e.heardSec, 0);
  const change = bounds.previousFrom === null || previousSeconds < 60 ? null : (seconds - previousSeconds) / previousSeconds;
  const peak = clock.some(v => v > 0) ? clock.indexOf(Math.max(...clock)) : null;
  const topWeekday = weekdays.some(v => v > 0) ? weekdays.indexOf(Math.max(...weekdays)) : null;

  // Days across the range, oldest first; long ranges show their last 31 days.
  const lastDay = startOfDay(now);
  const shown = Math.min(bounds.days, 31);
  const daily = Array.from({ length: shown }, (_, i) => {
    const day = lastDay - (shown - 1 - i) * DAY_MS;
    return { day, seconds: perDay.get(day) ?? 0 };
  });
  const biggest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  // Streaks look at every listen ever, not just this range: a streak doesn't reset when the range does.
  const everyDay = new Map<number, number>();
  for (const e of all) add(everyDay, startOfDay(e.startedAt), e.heardSec);
  const run = streaks([...everyDay.entries()].filter(([, s]) => s >= 60).map(([d]) => d), now);

  const newSongs = [...songs.keys()].filter(k => (firstHeard.get(k)?.at ?? Infinity) >= bounds.from).length;
  const artistFirst = new Map<string, number>();
  for (const { at, artist } of firstHeard.values()) {
    for (const name of creditedArtists(artist)) {
      const key = name.toLowerCase();
      artistFirst.set(key, Math.min(artistFirst.get(key) ?? Infinity, at));
    }
  }
  const newArtists = [...artistSeconds.keys()].filter(k => (artistFirst.get(k) ?? Infinity) >= bounds.from).length;
  const listens = inRange.length;

  return {
    range, bounds, empty: inRange.length === 0, seconds, plays, songs: songs.size, artists: artistSeconds.size, change,
    ranked: bounds.previousFrom !== null && previousSeconds >= 60,
    // Averaged over every day of the range so far, quiet days included (Spotify's "daily average").
    dailyAverageSeconds: seconds / Math.max(1, bounds.days),
    topSongs: topSongsAll.slice(0, 5), heavyRotation: topSongsAll.slice(0, 25), topArtists, onRepeat: topSongsAll[0] ?? null,
    highlight: pickHighlight(topSongsAll, s => range !== 'all' && (firstHeard.get(s.key)?.at ?? Infinity) >= bounds.from),
    clock, peakHour: peak, persona: personaFor(clock), weekdays, topWeekday, daily,
    currentStreak: run.current, longestStreak: run.longest,
    finishedShare: listens ? finished / listens : 0, skipShare: listens ? skipped / listens : 0,
    newSongs: range === 'all' ? songs.size : newSongs, newArtists: range === 'all' ? artistSeconds.size : newArtists,
    biggestDay: biggest ? { day: biggest[0], seconds: biggest[1] } : null,
  };
}

// ── words ────────────────────────────────────────────────────────────────────

/** "12,340" minutes. */
export const minutesOf = (seconds: number): number => Math.floor(seconds / 60);

/** "6 h 12 min" / "42 min" / "under a minute". */
export function durationWords(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** "9 pm", "12 am". */
export const hourWords = (hour: number): string => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'am' : 'pm'}`;

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** "Up 12% on the previous 4 weeks" / "Down 3% …" / null. */
export function changeWords(change: number | null, range: StatsRange): string | null {
  if (change === null || !Number.isFinite(change)) return null;
  const pct = Math.round(Math.abs(change) * 100);
  const what = range === 'week' ? 'last week' : range === 'month' ? 'the 4 weeks before' : range === 'half' ? 'the 6 months before' : 'last year';
  if (pct === 0) return `Same as ${what}`;
  return `${change > 0 ? 'Up' : 'Down'} ${pct}% on ${what}`;
}

/** How a place moved against the period before (Spotify's little green arrow on a top artist or song). */
export type RankMove = { readonly kind: 'up' | 'down' | 'same' | 'new'; readonly by: number };

/** `rank` is 1-based. Null when there is nothing to compare with (all time, or a quiet period before). */
export function rankMove(rank: number, previousRank: number | null, ranked: boolean): RankMove | null {
  if (!ranked) return null;
  if (previousRank === null) return { kind: 'new', by: 0 };
  const by = previousRank - rank;
  if (by > 0) return { kind: 'up', by };
  if (by < 0) return { kind: 'down', by: -by };
  return { kind: 'same', by: 0 };
}

/** What TalkBack reads for a move: "Up 2 places", "New this period". */
export function rankMoveWords(move: RankMove | null): string {
  if (!move) return '';
  if (move.kind === 'new') return 'New this period';
  if (move.kind === 'same') return 'Same place as before';
  return `${move.kind === 'up' ? 'Up' : 'Down'} ${move.by} ${move.by === 1 ? 'place' : 'places'}`;
}

const dayMonth = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
};

/** The dates under the title (Spotify's "Oct 30 - Nov 4"): "15 Oct – 11 Nov", with years when they differ. */
export function rangeWords(bounds: RangeBounds): string {
  const from = new Date(bounds.from), to = new Date(bounds.to);
  if (startOfDay(bounds.from) === startOfDay(bounds.to)) return `Today, ${dayMonth(bounds.to)}`;
  if (from.getFullYear() !== to.getFullYear()) return `${dayMonth(bounds.from)} ${from.getFullYear()} – ${dayMonth(bounds.to)} ${to.getFullYear()}`;
  return `${dayMonth(bounds.from)} – ${dayMonth(bounds.to)}`;
}

/** The text the Share button sends: the dates, the minutes, the top artist and the top song. */
export function statsShareText(stats: ListeningStats): string {
  // Grouped by hand ("12,340"), so it reads the same on every Android version.
  const minutes = String(minutesOf(stats.seconds)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const lines = [`My listening, ${rangeWords(stats.bounds)}`, `${minutes} minutes`];
  const artist = stats.topArtists[0];
  const song = stats.topSongs[0];
  if (artist) lines.push(`Top artist: ${artist.name}`);
  if (song) lines.push(`Top song: ${song.title} by ${song.artist}`);
  lines.push('On LuvLyrics');
  return lines.join('\n');
}

export const PERSONA_WORDS: Record<Persona, { title: string; body: string }> = {
  'early bird': { title: 'Early bird', body: 'Your music starts with the day.' },
  daytime: { title: 'Daytime listener', body: 'Your days have a soundtrack.' },
  evening: { title: 'Evening unwinder', body: 'You press play when the day winds down.' },
  'night owl': { title: 'Night owl', body: 'Your best listening happens after dark.' },
};

// ── tempo ────────────────────────────────────────────────────────────────────

export type TempoBand = 'slow' | 'steady' | 'upbeat' | 'fast';
export const TEMPO_BANDS: readonly { id: TempoBand; label: string; from: number; to: number }[] = [
  { id: 'slow', label: 'Slow', from: 0, to: 90 },
  { id: 'steady', label: 'Steady', from: 90, to: 115 },
  { id: 'upbeat', label: 'Upbeat', from: 115, to: 135 },
  { id: 'fast', label: 'Fast', from: 135, to: Infinity },
];
export const bandOf = (bpm: number): TempoBand => TEMPO_BANDS.find(b => bpm >= b.from && bpm < b.to)!.id;

export interface TempoSummary {
  /** Weighted by time heard. */
  readonly averageBpm: number;
  readonly band: TempoBand;
  /** Share of time heard in each band. */
  readonly shares: Readonly<Record<TempoBand, number>>;
  readonly fastest: { title: string; artist: string; bpm: number } | null;
  readonly slowest: { title: string; artist: string; bpm: number } | null;
  readonly known: number;
}

/** The tempo of what you listen to, from the songs whose tempo is known. Null below three known songs. */
export function tempoSummary(songs: readonly TopSong[], bpm: ReadonlyMap<string, number | null>): TempoSummary | null {
  const known = songs.flatMap(s => { const b = bpm.get(s.key); return b && b > 0 ? [{ s, b }] : []; });
  if (known.length < 3) return null;
  const total = known.reduce((a, k) => a + k.s.seconds, 0) || 1;
  const averageBpm = known.reduce((a, k) => a + k.b * k.s.seconds, 0) / total;
  const shares = { slow: 0, steady: 0, upbeat: 0, fast: 0 } as Record<TempoBand, number>;
  for (const k of known) shares[bandOf(k.b)] += k.s.seconds / total;
  const sorted = [...known].sort((a, b) => b.b - a.b);
  const pick = (k: { s: TopSong; b: number }) => ({ title: k.s.title, artist: k.s.artist, bpm: Math.round(k.b) });
  return { averageBpm: Math.round(averageBpm), band: bandOf(averageBpm), shares, fastest: pick(sorted[0]), slowest: pick(sorted[sorted.length - 1]), known: known.length };
}
