import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../components/LibraryPage.tsx', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

test('library loading is announced as a busy status with a musical equalizer', () => {
  assert.match(page, /className="library-state library-loading-state" role="status" aria-live="polite" aria-busy="true"/);
  assert.match(page, /className="library-loading-equalizer"><span \/><span \/><span \/><span \/><span \/><\/span>/);
  assert.match(page, /<h2>Loading your library<\/h2>/);
  assert.doesNotMatch(page, /library-loading-mark/);
});

test('library loading animation has a reduced-motion fallback without the colliding legacy class', () => {
  assert.match(appCss, /\.library-loading-state\s*\{[^}]*align-items:\s*center;/);
  assert.match(appCss, /\.library-loading-equalizer span\s*\{[^}]*animation:\s*library-loading-equalize/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.library-loading-orbit,[\s\S]*?\.library-loading-equalizer span\s*\{\s*animation:\s*none;/);
  assert.doesNotMatch(`${appCss}\n${globalCss}`, /library-loading-mark/);
});
