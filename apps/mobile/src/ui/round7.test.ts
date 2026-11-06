/**
 * Round 7 (owner-approved 2026-11-06): the rules every list, the shell, chips, buttons and menus share. These read the
 * source, as the other design guards do, so a later change that quietly undoes one of them fails here.
 */
// Native animation curves do not load in the Node test runner.
jest.mock('react-native-reanimated', () => ({ Easing: { bezier: () => (t: number) => t } }));

import * as fs from 'fs';
import * as path from 'path';
import { Control, Radius } from '../constants/allegraTheme';
import { chipLeadingIcon, COMPACT_HEIGHT, identityMeta, songRowSubtitle } from './round7Rules';

const SRC = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');
const ANDROID = path.resolve(SRC, '../android/app/src/main/java/com/lyricflow/app/views');

describe('item 9 and the lists rule: one song row everywhere', () => {
  it('is 56 tall with a 44 cover and 6dp corners', () => {
    expect(Control.row).toBe(56);
    expect(Control.rowArtwork).toBe(44);
    expect(Radius.cover).toBe(6);
  });

  it('keeps the title and the artist to one line each, ending in an ellipsis', () => {
    for (const file of ['ui/SongRow.tsx', 'ui/ListRow.tsx']) {
      const source = read(file);
      expect(source).not.toMatch(/numberOfLines=\{2\}>\{title\}/);
      expect(source).toMatch(/numberOfLines=\{1\} ellipsizeMode="tail">\{title\}/);
    }
  });

  it('puts the artist and the caller note on the second line, never empty parts', () => {
    expect(songRowSubtitle('Mira Vale', undefined, false)).toBe('Mira Vale');
    expect(songRowSubtitle('Mira Vale', 'Album', true)).toBe('Mira Vale · Album · Playing');
    expect(songRowSubtitle(undefined, undefined, false)).toBe('');
  });

  it('artist and album pages use the shared row', () => {
    expect(read('components/browse/BrowseShelf.tsx')).toMatch(/<SharedSongRow /);
  });

  it('Up next draws the same row geometry natively', () => {
    const queue = fs.readFileSync(path.join(ANDROID, 'NativeQueueListView.kt'), 'utf8');
    expect(queue).toMatch(/const val ROW_DP = 56f/);
    expect(queue).toMatch(/const val ART_DP = 44f/);
    expect(queue).toMatch(/const val ART_RADIUS_DP = 6f/);
  });
});

describe('item 9: Download is back beside the ⋮ on Stream and Search', () => {
  it('passes a save action to every catalog row on Stream and Search', () => {
    const stream = read('screens/StreamScreen.tsx');
    expect(stream).toMatch(/onSave=\{i => save\(quick\[i\]\)\}/);
    expect(stream).toMatch(/onSave=\{\(\) => save\(item\.song\)\}/);
    expect(read('screens/SearchScreen.tsx')).toMatch(/onSave=\{\(\) => save\(s\)\}/);
    expect(read('components/stream/StreamHome.tsx')).toMatch(/<DownloadButton song=\{item\.download\} onSave=\{onSave\} \/>/);
  });

  it('gives Download its own 48dp target with no slop over the row', () => {
    const button = read('components/stream/DownloadButton.tsx');
    expect(button).toMatch(/hit: \{ width: Control\.target, minHeight: Control\.row/);
    expect(button).not.toMatch(/hitSlop=\{8\}/);
  });
});

describe('items 3 and 8: the bottom surface and navigation', () => {
  it('draws nothing behind the selected tab, natively or in the fallback', () => {
    const bar = fs.readFileSync(path.join(ANDROID, 'NativeTabBarView.kt'), 'utf8');
    const v6 = bar.slice(bar.indexOf('private fun drawV6'), bar.indexOf('private fun barTop'));
    expect(v6).not.toMatch(/0xFF22252C/);
    expect(v6).toMatch(/isFocused/);
    expect(read('components/V6TabBar.tsx')).not.toMatch(/styles\.selected/);
  });

  it('lets the mini player and the bar share one material, with no fill of the mini player own', () => {
    expect(read('components/PillPlayer.tsx')).toMatch(/<ShellMaterial uri=\{coverImageUri\} below=\{bottom\} \/>/);
    expect(read('components/PillPlayer.tsx')).not.toMatch(/shell: \{[^}]*backgroundColor/);
    expect(read('components/V6TabBar.tsx')).toMatch(/<ShellMaterial uri=\{cover\} above=/);
  });
});

describe('items 1, 4 and 7: capsules', () => {
  it('draws chips and buttons as capsules', () => {
    expect(read('ui/Chip.tsx')).toMatch(/borderRadius: Radius\.pill,\n {4}backgroundColor: Glass\.chip/);
    expect(read('ui/Button.tsx')).toMatch(/paddingHorizontal: Space\.lg - Space\.xxs,\n {4}borderRadius: Radius\.pill/);
  });

  it('marks a chosen chip with a check, so it reads without colour', () => {
    expect(chipLeadingIcon(true)).toBe('checkmark');
    expect(chipLeadingIcon(false)).toBeUndefined();
    expect(chipLeadingIcon(true, 'time-outline')).toBe('time-outline');
  });

  it('draws a compact capsule smaller than its 48dp target', () => {
    expect(COMPACT_HEIGHT).toBe(40);
    expect(COMPACT_HEIGHT).toBeLessThan(Control.target);
  });

  it('pairs a filled Play with a compact Shuffle on artist, playlist and album pages', () => {
    for (const file of ['screens/ArtistScreen.tsx', 'screens/PlaylistDetailScreen.tsx', 'screens/CollectionScreen.tsx']) {
      const source = read(file);
      expect(source).toMatch(/variant="primary"/);
      expect(source).toMatch(/label="Shuffle"[^>]*size="compact"|size="compact"[^>]*label="Shuffle"/);
    }
  });
});

describe('item 2: action sheets open on their identity', () => {
  it('says what the sheet is about in one line', () => {
    expect(identityMeta('Song', 'Mira Vale', '3:33')).toBe('Song · Mira Vale · 3:33');
    expect(identityMeta('Mix', '25 songs', undefined, '')).toBe('Mix · 25 songs');
  });

  it('uses the identity header on the song and mix sheets', () => {
    expect(read('components/stream/useStreamSongActions.tsx')).toMatch(/<SheetIdentity /);
    expect(read('components/LibraryBottomSheet.tsx')).toMatch(/<SheetIdentity /);
    expect(read('screens/StreamScreen.tsx')).toMatch(/<SheetIdentity title=\{mixActions\.title\}/);
  });
});

describe('item 6: voice search lives in the Search field', () => {
  it('puts the mic and the listening panel in the field, and keeps the card out of the way', () => {
    const search = read('screens/SearchScreen.tsx');
    expect(search).toMatch(/\{voice\.trailing\}/);
    expect(search).toMatch(/\{voice\.panel\}/);
    expect(read('components/VoiceSearchCard.tsx')).toMatch(/const visible = phase !== 'idle' && !inField;/);
  });
});
