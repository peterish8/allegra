import assert from 'node:assert/strict';
import test from 'node:test';

import { AppleRssProvider } from './appleRss.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('reads the storefront feed into titles and artists in chart order', async () => {
  const urls: string[] = [];
  const provider = new AppleRssProvider({
    fetchImpl: async (input, init) => {
      urls.push(String(input));
      assert.ok(init?.signal instanceof AbortSignal);
      return jsonResponse({ feed: {
        updated: 'Sat, 17 Oct 2026 06:43:33 +0000',
        results: [
          { name: 'Ashke', artistName: 'Karan Aujla & MXRCI', url: 'https://music.apple.com/in/album/x' },
          { name: 'No artist' },
          { name: 'Antidote', artistName: 'Karan Aujla' }
        ]
      } });
    }
  });
  assert.deepEqual(await provider.mostPlayedSongs('IN'), {
    updatedAt: '2026-10-17T06:43:33.000Z',
    entries: [{ title: 'Ashke', artist: 'Karan Aujla & MXRCI' }, { title: 'Antidote', artist: 'Karan Aujla' }]
  });
  assert.deepEqual(urls, ['https://rss.marketingtools.apple.com/api/v2/in/music/most-played/50/songs.json']);
});

test('an upstream error, a malformed body or a network failure is null, never a throw', async () => {
  assert.equal(await new AppleRssProvider({ fetchImpl: async () => jsonResponse({ private: 'details' }, 503) }).mostPlayedSongs('IN'), null);
  assert.equal(await new AppleRssProvider({ fetchImpl: async () => jsonResponse({ feed: { results: 'nope' } }) }).mostPlayedSongs('IN'), null);
  assert.equal(await new AppleRssProvider({ fetchImpl: async () => { throw new Error('offline'); } }).mostPlayedSongs('IN'), null);
});
