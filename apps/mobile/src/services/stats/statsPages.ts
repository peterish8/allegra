/**
 * What the stats pages beyond the first one show (1.48.0): the full top lists with "N weeks in top 5", the past weeks,
 * the headline words, and the insight cards. Pure and built from the phone's own listen log only: a card that the log
 * cannot back with real numbers is not made, and nothing is estimated or invented. Tested in statsPages.test.ts.
 */
import { creditedArtists } from '@shared/identity';
import type { ListenEntry } from '../../database/listenLogQueries';
import {
  computeStats, durationWords, joinResumed, minutesOf, PLAY_SECONDS, rangeWords,
  type ListeningStats, type StatsRange,
} from './listeningStats';

// ── weeks ────────────────────────────────────────────────────────────────────

/** Local midnight of the Monday of the week containing `ms` (the app's weeks start on Monday). */
export function weekStartOf(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** `ms` moved by whole local days, so a clock change never leaves a week an hour short. */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** The last millisecond of the week that starts at `weekStart`. */
export const weekEndOf = (weekStart: number): number => addDays(weekStart, 7) - 1;

// ── "N weeks in top 5" ───────────────────────────────────────────────────────

export const TOP_FIVE = 5;
/** An item needs a minute in a week to count towards that week's top five. */
export const TOP_FIVE_MIN_SECONDS = 60;

export type RankKind = 'song' | 'artist';

/** The key an item is counted by: a song's key, or an artist's lower-case name. */
export const artistKeyOf = (name: string): string => name.toLowerCase();

/** How many calendar weeks (Monday to Sunday) each song or artist was in that week's top five by time heard. */
export function topFiveWeeks(raw: readonly ListenEntry[], kind: RankKind): Map<string, number> {
  const weeks = new Map<number, Map<string, number>>();
  const bump = (week: Map<string, number>, key: string, seconds: number) => week.set(key, (week.get(key) ?? 0) + seconds);
  for (const e of joinResumed(raw)) {
    if (!(e.heardSec > 0)) continue;
    const start = weekStartOf(e.startedAt);
    const week = weeks.get(start) ?? new Map<string, number>();
    weeks.set(start, week);
    if (kind === 'song') bump(week, e.songKey, e.heardSec);
    else for (const name of creditedArtists(e.artist)) bump(week, artistKeyOf(name), e.heardSec);
  }
  const counts = new Map<string, number>();
  for (const week of weeks.values()) {
    const top = [...week.entries()]
      .filter(([, seconds]) => seconds >= TOP_FIVE_MIN_SECONDS)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_FIVE);
    for (const [key] of top) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** "1 week in top 5" / "4 weeks in top 5"; empty when it never made one. */
export function weeksInTopWords(weeks: number | undefined): string {
  if (!weeks || weeks < 1) return '';
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} in top 5`;
}

// ── past weeks ───────────────────────────────────────────────────────────────

export interface PastWeek {
  readonly weekStart: number;
  readonly weekEnd: number;
  /** "2 Nov – 8 Nov". */
  readonly label: string;
  readonly minutes: number;
  readonly plays: number;
  readonly topSong: { readonly key: string; readonly title: string; readonly artist: string; readonly artwork: string | null; readonly plays: number } | null;
}

/** The finished weeks before the one `now` is in that have any listening, newest first, at most `limit`. */
export function pastWeeks(raw: readonly ListenEntry[], now: number, limit = 8): PastWeek[] {
  const thisWeek = weekStartOf(now);
  type SongAcc = { entry: ListenEntry; seconds: number; plays: number };
  const weeks = new Map<number, { seconds: number; plays: number; songs: Map<string, SongAcc> }>();
  for (const e of joinResumed(raw)) {
    if (!(e.heardSec > 0)) continue;
    const start = weekStartOf(e.startedAt);
    if (start >= thisWeek) continue;
    const week = weeks.get(start) ?? { seconds: 0, plays: 0, songs: new Map<string, SongAcc>() };
    weeks.set(start, week);
    const played = e.heardSec >= PLAY_SECONDS;
    week.seconds += e.heardSec;
    if (played) week.plays++;
    const song = week.songs.get(e.songKey);
    if (song) {
      song.seconds += e.heardSec;
      if (played) song.plays++;
      if (e.artwork) song.entry = e;
    } else {
      week.songs.set(e.songKey, { entry: e, seconds: e.heardSec, plays: played ? 1 : 0 });
    }
  }
  return [...weeks.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([weekStart, week]) => {
      const best = [...week.songs.entries()]
        .sort((a, b) => b[1].seconds - a[1].seconds || b[1].plays - a[1].plays || a[1].entry.title.localeCompare(b[1].entry.title))[0];
      const weekEnd = weekEndOf(weekStart);
      return {
        weekStart, weekEnd,
        label: rangeWords({ from: weekStart, to: weekEnd, previousFrom: null, days: 7 }),
        minutes: minutesOf(week.seconds), plays: week.plays,
        topSong: best ? { key: best[0], title: best[1].entry.title, artist: best[1].entry.artist, artwork: best[1].entry.artwork, plays: best[1].plays } : null,
      };
    });
}

// ── words ────────────────────────────────────────────────────────────────────

/** The period a page is about, for its headline: a range, or one finished week. */
export type Period = StatsRange | 'past-week';

export function periodWords(period: Period): string {
  switch (period) {
    case 'week': return 'this week';
    case 'month': return 'in the last 4 weeks';
    case 'half': return 'in the last 6 months';
    case 'year': return 'this year';
    case 'all': return 'so far';
    default: return 'that week';
  }
}

/** Which stats a page is about: a range up to now, or one finished week (its Monday). */
export interface PageSelection { readonly range: StatsRange; readonly weekStart?: number }

/** The stats and the period words for a page's selection. A finished week is read as it stood when it ended. */
export function statsFor(
  raw: readonly ListenEntry[],
  selection: PageSelection,
  now: number,
  first: ReadonlyMap<string, { at: number; artist: string }>,
): { stats: ListeningStats; period: Period } {
  if (selection.weekStart !== undefined) {
    return { stats: computeStats(raw, 'week', Math.min(now, weekEndOf(selection.weekStart)), first), period: 'past-week' };
  }
  return { stats: computeStats(raw, selection.range, now, first), period: selection.range };
}

/** 12340 -> "12,340", the same on every Android version. */
export const groupedNumber = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "You listened to 42 artists this week" / "You listened to 1 song so far". */
export function listenedHeadline(kind: 'artists' | 'songs', count: number, period: Period): string {
  const noun = kind === 'artists' ? (count === 1 ? 'artist' : 'artists') : (count === 1 ? 'song' : 'songs');
  return `You listened to ${groupedNumber(count)} ${noun} ${periodWords(period)}`;
}

// ── insight cards ────────────────────────────────────────────────────────────

export interface AlbumLine { readonly title: string; readonly artist: string; readonly minutes: number; readonly artwork: string | null }

export type InsightCard =
  /** The three albums heard longest, and their minutes together. */
  | { readonly kind: 'albums'; readonly minutes: number; readonly items: readonly AlbumLine[] }
  /** The most-heard artist's time, as the big figure. */
  | { readonly kind: 'hours'; readonly figure: number; readonly unit: 'hour' | 'hours' | 'minutes'; readonly artist: string; readonly seconds: number; readonly artwork: string | null }
  /** Days in a row with at least a minute of listening. */
  | { readonly kind: 'streak'; readonly days: number };

export const ALBUMS_SHOWN = 3;
/** The albums card needs at least this many albums with names, so "these albums" is true. */
export const ALBUMS_MIN = 2;
/** Albums under a minute are not worth a line. */
export const ALBUM_MIN_MINUTES = 1;
/** The time card needs ten minutes with one artist. */
export const HOURS_MIN_SECONDS = 600;
export const STREAK_MIN_DAYS = 3;

/** The albums heard longest in `[from, to]`, or null when fewer than ALBUMS_MIN named albums were heard. */
export function albumsCard(raw: readonly ListenEntry[], from: number, to: number): InsightCard | null {
  type Acc = { title: string; artist: string; seconds: number; artwork: string | null; lastAt: number };
  const albums = new Map<string, Acc>();
  for (const e of joinResumed(raw)) {
    const title = e.album?.trim();
    if (!title || !(e.heardSec > 0) || e.startedAt < from || e.startedAt > to) continue;
    const artist = creditedArtists(e.artist)[0] ?? e.artist;
    const key = `${title.toLowerCase()}\u0000${artist.toLowerCase()}`;
    const acc = albums.get(key);
    if (acc) {
      acc.seconds += e.heardSec;
      if (e.startedAt >= acc.lastAt) { acc.lastAt = e.startedAt; acc.artwork = e.artwork ?? acc.artwork; }
    } else {
      albums.set(key, { title, artist, seconds: e.heardSec, artwork: e.artwork, lastAt: e.startedAt });
    }
  }
  const items = [...albums.values()]
    .sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title))
    .slice(0, ALBUMS_SHOWN)
    .map(a => ({ title: a.title, artist: a.artist, minutes: minutesOf(a.seconds), artwork: a.artwork }))
    .filter(a => a.minutes >= ALBUM_MIN_MINUTES);
  if (items.length < ALBUMS_MIN) return null;
  return { kind: 'albums', minutes: items.reduce((total, a) => total + a.minutes, 0), items };
}

/** The most-heard artist's time as a figure, or null under ten minutes. */
export function hoursCard(stats: ListeningStats): InsightCard | null {
  const artist = stats.topArtists[0];
  if (!artist || artist.seconds < HOURS_MIN_SECONDS) return null;
  const hours = Math.floor(artist.seconds / 3600);
  if (hours >= 1) return { kind: 'hours', figure: hours, unit: hours === 1 ? 'hour' : 'hours', artist: artist.name, seconds: artist.seconds, artwork: artist.artwork };
  return { kind: 'hours', figure: minutesOf(artist.seconds), unit: 'minutes', artist: artist.name, seconds: artist.seconds, artwork: artist.artwork };
}

export const streakCard = (stats: ListeningStats): InsightCard | null =>
  stats.currentStreak >= STREAK_MIN_DAYS ? { kind: 'streak', days: stats.currentStreak } : null;

/** Every card the log can back for these stats, in the order they are shown. */
export function insightCards(raw: readonly ListenEntry[], stats: ListeningStats): InsightCard[] {
  if (stats.empty) return [];
  return [albumsCard(raw, stats.bounds.from, stats.bounds.to), hoursCard(stats), streakCard(stats)]
    .filter((card): card is InsightCard => card !== null);
}

/** The card's heading, in words. */
export function insightHeading(card: InsightCard): string {
  switch (card.kind) {
    case 'albums': return `You spent ${groupedNumber(card.minutes)} minutes listening to these albums`;
    case 'hours': return `${card.figure} ${card.unit} of your listening`;
    default: return `${card.days} days in a row`;
  }
}

/** The line under the heading. */
export function insightCaption(card: InsightCard, period: Period): string {
  switch (card.kind) {
    case 'albums': return `Your top albums ${periodWords(period)}`;
    case 'hours': return `You listened to ${card.artist} for ${durationWords(card.seconds)} ${periodWords(period)}`;
    default: return 'You listened every day. Keep it going.';
  }
}
