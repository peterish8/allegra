import { buildQueueRows, queueClock, queueRowsJson } from './nativeQueuePayload';
import { duotoneFor, hashString } from '../allegra/artworkSeed';

const song = (id: string, over: Partial<{ title: string; artist: string; duration: number; coverImageUri: string }> = {}) => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  duration: 210,
  coverImageUri: 'https://x/y.jpg',
  ...over,
});

describe('queueClock', () => {
  it('formats minutes and seconds, and nothing for no duration', () => {
    expect(queueClock(210)).toBe('3:30');
    expect(queueClock(65)).toBe('1:05');
    expect(queueClock(0)).toBe('');
    expect(queueClock(undefined)).toBe('');
    expect(queueClock(NaN)).toBe('');
  });
});

describe('buildQueueRows', () => {
  it('keeps each row\'s place in the whole queue when the list is filtered', () => {
    const rows = buildQueueRows([song('a'), song('b'), song('c')], [0, 2]);
    expect(rows.map(r => r.i)).toEqual([0, 2]);
    expect(rows.map(r => r.id)).toEqual(['a', 'c']);
  });

  it('writes the subtitle the React Native row writes', () => {
    const [row] = buildQueueRows([song('a')], [0]);
    expect(row.sub).toBe('Artist · 3:30');
    const [bare] = buildQueueRows([song('b', { artist: '', duration: 0 })], [0]);
    expect(bare.sub).toBe('Unknown artist');
  });

  it('seeds the generated cover the way Artwork does, so a cover that never loads looks the same', () => {
    const [row] = buildQueueRows([song('a', { title: 'The Night', artist: 'Moon', coverImageUri: undefined })], [0]);
    const seed = 'The Night|Moon';
    const [base, mid, spark] = duotoneFor(seed);
    expect(row.cover).toBeNull();
    expect([row.base, row.mid, row.spark]).toEqual([base, mid, spark]);
    expect(row.variant).toBe(hashString(`${seed}#v`) % 3);
    expect(row.glyph).toBe('N');
  });

  it('skips an index that is not in the queue', () => {
    expect(buildQueueRows([song('a')], [0, 4])).toHaveLength(1);
  });

  it('serialises to JSON the native parser reads', () => {
    const parsed = JSON.parse(queueRowsJson([song('a')], [0]));
    expect(parsed[0]).toMatchObject({ i: 0, id: 'a', title: 'Song a', cover: 'https://x/y.jpg' });
  });
});
