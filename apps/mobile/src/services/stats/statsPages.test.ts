/**
 * The stats pages beyond the first (1.48.0): weeks, "N weeks in top 5", past weeks, headlines and insight cards.
 */
import type { ListenEntry } from '../../database/listenLogQueries';
import { computeStats } from './listeningStats';
import {
  addDays, albumsCard, statsFor, hoursCard, insightCaption, insightCards, insightHeading, listenedHeadline, pastWeeks, periodWords,
  streakCard, topFiveWeeks, weekEndOf, weekStartOf, weeksInTopWords, ALBUMS_MIN, HOURS_MIN_SECONDS,
} from './statsPages';
import { insightCardModel, listCardModel, wrapLines } from './statsShare';

const DAY = 86_400_000;
// Saturday 7 November 2026, 20:00 local: its week is Monday 2 to Sunday 8 November.
const NOW = new Date(2026, 10, 7, 20, 0, 0).getTime();
const day = (month: number, date: number, hour = 12) => new Date(2026, month, date, hour, 0, 0).getTime();

let n = 0;
const listen = (title: string, artist: string, startedAt: number, heardSec: number, album: string | null = null, artwork: string | null = `https://cover/${title}`): ListenEntry => ({
  songKey: `${title.toLowerCase()}|${artist.toLowerCase()}`, songId: `stream:saavn:${title}`, ref: `saavn:${title}`,
  title, artist, album, artwork, durationSec: 200, startedAt: startedAt + (n++ % 7), heardSec, exit: 'ended',
});

describe('weeks start on Monday', () => {
  it('finds the Monday of any day and the end of that week', () => {
    const monday = new Date(2026, 10, 2).getTime();
    expect(weekStartOf(NOW)).toBe(monday);
    expect(weekStartOf(new Date(2026, 10, 8, 23, 59).getTime())).toBe(monday); // Sunday
    expect(weekStartOf(monday)).toBe(monday);
    expect(weekEndOf(monday)).toBe(new Date(2026, 10, 9).getTime() - 1);
    expect(weekStartOf(weekEndOf(monday) + 1)).toBe(new Date(2026, 10, 9).getTime());
  });

  it('moves by whole local days', () => {
    expect(new Date(addDays(new Date(2026, 2, 28, 12).getTime(), 2)).getDate()).toBe(30);
  });
});

describe('weeks in the top five', () => {
  // Week of 26 Oct: A, B. Week of 2 Nov: A, C. Week of 9 Nov: A only. B and C have six songs of rivals in one week.
  const log = [
    listen('A', 'X', day(9, 27), 600), listen('B', 'Y', day(9, 28), 300),
    listen('A', 'X', day(10, 3), 600), listen('C', 'Z', day(10, 4), 300),
    listen('A', 'X', day(10, 10), 120),
    // Too short to count (under a minute) in the week of 9 Nov.
    listen('Tiny', 'W', day(10, 11), 20),
  ];

  it('counts each calendar week a song made the top five', () => {
    const songs = topFiveWeeks(log, 'song');
    expect(songs.get('a|x')).toBe(3);
    expect(songs.get('b|y')).toBe(1);
    expect(songs.get('c|z')).toBe(1);
    expect(songs.has('tiny|w')).toBe(false);
  });

  it('counts every credited artist of a duet', () => {
    const artists = topFiveWeeks([listen('Duet', 'Ann, Bob', day(10, 3), 300)], 'artist');
    expect([...artists.keys()].sort()).toEqual(['ann', 'bob']);
  });

  it('leaves out a sixth place', () => {
    const six = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((t, i) => listen(t, `Art${i}`, day(10, 3), 600 - i * 60));
    const counts = topFiveWeeks(six, 'song');
    expect(counts.size).toBe(5);
    expect(counts.has('s6|art5')).toBe(false);
  });

  it('words it', () => {
    expect(weeksInTopWords(undefined)).toBe('');
    expect(weeksInTopWords(0)).toBe('');
    expect(weeksInTopWords(1)).toBe('1 week in top 5');
    expect(weeksInTopWords(4)).toBe('4 weeks in top 5');
  });
});

describe('past weeks', () => {
  const log = [
    listen('Old', 'X', day(9, 20), 400), // week of 19 Oct
    listen('Dope Track', 'Y', day(10, 3), 300), listen('Dope Track', 'Y', day(10, 4), 300), listen('Other', 'Z', day(10, 5), 100), // week of 2 Nov... this is the current week of NOW
    listen('Dope Track', 'Y', day(9, 29), 600), listen('Dope Track', 'Y', day(9, 30), 600), listen('Short', 'Q', day(9, 30), 10), // week of 26 Oct
  ];

  it('lists finished weeks, newest first, never the current one', () => {
    const weeks = pastWeeks(log, NOW);
    expect(weeks.map(w => w.label)).toEqual(['26 Oct – 1 Nov', '19 Oct – 25 Oct']);
  });

  it('names each week’s top song with its plays and the minutes heard', () => {
    const [week] = pastWeeks(log, NOW);
    expect(week.topSong).toMatchObject({ title: 'Dope Track', artist: 'Y', plays: 2 });
    expect(week.minutes).toBe(20);
    expect(week.plays).toBe(2);
  });

  it('caps the list and handles an empty log', () => {
    const many = Array.from({ length: 12 }, (_, i) => listen(`S${i}`, 'X', new Date(2026, 8, 1 + i * 7, 12).getTime(), 100));
    expect(pastWeeks(many, NOW, 8)).toHaveLength(8);
    expect(pastWeeks([], NOW)).toEqual([]);
  });
});

describe('headlines', () => {
  it('words the period', () => {
    expect(['week', 'month', 'half', 'year', 'all', 'past-week'].map(p => periodWords(p as never))).toEqual([
      'this week', 'in the last 4 weeks', 'in the last 6 months', 'this year', 'so far', 'that week',
    ]);
  });

  it('counts artists and songs, one and many', () => {
    expect(listenedHeadline('artists', 42, 'week')).toBe('You listened to 42 artists this week');
    expect(listenedHeadline('songs', 1, 'all')).toBe('You listened to 1 song so far');
    expect(listenedHeadline('songs', 1234, 'month')).toBe('You listened to 1,234 songs in the last 4 weeks');
  });
});

describe('insight cards', () => {
  const from = day(10, 2, 0);
  const to = day(10, 8, 23);
  const log = [
    listen('A1', 'Sai', day(10, 3), 3000, 'Baththa'), listen('A2', 'Sai', day(10, 4), 3000, 'Baththa'),
    listen('B1', 'Anirudh, Singer', day(10, 5), 4000, 'Jailer 2'),
    listen('C1', 'Sushin', day(10, 6), 1200, 'Scene'),
    listen('D1', 'Nobody', day(10, 7), 5000, null),
  ];

  it('builds the albums card from real album names, the three heard longest', () => {
    const card = albumsCard(log, from, to);
    expect(card).toMatchObject({ kind: 'albums' });
    if (card?.kind !== 'albums') throw new Error('albums');
    expect(card.items.map(i => [i.title, i.artist, i.minutes])).toEqual([['Baththa', 'Sai', 100], ['Jailer 2', 'Anirudh', 66], ['Scene', 'Sushin', 20]]);
    expect(card.minutes).toBe(186);
  });

  it('makes no albums card without enough named albums, and ignores songs with no album', () => {
    expect(ALBUMS_MIN).toBe(2);
    expect(albumsCard([listen('A', 'X', day(10, 3), 600, 'Only')], from, to)).toBeNull();
    expect(albumsCard([listen('A', 'X', day(10, 3), 600), listen('B', 'Y', day(10, 3), 600)], from, to)).toBeNull();
    expect(albumsCard(log, day(10, 20, 0), day(10, 22, 0))).toBeNull();
  });

  it('turns the top artist’s time into hours, or minutes under an hour, or nothing under ten minutes', () => {
    const hours = hoursCard(computeStats(log, 'week', to, new Map()));
    expect(hours).toMatchObject({ kind: 'hours', artist: 'Sai', figure: 1, unit: 'hour' });
    const mins = hoursCard(computeStats([listen('A', 'X', day(10, 3), 900)], 'week', to, new Map()));
    expect(mins).toMatchObject({ figure: 15, unit: 'minutes' });
    expect(HOURS_MIN_SECONDS).toBe(600);
    expect(hoursCard(computeStats([listen('A', 'X', day(10, 3), 500)], 'week', to, new Map()))).toBeNull();
  });

  it('makes a streak card only for three days or more', () => {
    const run = (days: number) => computeStats(Array.from({ length: days }, (_, i) => listen('A', 'X', NOW - i * DAY, 300)), 'week', NOW, new Map());
    expect(streakCard(run(2))).toBeNull();
    expect(streakCard(run(4))).toEqual({ kind: 'streak', days: 4 });
  });

  it('shows no cards for an empty period and says only what the log backs', () => {
    expect(insightCards([], computeStats([], 'week', NOW, new Map()))).toEqual([]);
    const stats = computeStats(log, 'week', to, new Map());
    const cards = insightCards(log, stats);
    expect(cards.map(c => c.kind)).toEqual(['albums', 'hours', 'streak']);
    expect(cards[2]).toEqual({ kind: 'streak', days: 5 });
  });

  it('words each card', () => {
    const stats = computeStats(log, 'week', to, new Map());
    const [albums, hours] = insightCards(log, stats);
    expect(insightHeading(albums)).toBe('You spent 186 minutes listening to these albums');
    expect(insightCaption(albums, 'past-week')).toBe('Your top albums that week');
    expect(insightHeading(hours)).toBe('1 hour of your listening');
    expect(insightCaption(hours, 'week')).toBe('You listened to Sai for 1 h 40 min this week');
  });
});

describe('the shared picture’s words', () => {
  const log = [listen('Scene', 'Sushin', day(10, 3), 900), listen('Hukum', 'Anirudh', day(10, 4), 600)];
  const stats = computeStats(log, 'week', day(10, 8, 23), new Map());

  it('lists the top artists and songs with places', () => {
    const artists = listCardModel('artists', stats);
    expect(artists?.heading).toBe('Top artists');
    expect(artists?.rows.map(r => [r.rank, r.title, r.meta])).toEqual([[1, 'Sushin', '15 min'], [2, 'Anirudh', '10 min']]);
    const songs = listCardModel('songs', stats);
    expect(songs?.rows[0]).toMatchObject({ rank: 1, title: 'Scene', meta: 'Sushin · 1 play' });
    expect(songs?.fileName).toMatch(/^luvlyrics-top-songs-.*\.png$/);
  });

  it('has no card for nothing', () => {
    expect(listCardModel('songs', computeStats([], 'week', NOW, new Map()))).toBeNull();
  });

  it('turns an insight card into its picture', () => {
    const albums = albumsCard([listen('A', 'X', day(10, 3), 600, 'One'), listen('B', 'Y', day(10, 4), 600, 'Two')], day(10, 2, 0), day(10, 8, 23));
    const model = insightCardModel(albums!, 'week', '2 Nov – 8 Nov');
    expect(model.tone).toBe('albums');
    expect(model.rows.map(r => r.title)).toEqual(['One', 'Two']);
    expect(model.rows[0].meta).toBe('10 min · X');
    const hours = insightCardModel({ kind: 'hours', figure: 12, unit: 'hours', artist: 'Z', seconds: 43_200, artwork: null }, 'week', 'x');
    expect(hours.figure).toBe('12 hours');
    expect(insightCardModel({ kind: 'streak', days: 5 }, 'week', 'x').figure).toBe('5 days');
  });

  it('wraps words into lines and cuts a long heading with an ellipsis', () => {
    const measure = (text: string) => text.length * 10;
    expect(wrapLines('one two three four', 90, measure)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('a b c d e f g h', 30, measure, 2)).toEqual(['a b', 'c d…']);
    expect(wrapLines('', 100, measure)).toEqual([]);
  });
});

describe('which stats a page is about', () => {
  const log = [listen('Old', 'X', day(9, 28), 900), listen('New', 'Y', day(10, 3), 600)];

  it('reads a finished week as it stood when it ended', () => {
    const { stats, period } = statsFor(log, { range: 'week', weekStart: new Date(2026, 9, 26).getTime() }, NOW, new Map());
    expect(period).toBe('past-week');
    expect(stats.topSongs.map(s => s.title)).toEqual(['Old']);
    expect(stats.seconds).toBe(900);
  });

  it('reads a range up to now otherwise', () => {
    const { stats, period } = statsFor(log, { range: 'month' }, NOW, new Map());
    expect(period).toBe('month');
    expect(stats.topSongs.map(s => s.title).sort()).toEqual(['New', 'Old']);
  });
});
