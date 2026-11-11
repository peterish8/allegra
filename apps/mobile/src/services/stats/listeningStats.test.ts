/**
 * Listening stats (1.45.0): the numbers the stats page shows, from the phone's listen log.
 */
jest.mock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ listeningStats: true }) } }));
jest.mock('../../database/listenLogQueries', () => ({ insertListen: jest.fn(async () => undefined) }));

import type { ListenEntry } from '../../database/listenLogQueries';
import { insertListen } from '../../database/listenLogQueries';
import {
  bandOf, changeWords, computeStats, durationWords, hourWords, joinResumed, personaFor, pickHighlight, rangeBounds,
  rangeWords, rankMove, rankMoveWords, startOfDay, statsShareText, streaks, tempoSummary, PLAY_SECONDS, type TopSong,
} from './listeningStats';
import { listenEntryFor, logListen } from './listenLog';

const DAY = 86_400_000;
// Saturday 7 November 2026, 20:00 local.
const NOW = new Date(2026, 10, 7, 20, 0, 0).getTime();
const at = (daysAgo: number, hour: number, minute = 0) => {
  const d = new Date(NOW - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

let n = 0;
const listen = (title: string, artist: string, startedAt: number, heardSec: number, exit: ListenEntry['exit'] = 'ended', artwork: string | null = `https://cover/${title}`): ListenEntry => ({
  songKey: `${title.toLowerCase()}|${artist.toLowerCase()}`, songId: `stream:saavn:${title}`, ref: `saavn:${title}`,
  title, artist, album: null, artwork, durationSec: 200, startedAt: startedAt + (n++ % 7), heardSec, exit,
});

describe('ranges', () => {
  it('counts back whole days from today, with the period before for the comparison', () => {
    const month = rangeBounds('month', NOW, null);
    expect(month.days).toBe(28);
    expect(month.from).toBe(startOfDay(NOW) - 27 * DAY);
    expect(month.previousFrom).toBe(month.from - 28 * DAY);
    const week = rangeBounds('week', NOW, null);
    expect(week.from).toBe(startOfDay(NOW) - 6 * DAY);
  });

  it('this year starts on 1 January; all time starts at the first listen and has nothing before it', () => {
    const year = rangeBounds('year', NOW, null);
    expect(new Date(year.from).getMonth()).toBe(0);
    expect(new Date(year.from).getDate()).toBe(1);
    expect(new Date(year.previousFrom!).getFullYear()).toBe(2025);
    const all = rangeBounds('all', NOW, at(9, 10));
    expect(all.from).toBe(startOfDay(at(9, 10)));
    expect(all.days).toBe(10);
    expect(all.previousFrom).toBeNull();
  });
});

describe('the numbers', () => {
  const log: ListenEntry[] = [
    // The song on repeat: four full listens.
    ...[1, 2, 3, 4].map(d => listen('Tarantino', 'LISA', at(d, 22), 180)),
    // A duet: both artists get its time.
    listen('Mozhiye', 'Sai Abhyankkar, Sid Sriram', at(1, 8), 240),
    listen('Mozhiye', 'Sai Abhyankkar, Sid Sriram', at(2, 8), 240),
    // A skip, and a listen too short to be a play.
    listen('Vaazhanum', 'Sai Abhyankkar', at(0, 13), 8, 'skipped'),
    listen('Hukum', 'Anirudh Ravichander', at(5, 23), 25, 'paused'),
    // Last month, for the comparison only.
    listen('Old', 'Someone', at(40, 12), 600),
  ];
  const first = new Map(log.map(e => [e.songKey, { at: e.startedAt, artist: e.artist }]));
  first.set('mozhiye|sai abhyankkar, sid sriram', { at: at(60, 9), artist: 'Sai Abhyankkar, Sid Sriram' }); // heard before
  const stats = computeStats(log, 'month', NOW, first);

  it('adds up heard time, plays of 30 seconds or more, songs and artists', () => {
    expect(stats.seconds).toBe(4 * 180 + 2 * 240 + 8 + 25);
    expect(stats.plays).toBe(6);
    expect(stats.songs).toBe(4);
    expect(stats.artists).toBe(4); // LISA, Sai Abhyankkar, Sid Sriram, Anirudh
    expect(stats.empty).toBe(false);
    expect(PLAY_SECONDS).toBe(30);
  });

  it('ranks the top songs by time heard, and puts the longest-heard one on repeat with its plays', () => {
    expect(stats.topSongs.map(s => s.title)).toEqual(['Tarantino', 'Mozhiye', 'Hukum', 'Vaazhanum']);
    expect(stats.onRepeat).toMatchObject({ title: 'Tarantino', plays: 4, seconds: 720 });
    expect(stats.heavyRotation.length).toBe(4);
  });

  it('credits every artist on a song and gives each a cover from their most-heard song', () => {
    expect(stats.topArtists.map(a => a.name)).toEqual(['LISA', 'Sai Abhyankkar', 'Sid Sriram', 'Anirudh Ravichander']);
    expect(stats.topArtists[1]).toMatchObject({ seconds: 488, plays: 2, songs: 2, artwork: 'https://cover/Mozhiye' });
  });

  it('compares with the period before', () => {
    expect(stats.change).toBeCloseTo((1233 - 600) / 600);
    expect(changeWords(stats.change, 'month')).toBe('Up 106% on the 4 weeks before');
    expect(changeWords(-0.034, 'week')).toBe('Down 3% on last week');
    expect(changeWords(null, 'all')).toBeNull();
  });

  it('knows when you listen: the hour clock, its peak, the weekday and the kind of listener', () => {
    expect(stats.clock[22]).toBe(720);
    expect(stats.peakHour).toBe(22);
    expect(stats.persona).toBe('night owl');
    expect(stats.weekdays.reduce((a, b) => a + b, 0)).toBe(stats.seconds);
    expect(stats.topWeekday).not.toBeNull();
  });

  it('counts finished listens and skips, and what was new to you', () => {
    expect(stats.finishedShare).toBeCloseTo(6 / 8);
    expect(stats.skipShare).toBeCloseTo(1 / 8);
    // Mozhiye was heard 60 days ago, so it is not new; the other three are.
    expect(stats.newSongs).toBe(3);
  });

  it('shows the days of the range and the biggest one', () => {
    expect(stats.daily).toHaveLength(28);
    expect(stats.daily[stats.daily.length - 1].day).toBe(startOfDay(NOW));
    expect(stats.biggestDay!.seconds).toBeGreaterThan(0);
  });

  it('an empty log is an empty page, not a crash', () => {
    const none = computeStats([], 'all', NOW);
    expect(none).toMatchObject({ empty: true, seconds: 0, onRepeat: null, peakHour: null, persona: null, change: null });
  });
});

describe('a song paused and played on', () => {
  // The tracker closes a listen at every pause, so one sitting with a song arrives as several rows.
  const t0 = at(1, 21);
  const rows = [
    listen('Kesariya', 'Arijit Singh', t0, 25, 'paused'),
    listen('Kesariya', 'Arijit Singh', t0 + 60_000, 22, 'paused'),
    listen('Kesariya', 'Arijit Singh', t0 + 120_000, 100, 'ended'),
    // Another song in between, then a different sitting an hour later: not joined.
    listen('Other', 'Someone', t0 + 400_000, 60, 'ended'),
    listen('Kesariya', 'Arijit Singh', t0 + 3_600_000, 40, 'ended'),
  ];
  const stats = computeStats(rows, 'week', NOW);

  it('counts one play for the sitting, not a skipped-looking fragment each', () => {
    expect(joinResumed(rows)).toHaveLength(3);
    expect(stats.onRepeat).toMatchObject({ title: 'Kesariya', seconds: 25 + 22 + 100 + 40, plays: 2 });
  });

  it('reads the sitting as finished once, and not as skips or lost finishes', () => {
    expect(stats.finishedShare).toBeCloseTo(3 / 3);
    expect(stats.skipShare).toBe(0);
  });

  it('keeps the time heard the same and leaves unrelated rows alone', () => {
    expect(stats.seconds).toBe(25 + 22 + 100 + 60 + 40);
    const apart = [listen('A', 'X', t0, 10, 'paused'), listen('B', 'X', t0 + 20_000, 10, 'paused'), listen('A', 'X', t0 + 40_000, 10, 'ended')];
    expect(joinResumed(apart)).toHaveLength(3);
  });

  it('joins a pause that was followed by a skip into one short skip', () => {
    const firstRow = listen('A', 'X', t0, 8, 'paused');
    const joined = joinResumed([firstRow, listen('A', 'X', t0 + 30_000, 9, 'skipped')]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ heardSec: 17, exit: 'skipped', startedAt: firstRow.startedAt });
  });
});

describe('streaks', () => {
  it('runs of days end today or yesterday to count as current', () => {
    const days = [5, 4, 3, 1, 0].map(d => startOfDay(at(d, 12)));
    expect(streaks(days, NOW)).toEqual({ current: 2, longest: 3 });
    expect(streaks([startOfDay(at(3, 12))], NOW).current).toBe(0);
    expect(streaks([], NOW)).toEqual({ current: 0, longest: 0 });
  });
});

// The page's Spotify-style first glance: rank chips against the period before, the highlight card, the dates line and
// what Share sends.
describe('places, the highlight, the dates and sharing', () => {
  const log: ListenEntry[] = [
    // This 4 weeks: Tarantino first, Mozhiye second.
    ...[1, 2, 3, 4].map(d => listen('Tarantino', 'LISA', at(d, 22), 180)),
    ...[1, 2].map(d => listen('Mozhiye', 'Sid Sriram', at(d, 8), 200)),
    // The 4 weeks before: Mozhiye first, then Old, then Tarantino third.
    listen('Mozhiye', 'Sid Sriram', at(35, 8), 900),
    listen('Old', 'Someone', at(36, 12), 600),
    listen('Tarantino', 'LISA', at(37, 22), 100),
  ];
  const first = new Map(log.map(e => [e.songKey, { at: at(60, 9), artist: e.artist }]));
  const stats = computeStats(log, 'month', NOW, first);

  it('remembers each song and artist\'s place in the period before', () => {
    expect(stats.ranked).toBe(true);
    expect(stats.topSongs.map(s => [s.title, s.previousRank])).toEqual([['Tarantino', 3], ['Mozhiye', 1]]);
    expect(stats.topArtists.map(a => [a.name, a.previousRank])).toEqual([['LISA', 3], ['Sid Sriram', 1]]);
  });

  it('turns places into Spotify\'s chips: up, down, new, and nothing to compare for all time', () => {
    expect(rankMove(1, 3, true)).toEqual({ kind: 'up', by: 2 });
    expect(rankMove(2, 1, true)).toEqual({ kind: 'down', by: 1 });
    expect(rankMove(2, 2, true)).toEqual({ kind: 'same', by: 0 });
    expect(rankMove(4, null, true)).toEqual({ kind: 'new', by: 0 });
    expect(rankMove(1, 3, false)).toBeNull();
    expect(computeStats(log, 'all', NOW, first).ranked).toBe(false);
    expect(rankMoveWords({ kind: 'up', by: 1 })).toBe('Up 1 place');
    expect(rankMoveWords({ kind: 'down', by: 3 })).toBe('Down 3 places');
    expect(rankMoveWords(null)).toBe('');
  });

  it('a quiet period before has nothing to rank against, so no chip claims a move', () => {
    const quiet = computeStats([listen('Solo', 'One', at(1, 9), 200), listen('Blip', 'Two', at(30, 9), 20)], 'month', NOW);
    expect(quiet.ranked).toBe(false);
  });

  const song = (title: string, plays: number, seconds = plays * 200): TopSong => ({
    key: title, title, artist: 'A', artwork: null, ref: null, songId: title, seconds, plays, firstAt: 0, lastAt: 0, previousRank: null,
  });

  it('never makes the top song the highlight: a new find first, else the most replayed of the rest', () => {
    const ranked = [song('Top', 9), song('Known', 6), song('Fresh', 2), song('Once', 1)];
    expect(pickHighlight(ranked, s => s.title === 'Fresh' || s.title === 'Top')).toEqual({ kind: 'new', song: ranked[2] });
    expect(pickHighlight(ranked, () => false)).toEqual({ kind: 'repeat', song: ranked[1] });
    // One stray listen is never a highlight, and neither is a song played only twice.
    expect(pickHighlight([song('Top', 9), song('Twice', 2)], () => false)).toBeNull();
    expect(pickHighlight([song('Top', 9), song('Stray', 1)], () => true)).toBeNull();
    expect(pickHighlight([], () => true)).toBeNull();
  });

  it('picks the page\'s highlight from the log: nothing here is new, and Mozhiye has only 2 plays', () => {
    expect(stats.highlight).toBeNull();
    const withFind = computeStats([...log, ...[1, 2].map(d => listen('Fresh', 'New', at(d, 10), 150))], 'month', NOW, first);
    expect(withFind.highlight).toMatchObject({ kind: 'new', song: { title: 'Fresh' } });
  });

  it('writes the dates the way the title line shows them', () => {
    expect(rangeWords(stats.bounds)).toBe('11 Oct – 7 Nov');
    expect(rangeWords(rangeBounds('all', NOW, NOW))).toBe('Today, 7 Nov');
    expect(rangeWords(rangeBounds('all', NOW, new Date(2025, 2, 3).getTime()))).toBe('3 Mar 2025 – 7 Nov 2026');
  });

  it('shares the dates, the minutes, the top artist and the top song', () => {
    expect(statsShareText(stats)).toBe('My listening, 11 Oct – 7 Nov\n18 minutes\nTop artist: LISA\nTop song: Tarantino by LISA\nOn LuvLyrics');
  });
});

describe('words', () => {
  it('reads durations and hours the way people say them', () => {
    expect(durationWords(30)).toBe('under a minute');
    expect(durationWords(42 * 60)).toBe('42 min');
    expect(durationWords(6 * 3600 + 12 * 60)).toBe('6 h 12 min');
    expect(durationWords(2 * 3600)).toBe('2 h');
    expect(hourWords(0)).toBe('12 am');
    expect(hourWords(21)).toBe('9 pm');
    expect(personaFor(Array.from({ length: 24 }, (_, h) => (h === 7 ? 100 : 0)))).toBe('early bird');
  });
});

describe('tempo', () => {
  it('averages the tempo by time heard and splits it into bands, once three songs are known', () => {
    const stats = computeStats([
      listen('A', 'x', at(0, 9), 600), listen('B', 'x', at(0, 10), 300), listen('C', 'x', at(0, 11), 100), listen('D', 'x', at(0, 12), 100),
    ], 'week', NOW);
    const bpm = new Map<string, number | null>([['a|x', 120], ['b|x', 90], ['c|x', 160], ['d|x', null]]);
    const summary = tempoSummary(stats.heavyRotation, bpm)!;
    expect(summary.averageBpm).toBe(Math.round((120 * 600 + 90 * 300 + 160 * 100) / 1000));
    expect(summary.known).toBe(3);
    expect(summary.fastest).toMatchObject({ title: 'C', bpm: 160 });
    expect(summary.slowest).toMatchObject({ title: 'B', bpm: 90 });
    expect(summary.shares.upbeat).toBeCloseTo(0.6);
    expect(tempoSummary(stats.heavyRotation, new Map([['a|x', 120]]))).toBeNull();
    expect([bandOf(80), bandOf(100), bandOf(128), bandOf(150)]).toEqual(['slow', 'steady', 'upbeat', 'fast']);
  });
});

describe('the log', () => {
  const song = { id: 'stream:saavn:B4-hLCKJ', title: 'Mozhiye', artist: 'Sai Abhyankkar', artwork: 'file:///cover.jpg', coverRemoteUri: 'https://c/x.jpg', duration: 240 };

  it('keeps what a listen was, when, how long and how it ended, with the cover that travels', () => {
    const entry = listenEntryFor(song, { exit: 'ended', heardSeconds: 238.44, exitPositionSec: 239 }, '2026-11-07T10:00:00.000Z')!;
    expect(entry).toMatchObject({
      songId: 'stream:saavn:B4-hLCKJ', ref: 'saavn:B4-hLCKJ', title: 'Mozhiye', artist: 'Sai Abhyankkar',
      artwork: 'https://c/x.jpg', durationSec: 240, startedAt: Date.parse('2026-11-07T10:00:00.000Z'), heardSec: 238.4, exit: 'ended',
    });
    expect(entry.songKey).toBe(listenEntryFor({ ...song, id: 'local-1' }, { exit: 'ended', heardSeconds: 5, exitPositionSec: 5 }, '2026-11-07T10:00:00.000Z')!.songKey);
  });

  it('skips taps under a second and broken times', () => {
    expect(listenEntryFor(song, { exit: 'skipped', heardSeconds: 0.4, exitPositionSec: 0 }, '2026-11-07T10:00:00.000Z')).toBeNull();
    expect(listenEntryFor(song, { exit: 'ended', heardSeconds: 10, exitPositionSec: 10 }, 'not a date')).toBeNull();
  });

  it('writes signed in or not', () => {
    logListen(song, { exit: 'ended', heardSeconds: 60, exitPositionSec: 60 }, '2026-11-07T10:00:00.000Z');
    expect(insertListen).toHaveBeenCalledTimes(1);
  });
});
