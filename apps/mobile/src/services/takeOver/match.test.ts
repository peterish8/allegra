import type { UnifiedSong } from '../../types/song';
import { cleanOutside, leadArtist, pickTakeOver, takeOverQuery } from './match';

const song = (title: string, artist: string, duration?: number, id = title): UnifiedSong => ({
  id,
  title,
  artist,
  highResArt: '',
  downloadUrl: `https://cdn.example/${encodeURIComponent(id)}.mp3`,
  source: 'Saavn',
  duration,
});

describe('cleanOutside', () => {
  it('splits "Artist - Title (Official Video)" on a VEVO channel', () => {
    expect(cleanOutside({ title: 'The Weeknd - Blinding Lights (Official Video)', artist: 'TheWeekndVEVO' }))
      .toEqual({ title: 'Blinding Lights', artist: 'The Weeknd' });
  });

  it('splits a plain channel name that is not the artist, in YouTube', () => {
    expect(cleanOutside({ title: 'Arijit Singh - Tum Hi Ho | Official Video', artist: 'T-Series', packageName: 'com.google.android.youtube' }))
      .toEqual({ title: 'Tum Hi Ho', artist: 'Arijit Singh' });
  });

  it('keeps a Spotify title whose dash names a remix, and splits one that repeats the artist', () => {
    expect(cleanOutside({ title: 'Blinding Lights - Chromatics Remix', artist: 'The Weeknd', packageName: 'com.spotify.music' }))
      .toEqual({ title: 'Blinding Lights - Chromatics Remix', artist: 'The Weeknd' });
    expect(cleanOutside({ title: 'The Weeknd - Blinding Lights', artist: 'The Weeknd', packageName: 'com.spotify.music' }))
      .toEqual({ title: 'Blinding Lights', artist: 'The Weeknd' });
  });

  it('strips "- Topic" from the artist of a YouTube Music auto channel', () => {
    expect(cleanOutside({ title: 'Blinding Lights', artist: 'The Weeknd - Topic' }))
      .toEqual({ title: 'Blinding Lights', artist: 'The Weeknd' });
  });

  it('removes video, audio and quality tags in brackets', () => {
    expect(cleanOutside({ title: 'Shape of You [Official Lyric Video] (HD)', artist: 'Ed Sheeran' }).title).toBe('Shape of You');
    expect(cleanOutside({ title: 'Perfect (Official Audio) [4K]', artist: 'Ed Sheeran' }).title).toBe('Perfect');
    expect(cleanOutside({ title: 'Stay (Visualizer)', artist: 'The Kid LAROI' }).title).toBe('Stay');
  });

  it('drops a featured credit from the title', () => {
    expect(cleanOutside({ title: 'Levitating (feat. DaBaby)', artist: 'Dua Lipa' }).title).toBe('Levitating');
    expect(cleanOutside({ title: 'Peaches [ft. Daniel Caesar & Giveon]', artist: 'Justin Bieber' }).title).toBe('Peaches');
  });

  it('keeps Remix, Live, Acoustic and Remastered', () => {
    expect(cleanOutside({ title: 'Tití Me Preguntó (Remix)', artist: 'Bad Bunny' }).title).toBe('Tití Me Preguntó (Remix)');
    expect(cleanOutside({ title: 'Creep (Live)', artist: 'Radiohead' }).title).toBe('Creep (Live)');
    expect(cleanOutside({ title: 'Fix You (Acoustic)', artist: 'Coldplay' }).title).toBe('Fix You (Acoustic)');
    expect(cleanOutside({ title: 'Hey Jude - Remastered 2015', artist: 'The Beatles' }))
      .toEqual({ title: 'Hey Jude - Remastered 2015', artist: 'The Beatles' });
  });

  it('does not split a Spotify title whose dash is a suffix', () => {
    expect(cleanOutside({ title: 'Heroes - 2017 Remaster', artist: 'David Bowie' }))
      .toEqual({ title: 'Heroes - 2017 Remaster', artist: 'David Bowie' });
    expect(cleanOutside({ title: 'Yesterday - Live', artist: 'Paul McCartney' }).artist).toBe('Paul McCartney');
  });
});

describe('takeOverQuery', () => {
  it('asks for the title and the lead artist only', () => {
    expect(takeOverQuery({ title: 'Closer', artist: 'The Chainsmokers, Halsey' })).toBe('Closer The Chainsmokers');
  });

  it('leaves a remaster tag out of the search', () => {
    expect(takeOverQuery({ title: 'Hey Jude - Remastered 2015', artist: 'The Beatles' })).toBe('Hey Jude The Beatles');
  });
});

describe('leadArtist', () => {
  it('takes the first of several artists', () => {
    expect(leadArtist('Marshmello & Anne-Marie')).toBe('Marshmello');
    expect(leadArtist('Calvin Harris feat. Rihanna')).toBe('Calvin Harris');
  });
});

describe('pickTakeOver', () => {
  const blinding = { title: 'Blinding Lights', artist: 'The Weeknd' };

  it('picks the result with the same title, lead artist and length', () => {
    const results = [
      song('Blinding Lights', 'Some Other Band', 200, 'other'),
      song('Blinding Lights', 'The Weeknd', 200, 'right'),
    ];
    expect(pickTakeOver(blinding, 201, results)?.id).toBe('right');
  });

  it('accepts a title with a video tag and a credit that lists more artists', () => {
    const result = song('Blinding Lights (Official Audio)', 'The Weeknd, Max Martin', 200);
    expect(pickTakeOver(blinding, 200, [result])).toBe(result);
  });

  it('rejects a result whose length is more than 4 seconds off', () => {
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights', 'The Weeknd', 185)])).toBeNull();
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights', 'The Weeknd', 204)])).not.toBeNull();
  });

  it('ignores length when either side does not know it', () => {
    expect(pickTakeOver(blinding, 0, [song('Blinding Lights', 'The Weeknd', 185)])).not.toBeNull();
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights', 'The Weeknd')])).not.toBeNull();
  });

  it('rejects covers, lofi and slowed versions the title did not ask for', () => {
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights (Lofi Remix)', 'The Weeknd', 200)])).toBeNull();
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights (Slowed + Reverb)', 'The Weeknd', 200)])).toBeNull();
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights (Cover)', 'The Weeknd', 200)])).toBeNull();
  });

  it('keeps a Remix or Live version when the other app played one', () => {
    const remix = song('Blinding Lights (Remix)', 'The Weeknd', 200);
    expect(pickTakeOver({ title: 'Blinding Lights (Remix)', artist: 'The Weeknd' }, 200, [remix])).toBe(remix);
    expect(pickTakeOver(blinding, 200, [remix])).toBeNull();
  });

  it('matches a remastered title to the plain one', () => {
    const plain = song('Hey Jude', 'The Beatles', 431);
    expect(pickTakeOver({ title: 'Hey Jude - Remastered 2015', artist: 'The Beatles' }, 431, [plain])).toBe(plain);
  });

  it('rejects another artist and another title', () => {
    expect(pickTakeOver(blinding, 200, [song('Blinding Lights', 'Chill Covers Band', 200)])).toBeNull();
    expect(pickTakeOver(blinding, 200, [song('Save Your Tears', 'The Weeknd', 200)])).toBeNull();
  });

  it('rejects everything when the other app named no artist', () => {
    expect(pickTakeOver({ title: 'Blinding Lights', artist: '' }, 200, [song('Blinding Lights', 'The Weeknd', 200)])).toBeNull();
  });

  it('skips a result with no audio link', () => {
    const silent = { ...song('Blinding Lights', 'The Weeknd', 200), downloadUrl: '' };
    expect(pickTakeOver(blinding, 200, [silent])).toBeNull();
  });

  it('works end to end on a YouTube video title', () => {
    const cleaned = cleanOutside({ title: 'Dua Lipa - Levitating (Official Music Video)', artist: 'Dua Lipa' });
    expect(takeOverQuery(cleaned)).toBe('Levitating Dua Lipa');
    const match = song('Levitating (feat. DaBaby)', 'Dua Lipa, DaBaby', 203);
    expect(pickTakeOver(cleaned, 203, [song('Levitating (Cover)', 'Dua Lipa', 203), match])).toBe(match);
  });
});
