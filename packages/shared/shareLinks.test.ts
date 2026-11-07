import assert from 'node:assert/strict';
import test from 'node:test';
import {
  androidIntentUrl, isShareCode, parseSharePath, parseShareUrl, playlistShareUrl, shareUrlFor, songShareUrl,
} from './shareLinks.ts';

test('a song link names the catalog song and carries its title and artist', () => {
  const url = songShareUrl('saavn:B4-hLCKJ', 'Vaazhanum Baththa', 'Sai Abhyankkar, Karthik Netha');
  assert.equal(url, 'https://allegravibe.vercel.app/song/saavn/B4-hLCKJ?t=Vaazhanum%20Baththa&a=Sai%20Abhyankkar%2C%20Karthik%20Netha');
  assert.deepEqual(parseShareUrl(url), { kind: 'song', ref: 'saavn:B4-hLCKJ', title: 'Vaazhanum Baththa', artist: 'Sai Abhyankkar, Karthik Netha' });
});

test('a song with no catalog id is shared by name and found again by name', () => {
  const url = songShareUrl(null, 'Tarantino', 'LISA');
  assert.equal(url, 'https://allegravibe.vercel.app/song/find?t=Tarantino&a=LISA');
  assert.deepEqual(parseShareUrl(url), { kind: 'song', ref: null, title: 'Tarantino', artist: 'LISA' });
  assert.equal(parseSharePath('/song/find'), null, 'nothing to find');
});

test('a public playlist link is its share code, lower case', () => {
  assert.equal(playlistShareUrl('ABCD2345'), 'https://allegravibe.vercel.app/shared/abcd2345');
  assert.deepEqual(parseShareUrl('https://allegravibe.vercel.app/shared/ABCD2345?utm=x'), { kind: 'playlist', code: 'abcd2345' });
  assert.equal(shareUrlFor({ kind: 'playlist', code: 'abcd2345' }), 'https://allegravibe.vercel.app/shared/abcd2345');
});

test('only our hosts and our paths are share links', () => {
  assert.equal(parseShareUrl('https://evil.example/song/saavn/abc'), null);
  assert.equal(parseShareUrl('https://allegravibe.vercel.app/library'), null);
  assert.equal(parseShareUrl('https://allegravibe.vercel.app/song/spotify/abc'), null, 'a source we cannot play');
  assert.equal(parseShareUrl('https://allegravibe.vercel.app/shared/abc0l1'), null, 'not the share alphabet');
  assert.deepEqual(parseShareUrl('https://www.allegra.music/shared/abcd2345'), { kind: 'playlist', code: 'abcd2345' });
  assert.equal(parseShareUrl('lyricflow://open/stream'), null);
  assert.equal(parseShareUrl('https://allegravibe.vercel.app/song/saavn/%E0%A4'), null, 'a broken escape');
});

test('share codes follow the API alphabet', () => {
  assert.equal(isShareCode('abcd2345'), true);
  assert.equal(isShareCode('abcd'), false);
  assert.equal(isShareCode('abcdo123'), false);
});

test('Android "Open in LuvLyrics" hands the same link to the app and falls back to the page', () => {
  const page = 'https://allegravibe.vercel.app/shared/abcd2345';
  assert.equal(androidIntentUrl(page),
    'intent://allegravibe.vercel.app/shared/abcd2345#Intent;scheme=https;package=com.lyricflow.app;S.browser_fallback_url=https%3A%2F%2Fallegravibe.vercel.app%2Fshared%2Fabcd2345;end');
});
