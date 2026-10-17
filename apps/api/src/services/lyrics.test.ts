import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import { BetterLyricsProvider } from '../providers/betterlyrics.js';
import { LrclibProvider } from '../providers/lrclib.js';
import { LyricSites, type LyricSite, type SiteLyrics, type SiteQuery } from '../providers/lyricsSites/lyricSites.js';
import { SaavnLyricsProvider } from '../providers/saavnLyrics.js';
import { matchKey } from '../shared/songRef.js';
import { LyricsService, cleanLyricsQuery } from './lyrics.js';
import { MemoryVerifiedLyricsStore } from './verifiedLyrics.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('lyrics query cleaning strips decorations and splits artist-title', () => {
  assert.deepEqual(
    cleanLyricsQuery('Song (Lyrics) (Official Video) (Audio)', 'Unknown Artist'),
    { title: 'Song', artist: 'Unknown Artist' }
  );
  assert.deepEqual(
    cleanLyricsQuery('Artist Name - Track Title', 'Unknown Artist'),
    { title: 'Track Title', artist: 'Artist Name' }
  );
});

test('LRCLIB /get is tried before /search and duration is forwarded', async () => {
  const urls: string[] = [];
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        urls.push(String(input));
        return json({
          trackName: 'Night Drive',
          syncedLyrics: '[00:01.00] go\n[00:02.00] further\n[00:03.00] now\n[00:04.00] stay\n[00:05.00] here\n[00:06.00] with\n[00:07.00] me\n[00:08.00] until\n[00:09.00] dawn\n[00:10.00] light',
          duration: 200
        });
      }
    }),
    new MemoryCacheStore()
  );

  const payload = await service.find('Night Drive', 'Driver', 200, false);
  assert.equal(payload?.type, 'synced');
  assert.equal(payload?.source, 'LRCLIB');
  assert.ok((payload?.lines.length ?? 0) >= 10);
  assert.ok(urls[0]?.includes('/get?'));
  assert.ok(urls[0]?.includes('duration=200'));
  assert.equal(urls.some((url) => url.includes('/search?')), false);
});

test('404 and HTML bodies fall through to search', async () => {
  const urls: string[] = [];
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/get?')) {
          if (urls.filter((item) => item.includes('/get?')).length === 1) {
            return json({}, 404);
          }
          return json({ trackName: 'x', syncedLyrics: '<html><div>error</div></html>' });
        }
        return json([{
          trackName: 'Night Drive',
          syncedLyrics: '[0:3.75]Hello\n[00:10.25]World',
          duration: 200
        }]);
      }
    }),
    new MemoryCacheStore()
  );

  const from404 = await service.find('Night Drive', 'Driver', 200, false);
  assert.equal(from404?.source, 'LRCLIB-search');
  assert.equal(from404?.lines[0]?.text, 'Hello');

  const fromHtml = await service.find('Other', 'Driver', 200, false);
  assert.equal(fromHtml?.source, 'LRCLIB-search');
  assert.ok(urls.filter((url) => url.includes('/search?')).length >= 2);
});

test('plain lyrics interpolate and syncedOnly ignores unsynced hits', async () => {
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        if (String(input).includes('/get?')) {
          return json({}, 404);
        }
        return json([{ trackName: 'Night Drive', plainLyrics: 'one\ntwo\nthree', duration: 90 }]);
      }
    }),
    new MemoryCacheStore()
  );

  const plain = await service.find('Night Drive', 'Driver', 90, false);
  assert.equal(plain?.type, 'plain');
  assert.equal(plain?.source, 'interpolated');
  assert.deepEqual(plain?.lines.map((line) => line.timestamp), [0, 30, 60]);

  const syncedOnly = await service.find('Night Drive', 'Driver', 90, true);
  assert.equal(syncedOnly, null);
});

test('positive hits cache for 30 days and misses cache for 24 hours', async () => {
  const sets: Array<{ key: string; ttl: number }> = [];
  const cache = new MemoryCacheStore();
  const originalSet = cache.set.bind(cache);
  cache.set = async (key, value, ttl) => {
    sets.push({ key, ttl });
    return originalSet(key, value, ttl);
  };

  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        if (String(input).includes('miss')) {
          return json({}, 404);
        }
        if (String(input).includes('/get?')) {
          return json({ trackName: 'Hit', syncedLyrics: '[00:01.00] a', duration: 10 });
        }
        return json([]);
      }
    }),
    cache
  );

  await service.find('Hit', 'Artist', 10, false);
  await service.find('miss song', 'Artist', 10, false);

  assert.equal(sets.some((entry) => entry.ttl === 2_592_000), true);
  assert.equal(sets.some((entry) => entry.key.includes('miss') && entry.ttl === 86_400), true);
});

const SYNCED = Array.from({ length: 10 }, (_, index) => `[00:${String(index + 1).padStart(2, '0')}.00] line ${index + 1}`).join(String.fromCharCode(10));

test('catalog decorations like (From "Jawan") are stripped from the title', () => {
  assert.deepEqual(cleanLyricsQuery('Chaleya (From "Jawan")', 'Kumaar'), { title: 'Chaleya', artist: 'Kumaar' });
  assert.equal(cleanLyricsQuery('Yeshanagula (From "The Paradise") (Telugu)', 'A').title, 'Yeshanagula');
  assert.equal(cleanLyricsQuery('Tera Mera Rishta - From "Awarapan 2"', 'A').title, 'Tera Mera Rishta');
});

test('a multi-artist credit is retried with the lead artist', async () => {
  const artists: string[] = [];
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const artist = url.searchParams.get('artist_name') ?? '';
        artists.push(`${url.pathname.split('/').pop()}:${artist}`);
        if (url.pathname.endsWith('/get') && artist === 'Anirudh Ravichander') {
          return json({ trackName: 'Chaleya', syncedLyrics: SYNCED, duration: 267 });
        }
        return url.pathname.endsWith('/search') ? json([]) : json({}, 404);
      }
    }),
    new MemoryCacheStore()
  );

  const payload = await service.find('Chaleya (From "Jawan")', 'Anirudh Ravichander, Arijit Singh, Shilpa Rao', 267, false);
  assert.equal(payload?.type, 'synced');
  assert.ok(artists.includes('get:Anirudh Ravichander, Arijit Singh, Shilpa Rao'));
  assert.ok(artists.includes('get:Anirudh Ravichander'));
});

test('a loose LRCLIB search never returns a different song', async () => {
  // Every attempt after the exact one must still resemble the requested title.
  const result = await new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const looseAttempt = url.searchParams.get('artist_name') !== 'Driver, Guest';
        if (url.pathname.endsWith('/search') && looseAttempt) {
          return json([{ trackName: 'Completely Different Song', syncedLyrics: SYNCED, duration: 200 }]);
        }
        return json({}, 404);
      }
    }),
    new MemoryCacheStore()
  ).find('Night Drive', 'Driver, Guest', 200, false);
  assert.equal(result, null);
});

test('BetterLyrics answers when LRCLIB has nothing', async () => {
  const ttml = '<tt><body><p begin="1.0">first line</p><p begin="3.5">second line</p></body></tt>';
  const service = new LyricsService(
    new LrclibProvider({ baseUrl: 'https://lrclib.test/api', fetchImpl: async () => json({}, 404) }),
    new MemoryCacheStore(),
    { betterLyrics: new BetterLyricsProvider({ baseUrl: 'https://better.test', fetchImpl: async () => json({ ttml }) }) }
  );

  const payload = await service.find('Some Song', 'Some Artist', 180, false);
  assert.equal(payload?.source, 'BetterLyrics');
  assert.equal(payload?.type, 'synced');
  assert.equal(payload?.lines.length, 2);
});

test('alternatives gathers every distinct version, drops duplicates and other songs, synced first', async () => {
  const synced = (words: string[]): string => words.map((word, index) => `[00:${String(index + 1).padStart(2, '0')}.00] ${word}`).join('\n');
  const tamil = synced(['அவ', 'போல', 'இங்க', 'யாருனு', 'காட்டு', 'வெரல்', 'பட்டா', 'நூறு']);
  const romanized = synced(['ava', 'pola', 'inga', 'yaarunu', 'kaattu', 'veral', 'patta', 'nooru']);
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async () =>
        json([
          { id: 1, trackName: 'Pavazha Malli', artistName: 'Vivek', syncedLyrics: tamil, duration: 252 },
          // The same words filed twice: one version, not two.
          { id: 2, trackName: 'Pavazha Malli', artistName: 'Sai Abhyankkar', syncedLyrics: tamil, duration: 252 },
          { id: 3, trackName: 'Pavazha Malli', artistName: 'Vivek', plainLyrics: 'ava pola inga\nyaarunu kaattu', duration: 250 },
          { id: 4, trackName: 'Pavazha Malli', artistName: 'Vivek', syncedLyrics: romanized, duration: 251 },
          { id: 5, trackName: 'A Different Song', artistName: 'Vivek', syncedLyrics: synced(['not', 'this', 'one']), duration: 252 }
        ])
    }),
    new MemoryCacheStore()
  );

  const versions = await service.alternatives('Pavazha Malli (From "Think Indie")', 'Vivek, Sai Abhyankkar', 252, false);
  assert.deepEqual(versions.map((version) => version.type), ['synced', 'synced', 'plain']);
  assert.equal(versions.some((version) => version.lines.some((line) => line.text === 'not')), false);
  assert.ok(versions[0]?.matchReason.startsWith('Vivek — Pavazha Malli'));
});

test('alternatives answers an empty list when no provider has another version', async () => {
  const service = new LyricsService(
    new LrclibProvider({ baseUrl: 'https://lrclib.test/api', fetchImpl: async () => json([]) }),
    new MemoryCacheStore()
  );
  assert.deepEqual(await service.alternatives('Nothing Here', 'Nobody', 200, false), []);
});

test('a lookup past its budget answers null now and finishes in the background for the next ask', async () => {
  const synced = '[00:01.00] one\n[00:02.00] two\n[00:03.00] three\n[00:04.00] four\n[00:05.00] five';
  let requests = 0;
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 120));
        return json({ trackName: 'Slow Song', syncedLyrics: synced, duration: 200 });
      }
    }),
    new MemoryCacheStore(),
    { budgetMs: 30 }
  );

  const started = Date.now();
  assert.equal(await service.find('Slow Song', 'Someone', 200, false), null);
  assert.ok(Date.now() - started < 100, 'answered at the budget, not when the provider did');
  // Asking again while the first lookup still runs joins it rather than starting a second.
  assert.equal(await service.find('Slow Song', 'Someone', 200, false), null);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const later = await service.find('Slow Song', 'Someone', 200, false);
  assert.equal(later?.type, 'synced');
  assert.equal(requests, 1);
});

const MOZHIYE = { ref: 'saavn:B4-hLCKJ', matchKey: matchKey('Mozhiye', 'Sai Abhyankkar'), title: 'Mozhiye', artist: 'Sai Abhyankkar', duration: 232 };
const syncedVersion = (script: 'latin' | 'native', lrc: string) => ({
  script,
  language: 'ta',
  lrc,
  source: { name: 'site', url: 'https://example.test/mozhiye' },
  confidence: 0.8,
  syncedBy: 'listener-1'
});
const emptyLrclib = () => new LrclibProvider({ baseUrl: 'https://lrclib.test/api', fetchImpl: async (input) => json(String(input).includes('/get?') ? {} : [], String(input).includes('/get?') ? 404 : 200) });
const saavnAnswer = (lyrics: string | null, seen: string[] = []) => new SaavnLyricsProvider({
  baseUrl: 'https://saavn.test/api.php',
  fetchImpl: async (input) => {
    seen.push(String(input));
    return json(lyrics === null ? { status: 'failure' } : { lyrics });
  }
});

test('listener-synced lyrics answer first, English before the song\'s own script, with word timings', async () => {
  const verified = new MemoryVerifiedLyricsStore();
  await verified.submit(MOZHIYE, syncedVersion('native', '[00:12.00]மொழியே\n[00:16.00]மொழியே மொழியே'));
  await verified.submit(MOZHIYE, syncedVersion('latin', '[00:12.00]<00:12.000>Mozhiye <00:12.800>mozhiye<00:13.600>\n[00:16.00]Un mozhiye'));
  const lrclibCalls: string[] = [];
  const service = new LyricsService(
    new LrclibProvider({ baseUrl: 'https://lrclib.test/api', fetchImpl: async (input) => { lrclibCalls.push(String(input)); return json({}, 404); } }),
    new MemoryCacheStore(),
    { verified }
  );

  const payload = await service.find('Mozhiye (From "Baththa")', 'Sai Abhyankkar, Sid Sriram', 232, false, { ref: MOZHIYE.ref });
  assert.equal(payload?.source, 'Allegra (English)');
  assert.equal(payload?.type, 'synced');
  assert.equal(payload?.lines[0]?.words?.length, 2);
  assert.equal(lrclibCalls.length, 0, 'no provider is asked when listeners already synced it');

  const versions = await service.alternatives('Mozhiye (From "Baththa")', 'Sai Abhyankkar, Sid Sriram', 232, false, { ref: MOZHIYE.ref });
  assert.deepEqual(versions.slice(0, 2).map((version) => version.source), ['Allegra (English)', 'Allegra (Tamil)']);
});

test('a hidden sync is not served, and a song with no ref is matched by title, artist and length', async () => {
  const verified = new MemoryVerifiedLyricsStore();
  await verified.submit(MOZHIYE, syncedVersion('latin', '[00:12.00]Mozhiye'));
  const service = new LyricsService(emptyLrclib(), new MemoryCacheStore(), { verified });

  assert.equal((await service.verified(undefined, 'Mozhiye', 'Sai Abhyankkar', 233))?.ref, MOZHIYE.ref);
  assert.equal(await service.verified(undefined, 'Mozhiye', 'Sai Abhyankkar', 300), null, 'a different length is a different recording');

  await verified.setHidden(MOZHIYE.ref, 'latin', true);
  await service.forgetVerified(MOZHIYE.ref);
  assert.equal(await service.verified(MOZHIYE.ref, 'Mozhiye', 'Sai Abhyankkar', 232), null);
  assert.equal(await service.verified(undefined, 'Mozhiye', 'Sai Abhyankkar', 233), null, 'moderation also invalidates title/artist lookups');
});

test('case-sensitive Saavn ids never share a lyrics cache entry', async () => {
  const seen: string[] = [];
  const service = new LyricsService(emptyLrclib(), new MemoryCacheStore(), {
    saavnLyrics: new SaavnLyricsProvider({
      baseUrl: 'https://saavn.test/api.php',
      fetchImpl: async (input) => {
        const id = new URL(String(input)).searchParams.get('lyrics_id');
        seen.push(id ?? '');
        return json({ lyrics: `Words for ${id}<br>Second line` });
      }
    })
  });
  const first = await service.find('Song', 'Artist', 200, false, { ref: 'saavn:AbC' });
  const second = await service.find('Song', 'Artist', 200, false, { ref: 'saavn:abc' });
  assert.notEqual(first?.lines[0]?.text, second?.lines[0]?.text);
  assert.deepEqual(seen, ['AbC', 'abc']);
});

test('JioSaavn plain lyrics answer for a Saavn song when the providers have none, and lead Other lyrics', async () => {
  const seen: string[] = [];
  const service = new LyricsService(emptyLrclib(), new MemoryCacheStore(), {
    saavnLyrics: saavnAnswer('Hey yen goli sodave<br>Yen curry kozhumbe<br>Un kutty puppy naan', seen),
    verified: new MemoryVerifiedLyricsStore()
  });

  const payload = await service.find('Rowdy Baby', 'Dhanush', 281, false, { ref: 'saavn:_GIuQbB_' });
  assert.equal(payload?.source, 'JioSaavn');
  assert.equal(payload?.type, 'plain');
  assert.deepEqual(payload?.lines.map((line) => line.text), ['Hey yen goli sodave', 'Yen curry kozhumbe', 'Un kutty puppy naan']);

  const versions = await service.alternatives('Rowdy Baby', 'Dhanush', 281, false, { ref: 'saavn:_GIuQbB_' });
  assert.equal(versions[0]?.source, 'JioSaavn', 'only version, so first');
  // Asked once, then answered from the cache.
  assert.equal(seen.length, 1);
});

test('JioSaavn is not asked for Gaana songs, without a ref, or when only synced lyrics will do', async () => {
  const seen: string[] = [];
  const service = new LyricsService(emptyLrclib(), new MemoryCacheStore(), { saavnLyrics: saavnAnswer('Line one<br>Line two', seen) });
  assert.equal(await service.find('Song', 'Artist', 200, false, { ref: 'gaana:abc' }), null);
  assert.equal(await service.find('Song', 'Artist', 200, false), null);
  assert.equal(await service.find('Song', 'Artist', 200, true, { ref: 'saavn:abc' }), null);
  assert.equal(seen.length, 0);
});

test('a provider answer still beats JioSaavn, and a JioSaavn miss is a plain miss', async () => {
  const service = new LyricsService(
    new LrclibProvider({ baseUrl: 'https://lrclib.test/api', fetchImpl: async () => json({ trackName: 'Rowdy Baby', syncedLyrics: '[00:01.00] one\n[00:02.00] two', duration: 281 }) }),
    new MemoryCacheStore(),
    { saavnLyrics: saavnAnswer('Plain one<br>Plain two') }
  );
  assert.equal((await service.find('Rowdy Baby', 'Dhanush', 281, false, { ref: 'saavn:_GIuQbB_' }))?.source, 'LRCLIB');

  const none = new LyricsService(emptyLrclib(), new MemoryCacheStore(), { saavnLyrics: saavnAnswer(null) });
  assert.equal(await none.find('Mozhiye', 'Sai Abhyankkar', 232, false, { ref: MOZHIYE.ref }), null);
});

/** A lyric site that answers like tamil2lyrics does for Mozhiye, counting what it is asked. */
function fakeSite(asked: SiteQuery[], versions: SiteLyrics['versions'] = [
  { script: 'latin', language: 'ta', text: 'Uyire uyire uyire uyire\nThaene mozhiye seiye kaniye\n\nMagale magale kanne maniye\nMana dhavan mugam paakkavum' },
  { script: 'native', language: 'ta', text: 'உயிரே உயிரே\nதேனே மொழியே\nமகளே மகளே\nமன தவன் முகம்' }
]): LyricSites {
  const site: LyricSite = {
    languages: ['tamil'],
    find: async (query) => {
      asked.push(query);
      return { versions, source: { name: 'tamil2lyrics', url: 'https://www.tamil2lyrics.com/lyrics/mozhiye-song-lyrics/' } };
    }
  };
  return new LyricSites([site], new MemoryCacheStore());
}

test('a lyric site answers Mozhiye when providers and JioSaavn have nothing, never naming the site', async () => {
  const asked: SiteQuery[] = [];
  const service = new LyricsService(emptyLrclib(), new MemoryCacheStore(), {
    saavnLyrics: saavnAnswer(null),
    lyricSites: fakeSite(asked),
    siteGraceMs: 0
  });
  const hints = { ref: MOZHIYE.ref, album: 'Mozhiye (From "Baththa")', language: 'tamil' };

  const payload = await service.find('Mozhiye (From "Baththa")', 'Sai Abhyankkar, Sid Sriram, Karthik Netha', 232, false, hints);
  assert.equal(payload?.type, 'plain');
  assert.equal(payload?.source, 'Found online (English)');
  assert.deepEqual(payload?.lines.slice(0, 2).map((line) => line.text), ['Uyire uyire uyire uyire', 'Thaene mozhiye seiye kaniye']);
  // The site is asked with the bare title and the film, which is what its pages are filed under.
  assert.deepEqual(asked[0], { title: 'Mozhiye', artist: 'Sai Abhyankkar, Sid Sriram, Karthik Netha', film: 'Baththa', language: 'tamil' });

  const versions = await service.alternatives('Mozhiye (From "Baththa")', 'Sai Abhyankkar, Sid Sriram, Karthik Netha', 232, false, hints);
  assert.deepEqual(versions.map((version) => version.source), [], 'raw site text is not an Other lyrics version');
  const candidates = await service.sources('Mozhiye (From "Baththa")', 'Sai Abhyankkar, Sid Sriram, Karthik Netha', 232, hints);
  assert.deepEqual(candidates.map(candidate => candidate.script), ['latin', 'native']);
  assert.ok(!JSON.stringify([payload, versions]).includes('tamil2lyrics'), 'the site name never reaches a listener');
});

test('the sync finder includes exact timed provider lyrics first and marks matching site words already synced', async () => {
  const service = new LyricsService(new LrclibProvider({
    baseUrl: 'https://lrclib.test/api',
    fetchImpl: async input => String(input).includes('/get?')
      ? json({ trackName: 'Mozhiye', artistName: 'Singer', duration: 232, syncedLyrics: '[00:00.00]\n[00:10.00]First line\n[00:15.00]Second line' })
      : json([])
  }), new MemoryCacheStore(), { lyricSites: fakeSite([], [{ script: 'latin', language: 'ta', text: 'First line\nSecond line' }]) });
  const found = await service.sources('Mozhiye', 'Singer', 232, { ref: MOZHIYE.ref, language: 'tamil' });
  assert.equal(found[0]?.origin, 'provider');
  assert.equal(found[0]?.synced, true);
  assert.deepEqual(found[0]?.lines, ['First line', 'Second line']);
  assert.equal(found[1]?.origin, 'site');
  assert.equal(found[1]?.synced, true);
});

test('a song with synced lyrics (Rowdy Baby) never asks a lyric site, nor do other languages or synced-only lookups', async () => {
  const asked: SiteQuery[] = [];
  const quick = new LyricsService(
    new LrclibProvider({ baseUrl: 'https://lrclib.test/api', fetchImpl: async () => json({ trackName: 'Rowdy Baby', syncedLyrics: '[00:01.00] one\n[00:02.00] two', duration: 281 }) }),
    new MemoryCacheStore(),
    { lyricSites: fakeSite(asked), siteGraceMs: 200 }
  );
  assert.equal((await quick.find('Rowdy Baby', 'Dhanush', 281, false, { language: 'tamil' }))?.source, 'LRCLIB');

  const empty = new LyricsService(emptyLrclib(), new MemoryCacheStore(), { lyricSites: fakeSite(asked), siteGraceMs: 0 });
  assert.equal(await empty.find('Blinding Lights', 'The Weeknd', 200, false, { language: 'english' }), null);
  assert.equal(await empty.find('Mozhiye', 'Sid Sriram', 232, true, { language: 'tamil' }), null);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(asked.length, 0);
});

test('JioSaavn\'s own lyrics still beat a lyric site', async () => {
  const asked: SiteQuery[] = [];
  const service = new LyricsService(emptyLrclib(), new MemoryCacheStore(), {
    saavnLyrics: saavnAnswer('First official line<br>Second official line'),
    lyricSites: fakeSite(asked),
    siteGraceMs: 0
  });
  const song = { ref: 'saavn:Abc123', language: 'tamil' };
  assert.equal((await service.find('Some Song', 'Some Singer', 240, false, song))?.source, 'JioSaavn');
  const versions = await service.alternatives('Some Song', 'Some Singer', 240, false, song);
  assert.deepEqual(versions.map((version) => version.source), ['JioSaavn']);
});

const slowLrclib = (ms: number) => new LrclibProvider({
  baseUrl: 'https://lrclib.test/api',
  fetchImpl: async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return json({}, 404);
  }
});

test('plain lyrics in hand end the wait after the grace period instead of the whole budget', async () => {
  const service = new LyricsService(slowLrclib(400), new MemoryCacheStore(), { lyricSites: fakeSite([]), budgetMs: 5_000, siteGraceMs: 50 });
  const started = Date.now();
  const payload = await service.find('Mozhiye', 'Sid Sriram', 232, false, { language: 'tamil' });
  assert.equal(payload?.source, 'Found online (English)');
  assert.ok(Date.now() - started < 1_000, `answered after the grace period, not the 5 s budget (${Date.now() - started} ms)`);
});

test('a site answer still arrives when the budget is shorter than the grace period', async () => {
  const service = new LyricsService(slowLrclib(400), new MemoryCacheStore(), { lyricSites: fakeSite([]), budgetMs: 150, siteGraceMs: 200 });
  const payload = await service.find('Mozhiye', 'Sid Sriram', 232, false, { language: 'tamil' });
  assert.equal(payload?.source, 'Found online (English)');
});
