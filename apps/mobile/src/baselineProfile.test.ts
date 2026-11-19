/**
 * Cold start runs the Kotlin and React Native startup path. LuvLyrics is sideloaded, so Play never delivers a
 * cloud profile: the app ships its own Baseline Profile and androidx.profileinstaller applies it at first launch.
 * Dropping either one leaves startup interpreted with no other symptom. The APK workflow also checks that
 * assets/dexopt/baseline.prof made it into the built APK.
 */
import * as fs from 'fs';
import * as path from 'path';

const android = path.join(__dirname, '..', 'android', 'app');
const read = (relative: string) => fs.readFileSync(path.join(android, relative), 'utf8');

describe('Baseline Profile', () => {
  const rules = read('src/main/baseline-prof.txt')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  it.each(['com/lyricflow/app', 'com/facebook/react', 'expo/modules', 'com/swmansion'])(
    'precompiles methods and preloads classes under %s',
    (pkg) => {
      expect(rules).toContain(`HSPL${pkg}/**->**(**)**`);
      expect(rules).toContain(`L${pkg}/**;`);
    },
  );

  it('uses only valid rule shapes', () => {
    for (const rule of rules) expect(rule).toMatch(/^(H?S?P?L[\w/$*]+(;|->\*\*\(\*\*\)\*\*))$/);
  });

  it('is installed on sideloaded phones by profileinstaller', () => {
    expect(read('build.gradle')).toMatch(/implementation "androidx\.profileinstaller:profileinstaller:[\d.]+"/);
  });
});
