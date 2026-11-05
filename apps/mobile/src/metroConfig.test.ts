/**
 * Sentry's feedback wrappers must be stubbed out of the native bundle on every OS. Its own check looked for
 * "@sentry/browser" with forward slashes only, so a bundle built on Windows kept `feedbackAsync`, which calls the
 * stubbed feedback package at startup: the app showed "LuvLyrics couldn't open" (undefined is not a function).
 */
import * as path from 'path';

type Resolve = (context: { originModulePath: string; resolveRequest: () => unknown }, name: string, platform: string) => unknown;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const metroConfig = require(path.join(__dirname, '..', 'metro.config.js')) as { resolver: { resolveRequest: Resolve } };
const resolve = metroConfig.resolver.resolveRequest;
const passThrough = () => ({ type: 'sourceFile', filePath: 'resolved' });

describe('metro config: Sentry feedback stub', () => {
  it.each([
    ['a Windows path', 'C:\\dev\\allegra\\apps\\mobile\\node_modules\\@sentry\\browser\\build\\npm\\esm\\prod\\index.js'],
    ['a POSIX path', '/home/runner/work/allegra/apps/mobile/node_modules/@sentry/browser/build/npm/esm/prod/index.js'],
  ])('stubs feedbackAsync imported from @sentry/browser on %s', (_label, origin) => {
    expect(resolve({ originModulePath: origin, resolveRequest: passThrough }, './feedbackAsync.js', 'android')).toEqual({ type: 'empty' });
    expect(resolve({ originModulePath: origin, resolveRequest: passThrough }, './feedbackSync.js', 'android')).toEqual({ type: 'empty' });
  });

  it('leaves the app’s own modules alone', () => {
    const origin = 'C:\\dev\\allegra\\apps\\mobile\\src\\services\\feedback\\index.ts';
    expect(resolve({ originModulePath: origin, resolveRequest: passThrough }, './feedbackDraft', 'android')).not.toEqual({ type: 'empty' });
  });
});
