import assert from 'node:assert/strict';
import test from 'node:test';

import { ARTWORK_MAX_LENGTH, shareableArtwork } from './artwork.ts';

test('an https cover travels as it is', () => {
  const cover = 'https://c.saavncdn.com/191/Kesariya-500x500.jpg';
  assert.equal(shareableArtwork(cover), cover);
  assert.equal(shareableArtwork(`  ${cover}  `), cover);
  assert.equal(shareableArtwork('HTTPS://lh3.googleusercontent.com/abc=w544-h544'), 'HTTPS://lh3.googleusercontent.com/abc=w544-h544');
});

test('an http cover from a catalog host is upgraded, any other http cover is dropped', () => {
  assert.equal(shareableArtwork('http://c.saavncdn.com/191/a-500x500.jpg'), 'https://c.saavncdn.com/191/a-500x500.jpg');
  assert.equal(shareableArtwork('HTTP://a10.gaanacdn.com/images/a.jpg'), 'https://a10.gaanacdn.com/images/a.jpg');
  assert.equal(shareableArtwork('http://i.ytimg.com/vi/x/hqdefault.jpg'), 'https://i.ytimg.com/vi/x/hqdefault.jpg');
  assert.equal(shareableArtwork('http://is1-ssl.mzstatic.com/image/a/1000x1000bb.jpg'), 'https://is1-ssl.mzstatic.com/image/a/1000x1000bb.jpg');
  assert.equal(shareableArtwork('http://example.com/cover.jpg'), '');
  assert.equal(shareableArtwork('http://saavncdn.com.evil.test/cover.jpg'), '');
});

test('a cover only this device can open never travels', () => {
  for (const local of [
    'file:///data/user/0/app/files/songs/a/cover.jpg',
    'content://media/external/images/media/12',
    'data:image/png;base64,AAAA',
    'blob:https://allegra.test/1234',
    '/api/artwork/abc',
    'cover.jpg',
    '',
    '   '
  ]) {
    assert.equal(shareableArtwork(local), '', local);
  }
  assert.equal(shareableArtwork(undefined, null), '');
});

test('links with credentials, spaces or no host are refused', () => {
  assert.equal(shareableArtwork('https://user:pass@c.saavncdn.com/a.jpg'), '');
  assert.equal(shareableArtwork('https://c.saavncdn.com/a cover.jpg'), '');
  assert.equal(shareableArtwork('https:///a.jpg'), '');
  assert.equal(shareableArtwork('https://:443/a.jpg'), '');
});

test('a link longer than a snapshot may carry is refused', () => {
  const long = `https://c.saavncdn.com/${'a'.repeat(ARTWORK_MAX_LENGTH)}.jpg`;
  assert.equal(shareableArtwork(long), '');
});

test('the first cover any device can load wins', () => {
  assert.equal(
    shareableArtwork('file:///covers/a.jpg', '', 'https://c.saavncdn.com/a-500x500.jpg', 'https://other.test/b.jpg'),
    'https://c.saavncdn.com/a-500x500.jpg'
  );
  assert.equal(shareableArtwork('https://first.test/a.jpg', 'https://second.test/b.jpg'), 'https://first.test/a.jpg');
});
