import * as fs from 'fs';
import * as path from 'path';

// Owner report, 2026-11-06 (Round 7 item 5): inside Library the Playlists tab drew its own opaque page and a second
// cover glow, so the Library background was cut off abruptly at the top of the playlists box.
const source = fs.readFileSync(path.join(__dirname, 'PlaylistsScreen.tsx'), 'utf8');

describe('Playlists embedded in Library', () => {
  it('renders a transparent frame instead of its own screen when embedded', () => {
    expect(source).toMatch(/const Frame = embedded \? View : AppScreen;/);
    expect(source).toMatch(/<Frame style=\{embedded \? styles\.embedded : styles\.container\}>/);
    expect(source).toMatch(/embedded: \{ flex: 1, backgroundColor: 'transparent' \}/);
  });

  it('keeps the standalone page on its own opaque screen', () => {
    expect(source).toMatch(/container: \{ flex: 1, backgroundColor: Signal\.bgDeep \}/);
    expect(source).not.toMatch(/<AppScreen style=\{styles\.container\}>/);
  });
});
