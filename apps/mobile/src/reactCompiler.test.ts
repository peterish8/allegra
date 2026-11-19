/**
 * The React Compiler memoizes components at build time, so a song tick or a store change re-renders only what
 * read the changed value. Expo runs it from babel-preset-expo when app.json turns it on. If the flag is dropped,
 * or a hot player component starts breaking the Rules of React, the compiler silently skips it and the extra
 * renders come back with no other symptom.
 */
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const babel = require('@babel/core') as {
  transformSync: (code: string, options: Record<string, unknown>) => { code?: string | null } | null;
};

const root = path.join(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  expo: { experiments?: { reactCompiler?: boolean } };
};

function compile(relative: string): string {
  const file = path.join(root, relative);
  const result = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [['babel-plugin-react-compiler', { target: '19', panicThreshold: 'none' }]],
  });
  return result?.code ?? '';
}

describe('React Compiler', () => {
  it('is on for the app build', () => {
    expect(appJson.expo.experiments?.reactCompiler).toBe(true);
  });

  it.each([
    'src/screens/NowPlayingScreen.tsx',
    'src/components/NowPlayingControls.tsx',
    'src/components/NowPlayingHeader.tsx',
    'src/components/MiniPlayer.tsx',
    'src/screens/LibraryScreen.tsx',
    'src/components/stream/StreamHome.tsx',
    'src/ui/ListRow.tsx',
  ])('memoizes %s', (file) => {
    expect(compile(file)).toContain('react/compiler-runtime');
  });
});
