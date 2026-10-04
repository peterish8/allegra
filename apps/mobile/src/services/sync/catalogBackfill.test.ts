// The job takes its database, network and store through `deps`; these modules are never reached.
jest.mock('../../database/syncQueries', () => ({}));
jest.mock('../account/allegraApi', () => ({}));
jest.mock('../../store/songsStore', () => ({}));
jest.mock('./LibrarySync', () => ({}));

import type { SongRef } from '@shared/songRef';
import type { CatalogGap } from '../../database/syncQueries';
import { backfillCatalogLinks, type CatalogBackfillDeps } from './catalogBackfill';

function deps(gaps: CatalogGap[], overrides: Partial<CatalogBackfillDeps> = {}) {
  const calls = {
    coversFor: [] as (readonly SongRef[])[],
    search: [] as string[],
    origins: [] as [string, SongRef][],
    covers: [] as [string, string][],
    checked: [] as [string, number][],
    waits: 0,
    refreshes: 0,
  };
  const value: CatalogBackfillDeps = {
    gaps: async () => gaps,
    coversFor: async refs => { calls.coversFor.push(refs); return new Map(); },
    search: async title => { calls.search.push(title); return null; },
    setOrigin: async (songId, ref) => { calls.origins.push([songId, ref]); },
    setCover: async (songId, url) => { calls.covers.push([songId, url]); },
    markChecked: async (songId, at) => { calls.checked.push([songId, at]); },
    refresh: async () => { calls.refreshes++; },
    now: () => 1_000_000,
    wait: async () => { calls.waits++; },
    ...overrides,
  };
  return { value, calls };
}

describe('older downloads learning their catalog song and cover', () => {
  it('songs that know their catalog song get their covers in one request', async () => {
    const { value, calls } = deps([
      { id: 'b', title: 'B', originId: 'saavn:b1', coverImageUri: 'file:///b.jpg' },
      { id: 'c', title: 'C', originId: 'saavn:c1' },
    ], {
      coversFor: async refs => {
        calls.coversFor.push(refs);
        return new Map<SongRef, string>([['saavn:b1', 'https://c.saavncdn.com/b.jpg'], ['saavn:c1', 'http://c.saavncdn.com/c.jpg']]);
      },
    });

    const result = await backfillCatalogLinks(value);

    expect(calls.coversFor).toEqual([['saavn:b1', 'saavn:c1']]);
    expect(calls.covers).toEqual([['b', 'https://c.saavncdn.com/b.jpg'], ['c', 'https://c.saavncdn.com/c.jpg']]);
    expect(calls.checked).toEqual([['b', 1_000_000], ['c', 1_000_000]]);
    expect(calls.search).toEqual([]);
    expect(calls.refreshes).toBe(1);
    expect(result).toEqual({ checked: 2, linked: 2 });
  });

  it('songs that do not are searched one at a time, a moment apart, and learn both', async () => {
    const { value, calls } = deps([
      { id: 'a', title: 'Found', artist: 'Nila' },
      { id: 'd', title: 'Missing' },
    ], {
      search: async title => {
        calls.search.push(title);
        return title === 'Found' ? { ref: 'saavn:a1' as SongRef, artwork: 'https://c.saavncdn.com/a.jpg' } : null;
      },
    });

    const result = await backfillCatalogLinks(value);

    expect(calls.search).toEqual(['Found', 'Missing']);
    expect(calls.waits).toBe(1);
    expect(calls.origins).toEqual([['a', 'saavn:a1']]);
    expect(calls.covers).toEqual([['a', 'https://c.saavncdn.com/a.jpg']]);
    // A miss is remembered too: not asked about again for a week.
    expect(calls.checked.map(([id]) => id)).toEqual(['a', 'd']);
    expect(result).toEqual({ checked: 2, linked: 1 });
  });

  it('a song with a web cover of its own keeps it, and only learns its catalog song', async () => {
    const { value, calls } = deps([{ id: 'e', title: 'Own cover', coverImageUri: 'https://lh3.googleusercontent.com/e' }], {
      search: async () => ({ ref: 'gaana:e1' as SongRef, artwork: 'https://a10.gaanacdn.com/e.jpg' }),
    });

    await backfillCatalogLinks(value);

    expect(calls.origins).toEqual([['e', 'gaana:e1']]);
    expect(calls.covers).toEqual([]);
  });

  it('out of reach, nothing is marked as checked, so it is asked again next time', async () => {
    const { value, calls } = deps([{ id: 'b', title: 'B', originId: 'saavn:b1' }, { id: 'a', title: 'A' }], {
      coversFor: async () => null,
    });

    const result = await backfillCatalogLinks(value);

    expect(calls.checked).toEqual([]);
    expect(calls.search).toEqual([]);
    expect(result).toEqual({ checked: 0, linked: 0 });
  });

  it('with nothing learnt, the library is not reloaded', async () => {
    const { value, calls } = deps([{ id: 'd', title: 'Missing' }]);
    await backfillCatalogLinks(value);
    expect(calls.refreshes).toBe(0);
  });
});
