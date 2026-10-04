import { groupArtists, leadArtist, letterIndex, letterOf, railPick } from './libraryShape';
import type { Song } from '../../types/song';

const song = (id: string, title: string, artist: string, day: number, cover?: string): Song => ({
  id,
  title,
  artist,
  gradientId: 'dynamic',
  duration: 200,
  dateCreated: new Date(2026, 0, day).toISOString(),
  dateModified: new Date(2026, 0, day).toISOString(),
  playCount: 0,
  lyrics: [],
  coverImageUri: cover,
});

describe('leadArtist', () => {
  it('keeps the first credited artist', () => {
    expect(leadArtist('Anirudh Ravichander, Super Subu')).toBe('Anirudh Ravichander');
    expect(leadArtist('Dua Lipa feat. DaBaby')).toBe('Dua Lipa');
    expect(leadArtist('Unknown Artist')).toBe('');
  });
});

describe('groupArtists', () => {
  it('orders artists by how many songs are saved and picks the newest cover', () => {
    const songs = [
      song('1', 'Hukum', 'Anirudh Ravichander, Super Subu', 1, 'old.jpg'),
      song('2', 'Kaavaalaa', 'Anirudh Ravichander', 5, 'new.jpg'),
      song('3', 'Levitating', 'Dua Lipa', 9),
    ];
    const groups = groupArtists(songs);
    expect(groups.map(g => [g.name, g.count])).toEqual([['Anirudh Ravichander', 2], ['Dua Lipa', 1]]);
    expect(groups[0].cover).toBe('new.jpg');
  });
});

describe('letters', () => {
  it('files titles under their first letter, ignoring "The"', () => {
    expect(letterOf('The Weeknd')).toBe('W');
    expect(letterOf('7 rings')).toBe('#');
    expect(letterOf('abc')).toBe('A');
  });

  it('finds the first row of each letter in list order', () => {
    const list = ['Apple', 'Avocado', 'Banana', 'Cherry', 'Citrus'];
    expect(letterIndex(list, x => x)).toEqual([
      { letter: 'A', index: 0 },
      { letter: 'B', index: 2 },
      { letter: 'C', index: 3 },
    ]);
  });

  it('maps a touch on the rail to an entry, clamped at both ends', () => {
    expect(railPick(0, 260, 26)).toBe(0);
    expect(railPick(259, 260, 26)).toBe(25);
    expect(railPick(-40, 260, 26)).toBe(0);
    expect(railPick(900, 260, 26)).toBe(25);
  });
});

describe('the deck', () => {
  const { pickDeck, keepDeckOrder } = jest.requireActual('./libraryShape');
  const deckSong = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, dateCreated: '2026-01-01T00:00:00Z', ...extra });

  it('picks what was played last, then what arrived last, each once', () => {
    const songs = [
      deckSong('a', { dateCreated: '2026-01-03T00:00:00Z' }),
      deckSong('b', { lastPlayed: '2026-02-01T00:00:00Z' }),
      deckSong('c', { dateCreated: '2026-01-05T00:00:00Z', lastPlayed: '2026-02-02T00:00:00Z' }),
      deckSong('d', { dateCreated: '2026-01-04T00:00:00Z' }),
    ];
    expect(pickDeck(songs, 10).map((s: { id: string }) => s.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(pickDeck(songs, 2).map((s: { id: string }) => s.id)).toEqual(['c', 'b']);
  });

  it('keeps a played song where it was instead of jumping it to the front', () => {
    // The deck was a b c d; playing c stamps it, so the fresh picks put it first.
    const fresh = [deckSong('c', { lastPlayed: 'now' }), deckSong('a'), deckSong('b'), deckSong('d')];
    expect(keepDeckOrder(['a', 'b', 'c', 'd'], fresh).map((s: { id: string }) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    // The fresh object is the one kept (its new details show).
    expect(keepDeckOrder(['a', 'b', 'c', 'd'], fresh)[2].lastPlayed).toBe('now');
  });

  it('adds newcomers after the songs it kept, and drops songs that left', () => {
    const fresh = [deckSong('e'), deckSong('a'), deckSong('c')];
    expect(keepDeckOrder(['a', 'b', 'c'], fresh).map((s: { id: string }) => s.id)).toEqual(['a', 'c', 'e']);
  });

  it('starts from the fresh order when there is no deck yet', () => {
    expect(keepDeckOrder([], [deckSong('x'), deckSong('y')]).map((s: { id: string }) => s.id)).toEqual(['x', 'y']);
  });
});
