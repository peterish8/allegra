/**
 * Songs' tempo for Listening stats (1.45.0): kept once found, Deezer first, then measured on the phone.
 */
jest.mock('../../store/songsStore', () => ({ useSongsStore: { getState: () => ({ songs: [] }) } }));
jest.mock('../../database/listenLogQueries', () => ({ getTempos: jest.fn(), saveTempo: jest.fn() }));
jest.mock('../nativeModule', () => ({ getNativeModule: () => null }));

import { audioSourceFor, deezerQuery, MAX_PER_VISIT, tempoFor, usableBpm } from './tempo';
import type { TopSong } from './listeningStats';
import type { TempoRow } from '../../database/listenLogQueries';

const song = (key: string, extra: Partial<TopSong> = {}): TopSong => ({
  key, title: key, artist: 'Anirudh Ravichander, Arivu', artwork: null, ref: `saavn:${key}`, songId: `stream:saavn:${key}`,
  seconds: 100, plays: 1, firstAt: 0, lastAt: 0, ...extra,
});

describe('asking Deezer', () => {
  it('asks for the lead artist and the bare title', () => {
    expect(deezerQuery('Hukum (From "Jailer")', 'Anirudh Ravichander, Arivu')).toBe('artist:"Anirudh Ravichander" track:"Hukum"');
    expect(deezerQuery('Song - Remastered 2011', 'A & B')).toBe('artist:"A" track:"Song"');
  });

  it('believes only real numbers: Deezer says 0 when it does not know', () => {
    expect(usableBpm(170.84)).toBe(170.8);
    expect(usableBpm(0)).toBeNull();
    expect(usableBpm(400)).toBeNull();
    expect(usableBpm('120')).toBeNull();
  });
});

describe('where the phone reads the audio', () => {
  it('a download from its file, a stream through the Allegra API, anything else not at all', () => {
    expect(audioSourceFor(song('x', { songId: 'local-1' }), id => (id === 'local-1' ? 'file:///a.mp3' : undefined), 'https://api')).toBe('file:///a.mp3');
    expect(audioSourceFor(song('B4-hLCKJ'), () => undefined, 'https://api')).toBe('https://api/api/stream/B4-hLCKJ');
    expect(audioSourceFor(song('x', { ref: 'gaana:9' }), () => undefined, 'https://api')).toBeNull();
    expect(audioSourceFor(song('x', { ref: null }), () => undefined, 'https://api')).toBeNull();
  });
});

describe('finding tempos', () => {
  const NOW = 1_800_000_000_000;
  const make = (cached: Map<string, TempoRow>, deezer: (t: string) => number | null, measured: number | null = 128) => {
    const saved: [string, number | null, string][] = [];
    const deps = {
      deezer: jest.fn(async (t: string) => deezer(t)),
      measure: jest.fn(async () => measured),
      localAudio: () => undefined,
      cached: async () => cached,
      save: async (k: string, b: number | null, s: string) => { saved.push([k, b, s]); },
      now: () => NOW,
    };
    return { deps, saved };
  };

  it('uses what it already knows, then Deezer, then measures, and keeps every answer', async () => {
    const { deps, saved } = make(new Map([['known', { bpm: 100, checkedAt: NOW - 1000 }]]), t => (t === 'dz' ? 140 : null));
    const progress: number[] = [];
    const result = await tempoFor([song('known'), song('dz'), song('measured')], m => progress.push(m.size), deps);
    expect([...result]).toEqual([['known', 100], ['dz', 140], ['measured', 128]]);
    expect(saved).toEqual([['dz', 140, 'deezer'], ['measured', 128, 'measured']]);
    expect(deps.deezer).toHaveBeenCalledTimes(2);
    expect(deps.measure).toHaveBeenCalledWith('https://allegravibe.vercel.app/api/stream/measured');
    expect(progress).toEqual([1, 2, 3]);
  });

  it('does not ask again for a song with no tempo until two weeks have passed', async () => {
    const recent = make(new Map([['x', { bpm: null, checkedAt: NOW - 86_400_000 }]]), () => 120);
    expect((await tempoFor([song('x')], undefined, recent.deps)).get('x')).toBeNull();
    expect(recent.deps.deezer).not.toHaveBeenCalled();
    const old = make(new Map([['x', { bpm: null, checkedAt: NOW - 20 * 86_400_000 }]]), () => 120);
    expect((await tempoFor([song('x')], undefined, old.deps)).get('x')).toBe(120);
  });

  it('remembers a song nobody can measure, so it is not asked again tomorrow', async () => {
    const { deps, saved } = make(new Map(), () => null, null);
    await tempoFor([song('silent')], undefined, deps);
    expect(saved).toEqual([['silent', null, 'none']]);
  });

  it('looks up at most a dozen per visit and stops when the page goes away', async () => {
    const many = Array.from({ length: 30 }, (_, i) => song(`s${i}`));
    const { deps } = make(new Map(), () => 120);
    await tempoFor(many, undefined, deps);
    expect(deps.deezer).toHaveBeenCalledTimes(MAX_PER_VISIT);
    const gone = make(new Map(), () => 120);
    let live = true;
    await tempoFor(many, () => { live = false; }, gone.deps, () => live);
    expect(gone.deps.deezer).toHaveBeenCalledTimes(0);
  });
});
