import * as fs from 'fs';
import * as path from 'path';
import { PLAYER_RELEASE_DELAY_MS, SOURCE_CLEAR_DELAY_MS, canvasSourcePlan } from './canvasPlayerPlan';

// Owner report (1.41.0): tapping the Apple Music style's full canvas down to the card closed the app on some phones.
// expo-video's `useVideoPlayer(source)` releases the old player during render whenever the source changes, while the
// mounted VideoView still draws it into its TextureView; the tap set the source to null that way.
const layer = fs.readFileSync(path.join(__dirname, 'CanvasVideoLayer.tsx'), 'utf8');
const code = layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('canvas video player lifetime', () => {
  it('never rebuilds the player from a changing source', () => {
    expect(code).not.toMatch(/useVideoPlayer\(/);
    expect(code).toMatch(/lib\.createVideoPlayer\(null\)/);
  });

  it('switches clips in place and clears a gone clip only after the view has unmounted', () => {
    expect(code).toMatch(/player\.replaceAsync\(plan\.source\)/);
    expect(code).toMatch(/player\.replaceAsync\(null\)/);
    expect(code).toMatch(/if \(!canvas\) return null;/);
  });

  it('releases the player only after its view has gone, and survives a dev re-mount', () => {
    expect(code).toMatch(/setTimeout\(\(\) => \{[\s\S]*?p\?\.release\(\);[\s\S]*?\}, PLAYER_RELEASE_DELAY_MS\)/);
    expect(code).toMatch(/if \(releaseTimer\.current\) clearTimeout\(releaseTimer\.current\);/);
    expect(PLAYER_RELEASE_DELAY_MS).toBeGreaterThan(SOURCE_CLEAR_DELAY_MS);
  });

  it('keeps the canvas silent and out of the media session', () => {
    expect(code).toMatch(/p\.muted = true;/);
    expect(code).toMatch(/p\.audioMixingMode = 'mixWithOthers';/);
    expect(code).toMatch(/p\.showNowPlayingNotification = false;/);
  });
});

describe('canvasSourcePlan', () => {
  it('loads a clip with its stream type', () => {
    expect(canvasSourcePlan({ url: 'https://a/clip.m3u8', isHls: true })).toEqual({ kind: 'load', source: { uri: 'https://a/clip.m3u8', contentType: 'hls' } });
    expect(canvasSourcePlan({ url: 'https://a/clip.mp4', isHls: false })).toEqual({ kind: 'load', source: { uri: 'https://a/clip.mp4', contentType: 'auto' } });
  });

  it('clears a gone clip after a pause, never at once', () => {
    expect(canvasSourcePlan(null)).toEqual({ kind: 'clear', afterMs: SOURCE_CLEAR_DELAY_MS });
    expect(SOURCE_CLEAR_DELAY_MS).toBeGreaterThan(0);
  });
});
