import assert from 'node:assert/strict';
import test from 'node:test';

import { SaavnLyricsProvider, saavnLyricsText } from './saavnLyrics.js';

// The shape JioSaavn answered for Rowdy Baby (_GIuQbB_) on 2026-10-17, trimmed.
const ROWDY_BABY = {
  lyrics: "Hey yen goli sodave<br>Yen curry kozhumbe<br>Un kutty puppy naan<br>Take me take me<br>Ra you′re my only girl friend&#039;u<br><br><br>Rowdy baby",
  script_tracking_url: 'https://www.jiosaavn.com/stats.php?ev=lyrics.track?source=saavn',
  lyrics_copyright: 'Lyrics powered by JioSaavn',
  snippet: 'Nee ennodiya rowdy baby'
};

function provider(answer: unknown, status = 200, seen: string[] = []): SaavnLyricsProvider {
  return new SaavnLyricsProvider({
    baseUrl: 'https://saavn.test/api.php',
    fetchImpl: async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
    }
  });
}

test('turns JioSaavn lyrics into plain lines asked by the song id', async () => {
  const seen: string[] = [];
  const found = await provider(ROWDY_BABY, 200, seen).find('_GIuQbB_');
  assert.equal(found?.source, 'JioSaavn');
  assert.equal(found?.lyrics, "Hey yen goli sodave\nYen curry kozhumbe\nUn kutty puppy naan\nTake me take me\nRa you′re my only girl friend'u\n\nRowdy baby");
  const url = new URL(seen[0] ?? '');
  assert.equal(url.searchParams.get('__call'), 'lyrics.getLyrics');
  assert.equal(url.searchParams.get('lyrics_id'), '_GIuQbB_');
});

test('answers null when the song has no lyrics, the call fails or the id is not a Saavn id', async () => {
  assert.equal(await provider({ status: 'failure', error: { msg: 'Something went wrong please try again' } }).find('B4-hLCKJ'), null);
  assert.equal(await provider({ lyrics: '   ' }).find('B4-hLCKJ'), null);
  assert.equal(await provider(ROWDY_BABY, 500).find('_GIuQbB_'), null);
  const seen: string[] = [];
  assert.equal(await provider(ROWDY_BABY, 200, seen).find('../etc/passwd'), null);
  assert.equal(seen.length, 0);
  const broken = new SaavnLyricsProvider({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await broken.find('_GIuQbB_'), null);
});

test('saavnLyricsText drops tags and keeps one blank line between verses', () => {
  assert.equal(saavnLyricsText('<b>One</b><br/>two &amp; three<br><br><br><br>four'), 'One\ntwo & three\n\nfour');
});
