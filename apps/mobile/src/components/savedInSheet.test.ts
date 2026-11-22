/**
 * "Saved in" and the sheet gesture: guards for the three defects the PR #155 review found, each of which reads fine
 * and only fails on a retry, a double tap or a tap mid-animation.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('"Saved in" Done is idempotent', () => {
  const service = read('services', 'savedIn.ts');
  const sheet = read('components', 'SavedInSheet.tsx');

  it('sets Liked to the chosen state instead of toggling from a stale diff', () => {
    // A retry after a partial failure (or a second Done) must never un-like the song the first one liked.
    expect(service).toMatch(/if \(liked !== null && likedNow\(target\) !== after\.has\(liked\)\)/);
    expect(service).not.toMatch(/likeChange/);
  });

  it('runs one Done at a time and re-bases the diff on what landed', () => {
    expect(sheet).toMatch(/if \(inFlight\.current\) return;/);
    expect(sheet).toMatch(/setBefore\(await loadSavedIn\(song\)/);
  });

  it('never treats a failed read as "saved nowhere"', () => {
    expect(sheet).toMatch(/\(\) => \{ if \(current\) setLoadFailed\(true\); \}/);
    expect(sheet).not.toMatch(/setBefore\(new Set\(\)\)/);
    expect(sheet).toMatch(/data=\{loading \|\| loadFailed \? \[\] : others\}/);
  });

  it('offers Download for a streamed song through the one shared download control', () => {
    // Only a stream (a song on the phone is already downloaded); the queue knows it by its provider id.
    expect(sheet).toMatch(/\{isStreamSongId\(song\.id\) \? <DownloadRow song=\{song\} \/> : null\}/);
    expect(sheet).toMatch(/id: parseStreamId\(song\.id\)\?\.providerId \?\? song\.id/);
    expect(sheet).toMatch(/trailing=\{<DownloadButton song=\{target\} onSave=\{start\} \/>\}/);
    expect(sheet).toMatch(/StreamService\.save\(song\.id\)/);
  });

  it('removes an online song by the same ref it was added with', () => {
    expect(service).toMatch(/removeOnlineFromPlaylist\(id, toMobileId\(target\.snapshot\.ref\)\)/);
  });
});

describe('Sheet gesture', () => {
  const sheet = read('ui', 'Sheet.tsx');

  it('only settles a drag that started: a tap never re-aims or closes a sheet mid-spring', () => {
    expect(sheet).toMatch(/if \(!success && dragging\.value\) \{/);
    expect(sheet).not.toMatch(/Math\.abs\(pos\.value - dragStart\.value\) > 0\.5\) settle\(0\)/);
  });

  it('keeps the hidden top bar out of TalkBack until the sheet is full', () => {
    expect(sheet).toMatch(/importantForAccessibility=\{atFull \? 'auto' : 'no-hide-descendants'\}/);
    expect(sheet).toMatch(/onAccessibilityAction=\{expand\}/);
  });
});
