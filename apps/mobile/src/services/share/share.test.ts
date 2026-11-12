/**
 * Sharing (1.44.0, owner): links that open LuvLyrics or the website, LuvLyrics codes, and the flip-card deck behind a
 * playlist's cover. The pure rules run here; the Android pieces are read from source so a later edit cannot quietly
 * drop them (App Links, the camera module, the scanner's entry).
 */
jest.mock('@shopify/react-native-skia', () => ({}));

import * as fs from 'fs';
import * as path from 'path';
import { decodeLuvCodeImage, encodeLuvCode, luvCodeLayout, CODE_HEIGHT, CODE_WIDTH } from '@shared/luvCode';
import { codePayloadFor, shareMessage, songRefOf, songShareTarget, targetForPayload } from './shareService';
import { scanSize, toGrey, SCAN_MAX } from './scanImage';
import {
  coverSizeFor, deckStartIndex, playlistLength, playlistShareText, playlistWash, settledCard, swipeChangesSong,
} from '../../components/playlist/playlistPage';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('what a song shares', () => {
  it('names the catalog song: a stream by its id, a download by where it came from, else by name', () => {
    expect(songRefOf({ id: 'stream:saavn:B4-hLCKJ' })).toBe('saavn:B4-hLCKJ');
    expect(songRefOf({ id: 'local-123', originId: 'saavn:abc12345' })).toBe('saavn:abc12345');
    expect(songRefOf({ id: 'local-123' })).toBeNull();
    expect(songRefOf({ id: 'local-123', originId: 'spotify:x' })).toBeNull();
  });

  it('sends the name and the link in one message', () => {
    const target = songShareTarget({ id: 'stream:saavn:B4-hLCKJ', title: 'Mozhiye', artist: 'Sai Abhyankkar' });
    expect(shareMessage(target, 'Mozhiye · Sai Abhyankkar')).toBe('Mozhiye · Sai Abhyankkar\nhttps://allegravibe.vercel.app/song/saavn/B4-hLCKJ?t=Mozhiye&a=Sai%20Abhyankkar');
  });

  it('draws a code for a JioSaavn song or a public playlist, and a scanned code opens the same thing', () => {
    const song = songShareTarget({ id: 'stream:saavn:B4-hLCKJ', title: 'x', artist: 'y' });
    expect(codePayloadFor(song)).toEqual({ kind: 'song', source: 'saavn', id: 'B4-hLCKJ' });
    expect(targetForPayload(codePayloadFor(song)!)).toEqual({ kind: 'song', ref: 'saavn:B4-hLCKJ', title: '', artist: '' });
    expect(codePayloadFor({ kind: 'playlist', code: 'abcd2345' })).toEqual({ kind: 'playlist', code: 'abcd2345' });
    expect(targetForPayload({ kind: 'playlist', code: 'abcd2345' })).toEqual({ kind: 'playlist', code: 'abcd2345' });
    // A song only found by name has a link but no code.
    expect(codePayloadFor(songShareTarget({ id: 'local', title: 'x', artist: 'y' }))).toBeNull();
  });
});

describe('reading a code from a photo', () => {
  it('turns RGBA pixels into greyscale and keeps a frame small enough to scan quickly', () => {
    expect(Array.from(toGrey([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255], 3, 1).data)).toEqual([255, 0, 76]);
    expect(scanSize(4000, 3000)).toEqual({ width: SCAN_MAX, height: 480 });
    expect(scanSize(300, 200)).toEqual({ width: 300, height: 200 });
  });

  it('reads a code drawn the way the share sheet draws it, from RGBA pixels like a screenshot', () => {
    const payload = { kind: 'playlist', code: 'abcd2345' } as const;
    const layout = luvCodeLayout(encodeLuvCode(payload)!);
    const scale = 1.5;
    const width = Math.round(CODE_WIDTH * scale) + 80, height = Math.round(CODE_HEIGHT * scale) + 120;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x - 40) / scale, v = (y - 60) / scale;
      const onCard = u >= 0 && u <= CODE_WIDTH && v >= 0 && v <= CODE_HEIGHT;
      const lit = onCard && (layout.bars.some(b => u >= b.x && u <= b.x + b.width && v >= b.y && v <= b.y + b.height)
        || (u - layout.mark.cx) ** 2 + (v - layout.mark.cy) ** 2 <= layout.mark.r ** 2);
      const [r, g, b] = lit ? [244, 244, 245] : onCard ? [52, 40, 70] : [11, 13, 16];
      const p = (y * width + x) * 4;
      rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = 255;
    }
    expect(decodeLuvCodeImage(toGrey(rgba, width, height))).toEqual(payload);
  });
});

describe('the playlist page (owner’s Spotify screenshots)', () => {
  it('leads with a cover about 62% of the width, never too big on a tablet', () => {
    expect(coverSizeFor(360)).toBe(223);
    expect(coverSizeFor(1200)).toBe(300);
  });

  it('says how long it is, in hours and minutes', () => {
    expect(playlistLength(76 * 60 + 5)).toBe('1 hr 16 min');
    expect(playlistLength(42 * 60)).toBe('42 min');
    expect(playlistLength(0)).toBe('');
    expect(playlistLength(Number.NaN)).toBe('');
  });

  it('washes the top in a calm tone of the cover that sinks into the page', () => {
    const [top, middle, bottom] = playlistWash('#ff2a2a');
    expect(top).toMatch(/^#[0-9a-f]{6}$/i);
    expect(middle).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bottom).toBe('rgba(11, 13, 16, 0)');
  });

  it('shares a playlist that has no link as a numbered list', () => {
    const text = playlistShareText('Quick sleep ra', [{ title: 'Mozhiye', artist: 'Sai Abhyankkar' }, { title: 'Untitled' }], 30);
    expect(text).toBe('Quick sleep ra\n\n1. Mozhiye — Sai Abhyankkar\n2. Untitled\n\nvia LuvLyrics');
    expect(playlistShareText('Big', Array.from({ length: 40 }, (_, i) => ({ title: `S${i}` })), 30)).toMatch(/…and 10 more/);
  });

  it('the flipped cover opens on the playing song and swiping plays the card it rests on, never restarting one', () => {
    const ids = ['a', 'b', 'c'];
    expect(deckStartIndex(ids, 'b', true)).toBe(1);
    expect(deckStartIndex(ids, 'b', false)).toBe(0); // another playlist is playing
    expect(deckStartIndex(ids, 'z', true)).toBe(0); // a search narrowed the list
    expect(settledCard(0, 200, 3)).toBe(0);
    expect(settledCard(290, 200, 3)).toBe(1);
    expect(settledCard(9999, 200, 3)).toBe(2);
    expect(settledCard(-50, 200, 3)).toBe(0);
    expect(settledCard(10, 0, 3)).toBe(0);
    expect(swipeChangesSong('b', 'b', true)).toBe(false);
    expect(swipeChangesSong('c', 'b', true)).toBe(true);
    expect(swipeChangesSong('b', 'b', false)).toBe(true);
    expect(swipeChangesSong(undefined, 'b', true)).toBe(false);
  });
});

describe('a link opens the app', () => {
  // Reading the links themselves is in hooks/useDeepLinks.test.ts.
  it('Android sends these links here, verified against the website (App Links)', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const filter = /<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/.exec(manifest)?.[1] ?? '';
    for (const prefix of ['/song/', '/shared/', '/blend/join/', '/luvlink/join/']) expect(filter).toContain(`android:pathPrefix="${prefix}"`);
    expect(filter).toContain('android:host="allegravibe.vercel.app"');
    expect(filter).toContain('android.intent.category.BROWSABLE');
    const config = JSON.parse(read('app.json')) as { expo: { android: { intentFilters: { autoVerify: boolean; data: { pathPrefix: string }[] }[] } } };
    const filters = config.expo.android.intentFilters;
    expect(filters[0].autoVerify).toBe(true);
    expect(filters[0].data.map(d => d.pathPrefix)).toEqual(['/song/', '/shared/', '/blend/join/', '/luvlink/join/']);
    // The website vouches for this app's package and signing certificate.
    const links = JSON.parse(fs.readFileSync(path.join(ROOT, '../web/public/.well-known/assetlinks.json'), 'utf8')) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    expect(links[0].target.package_name).toBe('com.lyricflow.app');
    expect(links[0].target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe('the scanner', () => {
  it('has the camera: the permission, the native module and the screen, reached from Search', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain('android.permission.CAMERA');
    expect(read('android/app/src/main/java/expo/modules/ExpoModulesPackageList.kt')).toContain('expo.modules.camera.CameraViewModule::class.java');
    expect(read('src/navigation/RootNavigator.tsx')).toMatch(/<Stack\.Screen name="ScanCode" component=\{ScanCodeScreen\}/);
    expect(read('src/screens/SearchScreen.tsx')).toMatch(/label="Scan a LuvLyrics code" variant="plain" onPress=\{\(\) => navigationRef\.navigate\('ScanCode'\)\}/);
    // Stills are taken quietly and read on the phone; nothing is uploaded.
    const scanner = read('src/screens/ScanCodeScreen.tsx');
    expect(scanner).toMatch(/takePictureAsync\(\{ quality: 0\.55, skipProcessing: true, shutterSound: false \}\)/);
    expect(scanner).toMatch(/readCodeFromPhoto\(still\.uri, SCAN_BUDGET_MS\)/);
    expect(scanner).not.toMatch(/fetch\(/);
  });

  it('shares open the code and link sheet from a song’s ⋮ and a playlist page', () => {
    expect(read('src/components/library/useSongActions.tsx')).toMatch(/<ShareSheet visible=\{shareOpen\}/);
    expect(read('src/components/LibraryBottomSheet.tsx')).toMatch(/<SheetOption label="Share" icon="share-social-outline" onPress=\{onShareLink\} \/>/);
    expect(read('src/screens/PlaylistDetailScreen.tsx')).toMatch(/<ShareSheet visible=\{shareOpen\}/);
  });
});
