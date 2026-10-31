import { createListenTracker, type HeardSong } from './listenTracker';

const song = (id: string): HeardSong => ({ id, title: id, artist: 'Artist' });
const observe = (tracker: ReturnType<typeof createListenTracker>, id: string | null, positionSec: number, isPlaying: boolean, at: number) =>
  tracker.observe({ song: id ? song(id) : null, positionSec, isPlaying, at });

describe('createListenTracker', () => {
  it('reports heard progress once when a track is paused', () => {
    const heard: Array<[string, number]> = [];
    const tracker = createListenTracker((track, seconds) => heard.push([track.id, seconds]));

    observe(tracker, 'stream:saavn:a', 0, true, 0);
    observe(tracker, 'stream:saavn:a', 1, true, 1_000);
    observe(tracker, 'stream:saavn:a', 3, true, 3_000);
    observe(tracker, 'stream:saavn:a', 5, true, 5_000);
    observe(tracker, 'stream:saavn:a', 7, true, 7_000);
    observe(tracker, 'stream:saavn:a', 7, false, 7_100);
    observe(tracker, 'stream:saavn:a', 7, false, 7_200);

    expect(heard).toHaveLength(1);
    expect(heard[0][0]).toBe('stream:saavn:a');
    expect(heard[0][1]).toBeCloseTo(7);
  });

  it('adds a track to shared history at five heard seconds and keeps the same event time for taste', () => {
    const recent: Array<[string, string]> = [];
    const heard: Array<[string, number, string]> = [];
    const tracker = createListenTracker(
      (track, seconds, startedAt) => heard.push([track.id, seconds, startedAt]),
      (track, startedAt) => recent.push([track.id, startedAt]),
    );

    observe(tracker, 'stream:saavn:a', 0, true, 0);
    observe(tracker, 'stream:saavn:a', 1, true, 1_000);
    observe(tracker, 'stream:saavn:a', 3, true, 3_000);
    observe(tracker, 'stream:saavn:a', 5, true, 5_000);
    observe(tracker, 'stream:saavn:a', 7, true, 7_000);
    observe(tracker, 'stream:saavn:a', 7, false, 7_100);

    expect(recent).toEqual([['stream:saavn:a', new Date(0).toISOString()]]);
    expect(heard).toEqual([['stream:saavn:a', 7, new Date(0).toISOString()]]);
  });

  it('does not count seeks, backward jumps, or long status gaps as listening', () => {
    const heard: number[] = [];
    const tracker = createListenTracker((_track, seconds) => heard.push(seconds));
    observe(tracker, 'a', 0, true, 0);
    observe(tracker, 'a', 1, true, 1_000);
    observe(tracker, 'a', 60, true, 2_000); // seek
    observe(tracker, 'a', 59, true, 3_000); // backward seek
    observe(tracker, 'a', 60, true, 10_000); // status was suspended
    observe(tracker, 'a', 66, true, 16_000); // long gap also re-baselines
    observe(tracker, 'a', 66, false, 16_100);
    expect(heard).toEqual([]);
  });

  it('flushes the previous song once when the player changes tracks', () => {
    const heard: Array<[string, number]> = [];
    const tracker = createListenTracker((track, seconds) => heard.push([track.id, seconds]));
    observe(tracker, 'first', 0, true, 0);
    observe(tracker, 'first', 1, true, 1_000);
    observe(tracker, 'first', 3, true, 3_000);
    observe(tracker, 'first', 5, true, 5_000);
    observe(tracker, 'first', 7, true, 7_000);
    observe(tracker, 'second', 0, true, 7_100);
    observe(tracker, 'second', 1, true, 8_100);
    observe(tracker, null, 0, false, 8_200);
    expect(heard).toEqual([['first', 7]]);
  });

  it('ignores sessions shorter than five seconds', () => {
    const heard: number[] = [];
    const tracker = createListenTracker((_track, seconds) => heard.push(seconds));
    observe(tracker, 'short', 0, true, 0);
    observe(tracker, 'short', 4.5, true, 4_500);
    observe(tracker, 'short', 4.5, false, 4_600);
    expect(heard).toEqual([]);
  });

  it('says how each song ended, and reports even a two-second skip to onLeft', () => {
    const left: Array<[string, string, number]> = [];
    const heard: string[] = [];
    const tracker = createListenTracker(
      (_track, _seconds, _startedAt, ending) => heard.push(ending.exit),
      undefined,
      (track, ending) => left.push([track.id, ending.exit, Math.round(ending.exitPositionSec)]),
    );
    const at = (id: string, positionSec: number, ms: number) => tracker.observe({ song: { id, title: id, artist: 'A', duration: 20 }, positionSec, isPlaying: true, at: ms });
    at('quick', 0, 0);
    at('quick', 2, 2_000);
    for (let t = 0; t <= 19; t += 1) at('whole', t, 3_000 + t * 1_000);
    at('next', 0, 23_000);
    expect(left).toEqual([['quick', 'skipped', 2], ['whole', 'ended', 19]]);
    expect(heard).toEqual(['ended']);
  });
});
