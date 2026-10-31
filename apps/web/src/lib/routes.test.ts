import assert from 'node:assert/strict';
import test from 'node:test';

import { legacyHashToPath, parseRoute, paths } from './routes.ts';

test('every static view has a path that parses back to it', () => {
  for (const view of ['discover', 'library', 'liked', 'album', 'settings', 'privacy', 'terms', 'copyright'] as const) {
    assert.equal(parseRoute(`/${view}`).view, view);
  }
  assert.equal(parseRoute(paths.settings).view, 'settings');
  assert.equal(parseRoute('/').view, 'home');
  assert.equal(parseRoute('/nonsense').view, 'home');
});

test('artist, playlist and shared routes round-trip awkward names', () => {
  assert.deepEqual(parseRoute(paths.artist('A. R. Rahman & Co/1')), {
    view: 'artist', artistName: 'A. R. Rahman & Co/1', playlistId: null, sharedCode: null, blendId: null, inviteCode: null, luvLinkRoomId: null
  });
  assert.equal(parseRoute(paths.playlist('lib 42')).playlistId, 'lib 42');
  assert.equal(parseRoute(paths.shared('AbC123')).sharedCode, 'abc123');
});

test('missing or malformed params fall back to a safe view', () => {
  assert.equal(parseRoute('/artist').view, 'home');
  assert.equal(parseRoute('/artist/%E0%A4%A').view, 'home');
  assert.equal(parseRoute('/playlist').view, 'library');
  assert.equal(parseRoute('/shared/').view, 'home');
});

test('old hash links redirect to real paths', () => {
  assert.equal(legacyHashToPath('#shared/abc'), '/shared/abc');
  assert.equal(legacyHashToPath('#artist/Arijit%20Singh'), '/artist/Arijit%20Singh');
  assert.equal(legacyHashToPath('#library'), '/library');
  assert.equal(legacyHashToPath('#home'), '/');
  assert.equal(legacyHashToPath('#main-content'), null);
  assert.equal(legacyHashToPath('#artist'), null);
  assert.equal(legacyHashToPath(''), null);
});

test('import and blend routes exist only behind their flags', () => {
  const on = { import: true, blend: true };
  const off = { import: false, blend: false };
  assert.equal(parseRoute(paths.import, on).view, 'import');
  assert.equal(parseRoute(paths.import, off).view, 'home');
  assert.equal(parseRoute(paths.blends, on).view, 'blends');
  assert.equal(parseRoute(paths.blends, off).view, 'home');
  assert.equal(parseRoute(paths.blend('k57x'), on).blendId, 'k57x');
  assert.equal(parseRoute(paths.blend('k57x'), off).view, 'home');
  assert.deepEqual(parseRoute(paths.blendJoin('ABCDEFGHJKMN'), on), {
    view: 'blendJoin', artistName: null, playlistId: null, sharedCode: null, blendId: null, inviteCode: 'abcdefghjkmn', luvLinkRoomId: null
  });
  assert.equal(parseRoute('/blend/join', on).view, 'blends');
  assert.equal(parseRoute('/blend', on).view, 'blends');
});

test('LuvLink invite and room routes retain their path state', () => {
  assert.deepEqual(parseRoute(paths.luvLinkJoin('abcdefgh')), {
    view: 'luvLink', artistName: null, playlistId: null, sharedCode: null, blendId: null, inviteCode: 'ABCDEFGH', luvLinkRoomId: null
  });
  assert.equal(parseRoute(paths.luvLinkRoom('room 42')).luvLinkRoomId, 'room 42');
  assert.equal(parseRoute(paths.luvLink).view, 'luvLink');
});
