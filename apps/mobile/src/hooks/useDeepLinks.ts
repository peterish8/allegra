/**
 * lyricflow:// links (the scheme is registered in app.json):
 *
 *   lyricflow://play?q=<song and artist>[&lyrics=1]
 *       find the song (official YouTube Music match, catalog audio), play it
 *       and open Now Playing — on the cover, or on lyrics with lyrics=1
 *   lyricflow://open/<stream|luvs|library|playlists|search|settings>
 *   lyricflow://player[?sheet=menu|together|queue|timer][&lyrics=1]
 *       open Now Playing on the current song (optionally with a sheet up, or
 *       switched to lyrics: on an open player that is the lyrics button's path)
 *   lyricflow://together?code=<room>
 *       a Listen together invite: opens the room sheet with the code filled in
 *   lyricflow://style?playerBackground=aura&miniPlayerBackground=glass&appBackground=glow&fps=1
 *       set how the app looks (utils/styleLink: only known values are read)
 *   lyricflow://diagnose
 *       turn on diagnostics (utils/diag) for this run
 *
 * Mounted once in RootNavigator. The emulator smoke test drives the app with
 * these; they are also shareable.
 */
import { useEffect } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBlendInviteCode } from '@shared/blendLimits';
import { navigationRef, openMainTab } from '../utils/navigationService';
import { searchOfficial } from '../services/stream/officialSearch';
import { StreamService } from '../services/stream/StreamService';
import { usePlayerStore } from '../store/playerStore';
import { diag, enableDiagnostics } from '../utils/diag';
import { useListenTogetherStore } from '../store/listenTogetherStore';
import { useSettingsStore } from '../store/settingsStore';
import { styleUpdates } from '../utils/styleLink';
import type { PlayerSheetName } from '../types/navigation';

const SHEETS: PlayerSheetName[] = ['menu', 'together', 'queue', 'timer'];

export const parseDeepLink = (url: string): { action: string; params: Record<string, string> } | null => {
  const webInvite = /^https:\/\/(?:allegravibe\.vercel\.app|allegra\.music)\/blend\/join\/([^/?#]+)(?:[?#].*)?$/i.exec(url.trim());
  if (webInvite) {
    try { const code = decodeURIComponent(webInvite[1]); return isBlendInviteCode(code) ? { action: 'blend/join', params: { code } } : null; } catch { return null; }
  }
  const m = /^lyricflow:\/\/([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const pair of (m[2] ?? '').split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=');
    try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return null; }
  }
  return { action: m[1].replace(/\/+$/, '').toLowerCase(), params };
};

const waitForNavigation = async () => {
  for (let i = 0; i < 50 && !navigationRef.isReady(); i++) await new Promise(r => setTimeout(r, 100));
};

const handle = async (url: string | null) => {
  if (!url) return;
  const link = parseDeepLink(url);
  if (!link) return;
  if (link.action === 'diagnose') {
    enableDiagnostics();
    diag('link', 'diagnostics on');
    return;
  }
  if (link.action === 'style') {
    useSettingsStore.setState(styleUpdates(link.params));
    diag('link', `style ${JSON.stringify(styleUpdates(link.params))}`);
    return;
  }
  await waitForNavigation();
  if (link.action === 'blend/join' && isBlendInviteCode(link.params.code ?? '')) {
    await AsyncStorage.setItem('allegra:pending-blend-invite', link.params.code).catch(() => undefined);
    openMainTab({ screen: 'Library', params: { screen: 'BlendJoin', params: { code: link.params.code } } });
    return;
  }
  if (link.action === 'play' && link.params.q) {
    const found = await searchOfficial(link.params.q, 5).catch(() => []);
    diag('link', `play "${link.params.q}" -> ${found.length} results${found[0] ? `, first "${found[0].title}" by ${found[0].artist}` : ''}`);
    if (found.length === 0) return;
    StreamService.play(found, 0);
    const songId = usePlayerStore.getState().currentSongId;
    if (songId) navigationRef.navigate('NowPlaying', { songId, lyrics: link.params.lyrics === '1' });
    return;
  }
  if (link.action === 'player' || link.action === 'together') {
    const songId = usePlayerStore.getState().currentSongId;
    const code = (link.params.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (link.action === 'together' && code) useListenTogetherStore.setState({ inviteCode: code });
    const requested = link.action === 'together' ? 'together' : link.params.sheet;
    const sheet = SHEETS.find(s => s === requested);
    const lyrics = link.action === 'player' && link.params.lyrics === '1';
    if (songId) navigationRef.navigate('NowPlaying', { songId, sheet, ...(lyrics ? { lyrics } : {}) });
    else if (link.action === 'together') useListenTogetherStore.getState().announce('Play a song, then open Listen together to join');
    return;
  }
  if (link.action.startsWith('open/')) {
    const target = link.action.slice(5);
    switch (target) {
      case 'stream': openMainTab({ screen: 'Stream' }); break;
      case 'luvs': openMainTab({ screen: 'Luvs' }); break;
      case 'library': openMainTab({ screen: 'Library', params: { screen: 'LibraryHome' } }); break;
      case 'playlists': openMainTab({ screen: 'Library', params: { screen: 'Playlists' } }); break;
      case 'blends': openMainTab({ screen: 'Library', params: { screen: 'Blends' } }); break;
      case 'import': openMainTab({ screen: 'Library', params: { screen: 'Import' } }); break;
      case 'search': openMainTab({ screen: 'Search' }); break;
      case 'settings': openMainTab({ screen: 'Settings' }); break;
      default: break;
    }
    // Late enough for the player's close animation to have finished.
    setTimeout(() => diag('link', `open/${target} -> ${navigationRef.getCurrentRoute()?.name ?? 'nothing'}`), 1500);
  }
};

export const useDeepLinks = (): void => {
  useEffect(() => {
    Linking.getInitialURL().then(async url => {
      if (url) return handle(url);
      const code = await AsyncStorage.getItem('allegra:pending-blend-invite');
      if (code && isBlendInviteCode(code)) return handle(`lyricflow://blend/join?code=${encodeURIComponent(code)}`);
    }).catch(() => {});
    const sub = Linking.addEventListener('url', e => { void handle(e.url).catch(() => undefined); });
    return () => sub.remove();
  }, []);
};
