import * as fs from 'fs';
import * as path from 'path';

/**
 * The album Download button belongs to catalog lists only. These read the screens' source (the repo has no component
 * renderer), so they hold the wiring, not the pixels: the real tap-to-queue behaviour is in albumDownload.test.ts.
 */
const src = (...parts: string[]): string => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

describe('which pages get the album Download button', () => {
  it('shows it on a catalog album, which every album route opens (artist albums, search, Now Playing)', () => {
    expect(src('screens', 'CatalogAlbumScreen.tsx')).toMatch(/<DiscoveryCollection[\s\S]*catalogDownload/);
    expect(src('components', 'stream', 'DiscoveryCollection.tsx')).toMatch(/catalogDownload \? <CatalogDownloadButton/);
  });

  it('shows it on a Made for you mix of catalog songs only, never a mix of the phone\'s own songs', () => {
    expect(src('screens', 'MixScreen.tsx')).toMatch(/mix\.kind === 'stream' \? <CatalogDownloadButton/);
  });

  it('leaves Quick picks and the listener\'s playlists without it', () => {
    expect(src('screens', 'QuickPicksScreen.tsx')).not.toMatch(/catalogDownload|CatalogDownloadButton/);
    for (const screen of ['PlaylistDetailScreen.tsx', 'SharedPlaylistScreen.tsx', 'PlaylistsScreen.tsx']) {
      expect(src('screens', screen)).not.toMatch(/CatalogDownloadButton|catalogDownload/);
    }
  });

  it('keeps the per-song Download and the song menu', () => {
    const collection = src('components', 'stream', 'DiscoveryCollection.tsx');
    expect(collection).toMatch(/onActions=\{\(\) => actions\.open\(item\)\}/);
    expect(collection).toMatch(/\{actions\.element\}/);
  });
});
