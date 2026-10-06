import { creditsArtist, deepenLane, freshSongs, laneSpecs, loadLane, MAX_ARTIST_LANES, needsDeepening, warmAround } from './luvsLanes';
import type { UnifiedSong } from '../types/song';

const s = (id: string, title: string, artist: string, url = `https://cdn/${id}`): UnifiedSong => ({
  id, title, artist, highResArt: '', downloadUrl: url, source: 'Saavn',
});

describe('laneSpecs', () => {
  it('puts For you first, one lane per artist, then the moods', () => {
    const lanes = laneSpecs([s('1', 'Hukum', 'Anirudh Ravichander, Subu'), s('2', 'Kaavaalaa', 'Anirudh Ravichander'), s('3', 'Levitating', 'Dua Lipa')]);
    expect(lanes.map(l => l.title)).toEqual(['For you', 'Anirudh Ravichander', 'Dua Lipa', 'Chill', 'Energy']);
    expect(lanes[1].subtitle).toBe('More like Anirudh Ravichander');
  });

  it('brings other favourites into the lanes each time it is rotated', () => {
    const seeds = Array.from({ length: 10 }, (_, i) => s(`${i}`, `T${i}`, `Artist ${i}`));
    const artistsOf = (rotate: number) => laneSpecs(seeds, rotate).filter(l => l.kind === 'artist').map(l => l.title);
    expect(artistsOf(0)).toEqual(['Artist 0', 'Artist 1', 'Artist 2', 'Artist 3']);
    expect(artistsOf(MAX_ARTIST_LANES)).toEqual(['Artist 4', 'Artist 5', 'Artist 6', 'Artist 7']);
    // Wraps round to the top, and a negative or huge step still lands on someone.
    expect(artistsOf(MAX_ARTIST_LANES * 2)).toEqual(['Artist 8', 'Artist 9', 'Artist 0', 'Artist 1']);
    expect(artistsOf(-1)[0]).toBe('Artist 9');
    expect(artistsOf(10_000)).toHaveLength(MAX_ARTIST_LANES);
  });

  it('only reorders when there are few favourites, and copes with none', () => {
    const two = [s('1', 'A', 'Dua Lipa'), s('2', 'B', 'Arijit Singh')];
    expect(laneSpecs(two, 1).filter(l => l.kind === 'artist').map(l => l.title)).toEqual(['Arijit Singh', 'Dua Lipa']);
    expect(laneSpecs([], 3).map(l => l.title)).toEqual(['For you', 'Chill', 'Energy']);
  });

  it('caps the artist lanes', () => {
    const seeds = Array.from({ length: 9 }, (_, i) => s(`${i}`, `T${i}`, `Artist ${i}`));
    expect(laneSpecs(seeds).filter(l => l.kind === 'artist')).toHaveLength(MAX_ARTIST_LANES);
  });
});

describe('freshSongs', () => {
  it('drops songs already in the lane, by id or by title and artist, and unplayable ones', () => {
    const lane = [s('a', 'Hukum', 'Anirudh')];
    const incoming = [s('a', 'X', 'Y'), s('b', 'hukum ', 'anirudh'), s('c', 'New', 'Z', ''), s('d', 'Fresh', 'Z')];
    expect(freshSongs(lane, incoming).map(x => x.id)).toEqual(['d']);
  });
});

describe('deepening', () => {
  it('grows a lane three songs before its end', () => {
    expect(needsDeepening(6, 10, false)).toBe(false);
    expect(needsDeepening(7, 10, false)).toBe(true);
    expect(needsDeepening(7, 10, true)).toBe(false);
  });

  it('follows the radio of the song the listener is on', async () => {
    const recommend = jest.fn(async () => [s('x', 'Next', 'A'), s('a', 'Dup', 'A')]);
    const songs = [s('a', 'One', 'A'), s('b', 'Two', 'A')];
    const more = await deepenLane({ id: 'mood:chill', kind: 'mood', title: 'Chill', subtitle: '' }, songs, 1, { recommend, artistSongs: jest.fn(), moodMix: jest.fn() });
    expect(recommend).toHaveBeenCalledWith(songs[1], 12);
    expect(more.map(x => x.id)).toEqual(['x']);
  });

  it('loads an artist lane with only that artist, without the seed', async () => {
    const seed = s('seed', 'Hukum', 'Anirudh');
    const recommend = jest.fn(async () => [s('seed', 'Hukum', 'Anirudh'), s('n', 'Kaavaalaa', 'Anirudh Ravichander, Shilpa Rao'), s('o', 'Other', 'Sid Sriram')]);
    const artistSongs = jest.fn(async () => [s('t', 'Vaathi Coming', 'Anirudh Ravichander'), s('u', 'Cover', 'Someone Else')]);
    const songs = await loadLane({ id: 'artist:anirudh', kind: 'artist', title: 'Anirudh', subtitle: '', seed }, { recommend, artistSongs, moodMix: jest.fn() });
    expect(songs.map(x => x.id)).toEqual(['t', 'n']);
  });

  it('keeps an artist lane on that artist as it grows, asking a new search each round', async () => {
    const spec = { id: 'artist:anirudh', kind: 'artist' as const, title: 'Anirudh', subtitle: '' };
    const lane = Array.from({ length: 12 }, (_, i) => s(`l${i}`, `Song ${i}`, 'Anirudh'));
    const recommend = jest.fn(async () => [s('r1', 'Radio', 'Ilaiyaraaja'), s('r2', 'Radio 2', 'Anirudh')]);
    const artistSongs = jest.fn(async () => [s('a1', 'Own', 'Anirudh')]);
    const more = await deepenLane(spec, lane, 10, { recommend, artistSongs, moodMix: jest.fn() });
    expect(artistSongs).toHaveBeenCalledWith('Anirudh', 1, 14);
    expect(more.map(x => x.id)).toEqual(['a1', 'r2']);
  });
});

describe('creditsArtist', () => {
  it('matches any credited artist and a longer form of the name, never a different artist', () => {
    expect(creditsArtist('Anirudh Ravichander, Shilpa Rao', 'Anirudh')).toBe(true);
    expect(creditsArtist('Dhanush feat. Anirudh', 'Anirudh')).toBe(true);
    expect(creditsArtist('Arijit Singh', 'Arijit Singh')).toBe(true);
    expect(creditsArtist('Sid Sriram', 'Anirudh')).toBe(false);
    expect(creditsArtist('Anirudhan', 'Anirudh')).toBe(false);
    expect(creditsArtist('', 'Anirudh')).toBe(false);
  });
});

describe('warmAround', () => {
  it('keeps the next two, the previous one and the neighbouring lanes warm', () => {
    const lanes = [
      { songs: [s('l0a', 'a', 'x'), s('l0b', 'b', 'x')] },
      { songs: [s('l1a', 'a', 'y'), s('l1b', 'b', 'y'), s('l1c', 'c', 'y'), s('l1d', 'd', 'y')] },
      { songs: [s('l2a', 'a', 'z')] },
    ];
    expect(warmAround(lanes, 1, [1, 1, 0]).map(x => x.id)).toEqual(['l1c', 'l1d', 'l1a', 'l0b', 'l2a']);
  });
});
