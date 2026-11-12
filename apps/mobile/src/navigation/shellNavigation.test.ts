import * as fs from 'fs';
import * as path from 'path';
import { CREATE_ITEMS, CREATE_TAB, NAV_TABS, litTab } from './createMenu';
import { PROFILE_GROUPS, aboutRowTitle, profileButtonLabel, profileInitial } from './profileMenu';
import { useShellMenuStore } from '../store/shellMenuStore';

// Owner, 1.42.0: Spotify's positions. Tabs Stream, Search, Library, Create; Luvs in the Create (+) sheet; the You tab
// becomes the profile menu behind your picture at the top left of Stream, Search and Library.
const SRC = path.join(__dirname, '..');
const read = (...parts: string[]): string => fs.readFileSync(path.join(SRC, ...parts), 'utf8');
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('tabs and the Create sheet', () => {
  it('has Spotify\'s four tabs in Spotify\'s order', () => {
    expect(NAV_TABS).toEqual(['Stream', 'Search', 'Library', 'Create']);
    // tabs.ts imports react-native, so its set is read from the source here.
    expect(read('navigation', 'tabs.ts')).toMatch(/export const VISIBLE_TABS: ReadonlySet<string> = new Set\(\['Stream', 'Search', 'Library'\]\);/);
  });

  it('puts Luvs first in the Create sheet, then Playlist, Blend and LuvLink', () => {
    expect(CREATE_ITEMS.map(item => item.id)).toEqual(['luvs', 'playlist', 'blend', 'luvlink']);
    for (const item of CREATE_ITEMS) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.subtitle.length).toBeGreaterThan(0);
    }
  });

  it('keeps the tab you came from lit on pages that are not tabs', () => {
    expect(litTab('Stream', 'Library')).toBe('Stream');
    expect(litTab('Search', 'Stream')).toBe('Search');
    expect(litTab('Luvs', 'Library')).toBe('Library');
    expect(litTab('Browse', 'Search')).toBe('Search');
    expect(litTab('Settings', 'Stream')).toBe('Stream');
    // Create is never lit as a page.
    expect(litTab('Luvs', CREATE_TAB)).toBe('Stream');
  });
});

describe('profile menu', () => {
  it('holds every row the You tab had', () => {
    const ids = PROFILE_GROUPS.flatMap(group => group.items.map(item => item.id));
    expect(ids).toEqual(expect.arrayContaining(['downloads', 'import', 'blends', 'luvlink', 'devices', 'settings']));
    // Your DJ is archived in the phone app (apps/mobile/archive/dj): it must not come back through the menu by accident.
    expect(ids).not.toContain('dj');
    expect(PROFILE_GROUPS.at(-1)?.items.at(-1)?.title).toBe('Settings and privacy');
  });

  it('names the picture and About so the release gate can reach the Updates panel', () => {
    expect(profileButtonLabel(false)).toBe('Profile and settings');
    expect(profileButtonLabel(true)).toMatch(/^Profile and settings, update available$/);
    expect(aboutRowTitle(false)).toMatch(/^About LuvLyrics/);
    expect(aboutRowTitle(true)).toMatch(/^About LuvLyrics, update available$/);
  });

  it('shows the first letter of your name, or a person glyph', () => {
    expect(profileInitial('prats')).toBe('P');
    expect(profileInitial('  émile ')).toBe('É');
    expect(profileInitial(':) ana')).toBe('A');
    expect(profileInitial('')).toBeNull();
    expect(profileInitial(undefined)).toBeNull();
  });

  it('never has the Create sheet and the profile menu open together', () => {
    const store = useShellMenuStore.getState();
    store.setCreateOpen(true);
    store.setProfileOpen(true);
    expect(useShellMenuStore.getState()).toMatchObject({ createOpen: false, profileOpen: true });
    useShellMenuStore.getState().setCreateOpen(true);
    expect(useShellMenuStore.getState()).toMatchObject({ createOpen: true, profileOpen: false });
    useShellMenuStore.getState().setCreateOpen(false);
  });
});

describe('the bar and the headers are wired', () => {
  it('the native bar draws Stream, Search, Library and Create, and Create opens the sheet', () => {
    const bar = read('..', 'android', 'app', 'src', 'main', 'java', 'com', 'lyricflow', 'app', 'views', 'NativeTabBarView.kt');
    expect(bar).toMatch(/private val v6Tabs = listOf\("Stream", "Search", "Library", CREATE\)/);
    expect(bar).toMatch(/if \(name == CREATE\) onMorePress\(mapOf\("open" to moreOpen\)\) else onTabPress\(mapOf\("route" to name\)\)/);
    expect(bar).toMatch(/const val CREATE = "Create"/);
    expect(bar).toMatch(/const val GLYPH_ADD = 0xf103/);
  });

  it('the JS bar toggles the sheet, shows the close disc and mounts the profile menu', () => {
    const v6 = code(read('components', 'V6TabBar.tsx'));
    expect(v6).toMatch(/moreOpen=\{createOpen\}/);
    expect(v6).toMatch(/onMorePress=\{\(\) => press\(CREATE_TAB\)\}/);
    expect(v6).toMatch(/<CreateSheet open=\{createOpen\}/);
    expect(v6).toMatch(/<ProfileMenu onAction=\{profile\} \/>/);
    expect(v6).toMatch(/if \(action === 'luvs'\) navigation\.navigate\('Luvs'\)/);
  });

  it('Stream, Search and Library show your picture at the top left; Stream lost its About mark', () => {
    const stream = code(read('screens', 'StreamScreen.tsx'));
    expect(stream).toMatch(/<ProfileButton \/>/);
    expect(stream).not.toMatch(/luvlyrics-logo-white-mark/);
    expect(stream).not.toMatch(/<AboutSheet/);
    expect(code(read('screens', 'SearchScreen.tsx'))).toMatch(/<ProfileButton \/>/);
    expect(code(read('screens', 'LibraryScreen.tsx'))).toMatch(/: <ProfileButton \/>\}/);
  });

  it('the release gate reaches About through the profile menu', () => {
    const gate = fs.readFileSync(path.join(SRC, '..', '..', '..', '.github', 'scripts', 'mobile-launch-check.sh'), 'utf8');
    expect(gate).toMatch(/centre_of 'Profile and settings\[\^"\]\*'/);
    expect(gate).toMatch(/centre_of 'About LuvLyrics\[\^"\]\*'/);
  });
});
