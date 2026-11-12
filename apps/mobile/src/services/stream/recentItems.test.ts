import { playlistMeta, recentPlaylists, RECENT_COUNT } from './recentItems';

const list = (name: string, dateModified: string) => ({ name, dateModified, dateCreated: '2026-01-01T00:00:00Z' });

describe('recentPlaylists', () => {
  it('returns the six most recently changed, newest first', () => {
    const all = Array.from({ length: 9 }, (_, i) => list(`p${i}`, `2026-11-0${i + 1}T10:00:00Z`));
    const out = recentPlaylists(all);
    expect(out).toHaveLength(RECENT_COUNT);
    expect(out.map(p => p.name)).toEqual(['p8', 'p7', 'p6', 'p5', 'p4', 'p3']);
  });

  it('keeps stored order for equal times and falls back to the created date', () => {
    const out = recentPlaylists([
      list('a', '2026-11-05T00:00:00Z'),
      list('b', '2026-11-05T00:00:00Z'),
      { name: 'c', dateModified: 'bad', dateCreated: '2026-11-09T00:00:00Z' },
    ]);
    expect(out.map(p => p.name)).toEqual(['c', 'a', 'b']);
  });

  it('returns fewer when there are fewer, and none for none', () => {
    expect(recentPlaylists([list('only', '2026-11-05T00:00:00Z')])).toHaveLength(1);
    expect(recentPlaylists([])).toEqual([]);
  });
});

describe('playlistMeta', () => {
  it('words the count', () => {
    expect(playlistMeta(undefined)).toBe('Empty');
    expect(playlistMeta(0)).toBe('Empty');
    expect(playlistMeta(1)).toBe('1 song');
    expect(playlistMeta(12)).toBe('12 songs');
  });
});
