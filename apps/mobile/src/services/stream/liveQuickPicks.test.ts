import { quickPicksDaypart, nextDaypartAt, rankQuickPicks, shouldRefreshQuickPicks, type LiveQuickPicks } from './liveQuickPicks';
import type { UnifiedSong } from '../../types/song';
import type { ListenEntry } from '../../database/listenLogQueries';
const time = new Date(2026, 10, 12, 9).getTime();
const song = (id: string, artist = id): UnifiedSong => ({ id, artist, title: id, source: 'Saavn', highResArt: '', downloadUrl: `https://example.com/${id}` });
const entry: LiveQuickPicks = { scope: 'guest', saved: true, songs: [song('a')], revision: 1, generatedAt: time, daypart: 'morning', signal: 'one', source: 'history' };
test('New listening waits for the cooldown while manual refresh can run immediately', () => {
  expect(shouldRefreshQuickPicks(entry, time + 1000, 'two')).toBe(false);
  expect(shouldRefreshQuickPicks(entry, time + 16 * 60000, 'two')).toBe(true);
  expect(shouldRefreshQuickPicks(entry, time + 1000, 'one', true)).toBe(true);
  expect(shouldRefreshQuickPicks(entry, time + 16 * 60000, 'one')).toBe(false);
});
test('Dayparts cover every hour and the next refresh boundary uses local time', () => {
  expect(quickPicksDaypart(new Date(2026, 10, 12, 4).getTime())).toBe('night');
  expect(quickPicksDaypart(time)).toBe('morning');
  expect(quickPicksDaypart(new Date(2026, 10, 12, 12).getTime())).toBe('daytime');
  expect(quickPicksDaypart(new Date(2026, 10, 12, 19).getTime())).toBe('evening');
  expect(quickPicksDaypart(new Date(2026, 10, 12, 22).getTime())).toBe('night');
  expect(new Date(nextDaypartAt(time)).getHours()).toBe(12);
  expect(new Date(nextDaypartAt(new Date(2026, 10, 12, 23).getTime())).getDate()).toBe(13);
  expect(shouldRefreshQuickPicks(entry, new Date(2026, 10, 12, 12).getTime(), 'one')).toBe(true);
});
test('Sparse history preserves the source order, deduplicates recordings and leaves input untouched', () => {
  const input = [song('a'), song('a'), song('b')];
  expect(rankQuickPicks(input, [], time).map(s => s.id)).toEqual(['a', 'b']);
  expect(input).toHaveLength(3);
});
test('Only substantial repeated daypart listening earns a modest preference', () => {
  const input = [song('a'), song('b'), song('c'), song('d', 'favorite')];
  const listens: ListenEntry[] = Array.from({ length: 12 }, (_, i) => ({ songKey: 'f', songId: 'f', ref: null, title: 'f', artist: 'favorite', album: null, artwork: null, durationSec: 120, heardSec: 60, exit: 'ended', startedAt: time - (1 + i % 3) * 86400000 }));
  expect(rankQuickPicks(input, listens.slice(0, 9), time).map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(rankQuickPicks(input, listens.map(l => ({ ...l, heardSec: 2 })), time).map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(rankQuickPicks(input, listens, time).findIndex(s => s.id === 'd')).toBeLessThan(3);
});
