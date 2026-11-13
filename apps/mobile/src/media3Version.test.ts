/**
 * An APK holds a single Media3, so the app's own version has to be the one expo-video and expo-audio were
 * built for. expo-video ships a copy of DefaultLoadControl compiled against its version; with the app on
 * 1.11.1 that copy lacked LoadControl.getAllocator(PlayerId), and the first canvas video killed the whole
 * app with an AbstractMethodError on the ExoPlayer:Playback thread (owner report, 2026-11-13: opening
 * "cardigan" closed the app).
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');

function versionIn(file: string, pattern: RegExp): string {
  const found = fs.readFileSync(path.join(root, file), 'utf8').match(pattern);
  if (!found?.[1]) throw new Error(`no Media3 version found in ${file}`);
  return found[1];
}

describe('Media3 version', () => {
  const app = versionIn('android/app/build.gradle', /def media3 = "([^"]+)"/);

  it.each([
    'node_modules/expo-video/android/build.gradle',
    'node_modules/expo-audio/android/build.gradle',
  ])('the app uses the Media3 that %s is built for', (file) => {
    expect(app).toBe(versionIn(file, /androidxMedia3Version = "([^"]+)"/));
  });
});
