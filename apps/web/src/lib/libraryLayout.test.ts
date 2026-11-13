import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAYLIST_LAYOUT_KEY, parsePlaylistLayout, readPlaylistLayout, writePlaylistLayout } from './libraryLayout.ts';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { readonly data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; }
  };
}

test('the playlist layout defaults to the grid and only accepts "list" as the other choice', () => {
  assert.equal(readPlaylistLayout(memoryStorage()), 'grid');
  assert.equal(readPlaylistLayout(memoryStorage({ [PLAYLIST_LAYOUT_KEY]: 'list' })), 'list');
  assert.equal(readPlaylistLayout(memoryStorage({ [PLAYLIST_LAYOUT_KEY]: 'carousel' })), 'grid');
  assert.equal(parsePlaylistLayout(null), 'grid');
});

test('a chosen layout survives a reload', () => {
  const storage = memoryStorage();
  writePlaylistLayout('list', storage);
  assert.equal(readPlaylistLayout(storage), 'list');
  writePlaylistLayout('grid', storage);
  assert.equal(readPlaylistLayout(storage), 'grid');
});

test('blocked storage is only a missing preference', () => {
  const blocked = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); }
  };
  assert.equal(readPlaylistLayout(blocked), 'grid');
  assert.doesNotThrow(() => writePlaylistLayout('list', blocked));
  assert.equal(readPlaylistLayout(null), 'grid');
});
