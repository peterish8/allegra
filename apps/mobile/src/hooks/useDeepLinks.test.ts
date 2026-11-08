jest.mock('../services/stream/officialSearch', () => ({ searchOfficial: jest.fn() }));
jest.mock('../services/stream/StreamService', () => ({ StreamService: { play: jest.fn() } }));
jest.mock('../store/playerStore', () => ({ usePlayerStore: { getState: () => ({ currentSongId: null }) } }));
jest.mock('../utils/navigationService', () => ({ navigationRef: { isReady: () => true, navigate: jest.fn() } }));
jest.mock('react-native', () => ({ Linking: { getInitialURL: jest.fn(), addEventListener: jest.fn() } }));
jest.mock('../store/settingsStore', () => ({ useSettingsStore: { setState: jest.fn() } }));

import { parseDeepLink } from './useDeepLinks';

describe('parseDeepLink', () => {
  it('reads the action and decoded params', () => {
    expect(parseDeepLink('lyricflow://play?q=Blinding+Lights%20The%20Weeknd&lyrics=1')).toEqual({
      action: 'play',
      params: { q: 'Blinding Lights The Weeknd', lyrics: '1' },
    });
    expect(parseDeepLink('lyricflow://open/settings')).toEqual({ action: 'open/settings', params: {} });
    expect(parseDeepLink('lyricflow://diagnose/')).toEqual({ action: 'diagnose', params: {} });
    expect(parseDeepLink('https://example.com')).toBeNull();
  });
});

describe('share links (1.44.0)', () => {
  it('reads shared songs and playlists from our links, and leaves other links alone', () => {
    expect(parseDeepLink('https://allegravibe.vercel.app/song/saavn/B4-hLCKJ?t=Mozhiye&a=Sai')).toEqual({
      action: 'share/song', params: { ref: 'saavn:B4-hLCKJ', title: 'Mozhiye', artist: 'Sai' },
    });
    expect(parseDeepLink('https://allegravibe.vercel.app/song/find?t=Tarantino&a=LISA')).toEqual({
      action: 'share/song', params: { ref: '', title: 'Tarantino', artist: 'LISA' },
    });
    expect(parseDeepLink('https://allegravibe.vercel.app/shared/ABCD2345')).toEqual({ action: 'share/playlist', params: { code: 'abcd2345' } });
    expect(parseDeepLink('https://example.com/song/saavn/x')).toBeNull();
    // Invites keep their own handling.
    expect(parseDeepLink('https://allegravibe.vercel.app/luvlink/join/ABCD')?.action).toBe('luvlink/join');
  });
});

describe('player and invite links', () => {
  it('accepts trusted Blend invites and ignores malformed or unrelated links', () => {
    expect(parseDeepLink('https://allegravibe.vercel.app/blend/join/abcdefghjkmn')).toEqual({ action: 'blend/join', params: { code: 'abcdefghjkmn' } });
    expect(parseDeepLink('https://untrusted.example/blend/join/ABCD1234')).toBeNull();
    expect(parseDeepLink('lyricflow://play?q=%ZZ')).toBeNull();
  });
  it('parses a sheet request and an invite code', () => {
    expect(parseDeepLink('lyricflow://player?sheet=menu')).toEqual({ action: 'player', params: { sheet: 'menu' } });
    expect(parseDeepLink('lyricflow://together?code=ab12cd')).toEqual({ action: 'together', params: { code: 'ab12cd' } });
  });

  it('parses a lyrics switch for the open player', () => {
    expect(parseDeepLink('lyricflow://player?lyrics=1')).toEqual({ action: 'player', params: { lyrics: '1' } });
  });
});
