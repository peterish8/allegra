import * as fs from 'fs';
import * as path from 'path';
import { filterPlaylists, PLAYLIST_MENU_ACTIONS, playlistsBody, readPlaylistsLayout } from './playlistsView';

describe('Playlists layout: grid or list', () => {
  it('reads a kept choice, and falls back to the grid for nothing or anything unknown', () => {
    expect(readPlaylistsLayout('list')).toBe('list');
    expect(readPlaylistsLayout('grid')).toBe('grid');
    expect(readPlaylistsLayout(null)).toBe('grid');
    expect(readPlaylistsLayout('table')).toBe('grid');
  });

  it('offers the toggle beside the count and draws list rows with the playlist mosaic', () => {
    const page = fs.readFileSync(path.join(__dirname, 'PlaylistsScreen.tsx'), 'utf8');
    expect(page).toMatch(/countOf\(playlists\.length, 'playlist'\)\}<\/Text>\{layoutButton\}/);
    expect(page).toMatch(/leading=\{<MosaicCover songs=\{playlistSongs\[item\.id\] \|\| \[\]\} size=\{ROW_ART\}/);
    expect(page).toMatch(/AsyncStorage\.setItem\(PLAYLISTS_LAYOUT_KEY, next\)/);
  });
});

const playlists = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Playlist ${i}` }));

describe('Playlists page: what it shows for any number of playlists', () => {
  it('shows placeholders only while the first playlists load, the empty state with none, the grid otherwise', () => {
    expect(playlistsBody(true, 0)).toBe('placeholder');
    expect(playlistsBody(false, 0)).toBe('empty');
    expect(playlistsBody(false, 3)).toBe('grid');
    expect(playlistsBody(true, 3)).toBe('grid');
    expect(playlistsBody(false, 54)).toBe('grid');
  });

  it('offers a new playlist and Spotify import, in that order, in plain sentence case', () => {
    expect(PLAYLIST_MENU_ACTIONS.map(action => action.id)).toEqual(['create', 'import']);
    expect(PLAYLIST_MENU_ACTIONS.map(action => action.label)).toEqual(['New playlist', 'Import from Spotify']);
  });

  it('filters by name without touching the actions, with zero, a few or fifty-plus playlists', () => {
    for (const count of [0, 3, 54]) {
      const all = playlists(count);
      expect(filterPlaylists(all, '')).toHaveLength(count);
      expect(filterPlaylists(all, '  ')).toHaveLength(count);
      expect(filterPlaylists(all, 'PLAYLIST 2').map(row => row.id)).toEqual(all.filter(row => row.name.includes('Playlist 2')).map(row => row.id));
      expect(filterPlaylists(all, 'zzz')).toEqual([]);
    }
  });
});

// Owner (2026-11-19): New playlist and Import from Spotify are menu actions, not a row of buttons on the page. They live in
// Library's ••• menu, and the Playlists page carries the same menu when it stands alone.
describe('Playlists actions live in the ••• menu', () => {
  const page = fs.readFileSync(path.join(__dirname, 'PlaylistsScreen.tsx'), 'utf8');
  const library = fs.readFileSync(path.join(__dirname, 'LibraryScreen.tsx'), 'utf8');

  it('draws no action row on the page', () => {
    expect(page).not.toMatch(/<ChipRow/);
  });

  it('never puts content that can change size in the list header', () => {
    expect(page).not.toMatch(/ListHeaderComponent/);
    expect(page).not.toMatch(/ListFooterComponent/);
  });

  it('offers both actions from Library\'s menu and the standalone page\'s menu', () => {
    for (const source of [page, library]) {
      expect(source).toMatch(/PLAYLIST_MENU_ACTIONS\.map/);
      expect(source).toMatch(/navigation\.navigate\('Import'\)/);
    }
    expect(library).toMatch(/navigation\.navigate\('CreatePlaylist'\)/);
    expect(page).toMatch(/navigation\.navigate\('CreatePlaylist'\)/);
  });
});
