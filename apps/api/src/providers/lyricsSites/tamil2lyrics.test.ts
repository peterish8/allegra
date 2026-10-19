import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryCacheStore } from '../../lib/cache.js';
import { creditedNames, filmOf, LyricSites, PoliteFetcher, SITE_USER_AGENT } from './lyricSites.js';
import { pageVersions, parseTamil2LyricsPage, sitemapSlugs, slugTitle, Tamil2Lyrics } from './tamil2lyrics.js';

/** The current page layout, trimmed from the real Mozhiye page (2026-10-17). */
const MOZHIYE_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicComposition","name":"Mozhiye","lyricist":{"@type":"Person","name":"Karthik Netha"},"composer":{"@type":"Person","name":"Sai Abhyankkar"},"inLanguage":"ta","recordedAs":{"@type":"MusicRecording","byArtist":{"@type":"MusicGroup","name":"Sid Sriram"},"inAlbum":{"@type":"MusicAlbum","name":"Baththa"}}}</script>
</head><body>
<a href="https://www.tamil2lyrics.com/movie/baththa/">Baththa</a>
<div data-t2l-tab-panel="english" data-t2l-lyrics-body class="t2l-content">
<p><strong>Mozhiye Song </strong>Lyrics is the track from <span>Baththa</span> Film &#8211; 2026, Starring Vijay Sethupathi and Others. This song was sung by Sid Sriram.</p>
<div class="song-lyrics"><p><strong>Singers :</strong> Sid Sriram</p>
<p><strong>Music Director :</strong> SaiAbhyankkar</p></div>
<div class="lyrics"><div><div>
<p><strong>Music :</strong> &#8230;&#8230;&#8230;</p>
<div class="t2l-part-divider"><span></span><span>Male Part</span><span></span></div><p class="t2l-verse">Uyire uyire uyire uyire<br />
Thaene mozhiye seiye kaniye<br />
Magale &#8230;magale kanne maniye</p>
<div class="t2l-part-divider"><span>Male Part</span></div><p class="t2l-verse">Mana dhavan mugam paakkavum<br />
Porandhava koral kekavum</p>
</div></div></div>
</div></body></html>`;

/**
 * Vaazhanum Baththa's page, trimmed (2026-10-17): no structured data and no marked verses, a
 * "Singer :" credit, blank `<br>` lines inside stanzas, and a music break at each end.
 */
const VAAZHANUM_PAGE = `<html><body>
<a href="https://www.tamil2lyrics.com/movie/baththa/">Baththa</a>
<div data-t2l-tab-panel="english">
<p>Vaazhanum baththa Song Lyrics is the track from Baththa Tamil Film &#8211; 2026, Starring Vijay Sethupathi, Lijo Mol and Others. This song was sung by Sai Abhyankkar. The music was composed SaiAbhyankkar.</p>
<p><strong>Singer :</strong> Sai Abhyankkar</p>
<p><strong>Music Director :</strong> SaiAbhyankkar</p>
<p><strong>Lyricist :</strong> Karthik Netha</p>
<p><strong>Music :</strong> &#8230;&#8230;&#8230;..</p>
<p>Vaa veliya paar ulagam un ulagame maarum<br /><br />Vaan muzhukka nee parakka vaa pazhaya chitte<br /><br />Un udhattula sirippa yaar vedhachadhoo<br /><br />Pudhusaa vizhiyil neer surakkudhoo</p>
<p>Munnoru kaalathula<br /><br />Vellandhi kolathula</p>
<p><strong>Music :</strong> &#8230;&#8230;&#8230;</p>
</div></body></html>`;

/** The site's older layout: plain paragraphs, inline singer labels, a "{ }(3)" repeat and a Tamil panel. */
const OLDER_LAYOUT_PAGE = `<html><body>
<a href="https://www.tamil2lyrics.com/movie/some-film/">Some Film</a>
<div data-t2l-tab-panel="english">
<p><strong>Singers :</strong> First Singer and Second Singer</p>
<p><strong>Music by :</strong> Some Composer</p>
<p><strong>Female :</strong> First line here<br />Second line here</p>
<p><strong>Male :</strong> Third line here<br />Fourth line here (x2)</p>
</div>
<div data-t2l-tab-panel="tamil" hidden lang="ta">
<p><strong>பாடகர்கள் :</strong> ஒருவர் மற்றும் இருவர்</p>
<p><strong>பெண் :</strong> முதல் வரி<br />இரண்டாம் வரி</p>
<p><strong>பெண் :</strong> {வா வா<br /><strong>ஆண் :</strong> ஹா ஹா }(3)</p>
</div></body></html>`;

const SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc><![CDATA[https://www.tamil2lyrics.com/lyrics/mozhiye-song-lyrics/]]></loc><image:image><image:loc><![CDATA[https://www.tamil2lyrics.com/wp-content/x.png]]></image:loc></image:image></url>
<url><loc><![CDATA[https://www.tamil2lyrics.com/lyrics/kanmani-song-lyrics/]]></loc></url>
<url><loc><![CDATA[https://www.tamil2lyrics.com/lyrics/kanmani-song-lyrics-2/]]></loc></url>
<url><loc><![CDATA[https://www.tamil2lyrics.com/lyrics/kanmaniye-song-lyrics/]]></loc></url>
<url><loc><![CDATA[https://www.tamil2lyrics.com/lyrics/kanmaniyae-song-lyrics-guna/]]></loc></url>
<url><loc><![CDATA[https://www.tamil2lyrics.com/lyrics/14082/]]></loc></url>
</urlset>`;

/** A page for "Kanmaniye" from another film, by other people: a different song with the same title. */
const OTHER_KANMANI = MOZHIYE_PAGE.replace(/Baththa/g, 'Other Film').replace(/Sid Sriram/g, 'Someone Else').replace(/Sai ?Abhyankkar/g, 'Nobody');
const GUNA_KANMANI = MOZHIYE_PAGE.replace(/Baththa/g, 'Guna').replace(/Sid Sriram/g, 'Kamal Haasan').replace(/Sai ?Abhyankkar/g, 'Ilaiyaraaja');

interface StubSite {
  readonly fetched: string[];
  readonly agents: string[];
  readonly fetchImpl: typeof fetch;
}

/** A fake site serving `pages` by path (404 otherwise), recording each request. */
function stubSite(pages: Readonly<Record<string, string>>): StubSite {
  const fetched: string[] = [];
  const agents: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    fetched.push(url.pathname);
    agents.push(new Headers(init?.headers).get('User-Agent') ?? '');
    const body = pages[url.pathname];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
  };
  return { fetched, agents, fetchImpl };
}

function sitemapPages(lyricsSitemap: string): Record<string, string> {
  return {
    '/lyrics-sitemap.xml': lyricsSitemap,
    '/lyrics-sitemap2.xml': '<urlset></urlset>',
    '/lyrics-sitemap3.xml': '<urlset></urlset>',
    '/lyrics-sitemap4.xml': '<urlset></urlset>',
    '/lyrics-sitemap5.xml': '<urlset></urlset>'
  };
}

function tamil2Lyrics(stub: StubSite): Tamil2Lyrics {
  return new Tamil2Lyrics(new PoliteFetcher({ fetchImpl: stub.fetchImpl, spacingMs: 0 }), new MemoryCacheStore());
}

test('reads the current layout: verses only, with film and credits for matching', () => {
  const page = parseTamil2LyricsPage(MOZHIYE_PAGE);
  assert.equal(page.title, 'Mozhiye');
  assert.equal(page.film, 'Baththa');
  assert.ok(page.people.includes('Sid Sriram'));
  assert.ok(page.people.includes('SaiAbhyankkar'));
  assert.ok(page.people.every((name) => /\p{L}/u.test(name)), 'a "Music : ……" break is not a person');
  assert.deepEqual(page.latin, [
    ['Uyire uyire uyire uyire', 'Thaene mozhiye seiye kaniye', 'Magale ...magale kanne maniye'],
    ['Mana dhavan mugam paakkavum', 'Porandhava koral kekavum']
  ]);
  assert.deepEqual(page.native, []);
  assert.deepEqual(pageVersions(page).map((version) => version.script), ['latin']);
});

test('reads Vaazhanum Baththa: intro, credits and both music breaks gone, blank lines dropped', () => {
  const page = parseTamil2LyricsPage(VAAZHANUM_PAGE);
  assert.equal(page.film, 'Baththa');
  assert.deepEqual(page.people, ['Sai Abhyankkar', 'SaiAbhyankkar', 'Karthik Netha']);
  assert.deepEqual(page.latin, [
    ['Vaa veliya paar ulagam un ulagame maarum', 'Vaan muzhukka nee parakka vaa pazhaya chitte', 'Un udhattula sirippa yaar vedhachadhoo', 'Pudhusaa vizhiyil neer surakkudhoo'],
    ['Munnoru kaalathula', 'Vellandhi kolathula']
  ]);
});

test('reads the older layout: labels removed, repeats written out, both scripts', () => {
  const page = parseTamil2LyricsPage(OLDER_LAYOUT_PAGE);
  assert.equal(page.film, 'Some Film');
  assert.deepEqual(page.people, ['First Singer', 'Second Singer', 'Some Composer']);
  assert.deepEqual(page.latin.flat(), ['First line here', 'Second line here', 'Third line here', 'Fourth line here', 'Fourth line here']);
  assert.deepEqual(page.native.flat(), ['முதல் வரி', 'இரண்டாம் வரி', 'வா வா', 'ஹா ஹா', 'வா வா', 'ஹா ஹா', 'வா வா', 'ஹா ஹா']);
  const versions = pageVersions(page);
  assert.deepEqual(versions.map((version) => `${version.script}:${version.language}`), ['latin:ta', 'native:ta']);
  assert.ok(!versions.some((version) => /Singers|பாடகர்கள்|Female|பெண்/.test(version.text)));
});

test('sitemap slugs skip image links and numeric pages; slugs fold to their titles', () => {
  assert.deepEqual(sitemapSlugs(SITEMAP), ['mozhiye-song-lyrics', 'kanmani-song-lyrics', 'kanmani-song-lyrics-2', 'kanmaniye-song-lyrics', 'kanmaniyae-song-lyrics-guna']);
  assert.equal(slugTitle('kanmani-song-lyrics-2')?.rest, '2');
  assert.equal(slugTitle('kanmaniyae-song-lyrics-guna')?.rest, 'guna');
  assert.equal(slugTitle('kanmaniyae-song-lyrics-guna')?.key, slugTitle('kanmaniye-song-lyrics')?.key);
  assert.equal(slugTitle('14082'), null);
});

test('finds Mozhiye from its likeliest slug in one request, with an honest User-Agent', async () => {
  const stub = stubSite({ '/lyrics/mozhiye-song-lyrics/': MOZHIYE_PAGE });
  const found = await tamil2Lyrics(stub).find({ title: 'Mozhiye', artist: 'Sai Abhyankkar, Sid Sriram, Karthik Netha', film: 'Baththa', language: 'tamil' });
  assert.equal(found?.versions[0]?.script, 'latin');
  assert.match(found?.versions[0]?.text ?? '', /^Uyire uyire/);
  assert.equal(found?.source.url, 'https://www.tamil2lyrics.com/lyrics/mozhiye-song-lyrics/');
  assert.deepEqual(stub.fetched, ['/lyrics/mozhiye-song-lyrics/']);
  assert.deepEqual(stub.agents, [SITE_USER_AGENT]);
});

test('a title and credited singer match returns without waiting for the sitemap when the catalog has no film', async () => {
  const stub = stubSite({ '/lyrics/mozhiye-song-lyrics/': MOZHIYE_PAGE });
  const found = await tamil2Lyrics(stub).find({ title: 'Mozhiye', artist: 'Sai Abhyankkar, Sid Sriram' });
  assert.equal(found?.versions[0]?.script, 'latin');
  assert.deepEqual(stub.fetched, ['/lyrics/mozhiye-song-lyrics/']);
});

test('finds Vaazhanum Baththa by its two-word title, matched on film and composer', async () => {
  const stub = stubSite({ '/lyrics/vaazhanum-baththa-song-lyrics/': VAAZHANUM_PAGE });
  const found = await tamil2Lyrics(stub).find({ title: 'Vaazhanum Baththa', artist: 'Sai Abhyankkar, Karthik Netha', film: 'Baththa', language: 'tamil' });
  assert.match(found?.versions[0]?.text ?? '', /^Vaa veliya paar ulagam/);
  assert.deepEqual(stub.fetched, ['/lyrics/vaazhanum-baththa-song-lyrics/']);
});

test('a same-titled page from another film is passed over for the index entry that matches', async () => {
  const stub = stubSite({
    ...sitemapPages(SITEMAP),
    '/lyrics/kanmaniye-song-lyrics/': OTHER_KANMANI,
    '/lyrics/kanmaniyae-song-lyrics-guna/': GUNA_KANMANI
  });
  const found = await tamil2Lyrics(stub).find({ title: 'Kanmaniye', artist: 'Ilaiyaraaja, Kamal Haasan', film: 'Guna' });
  assert.equal(found?.source.url, 'https://www.tamil2lyrics.com/lyrics/kanmaniyae-song-lyrics-guna/');
  // The likeliest slug first, then the film's own slug from the index (another spelling of the title).
  const pages = stub.fetched.filter((path) => path.startsWith('/lyrics/'));
  assert.deepEqual(pages, ['/lyrics/kanmaniye-song-lyrics/', '/lyrics/kanmaniyae-song-lyrics-guna/']);
  assert.ok(!stub.fetched.some((path) => path.includes('?s=')), 'the site search is never used');
});

test('nothing that matches by film or credits is no answer, after at most three pages', async () => {
  const stub = stubSite({ ...sitemapPages(SITEMAP), '/lyrics/kanmani-song-lyrics/': OTHER_KANMANI, '/lyrics/kanmani-song-lyrics-2/': OTHER_KANMANI });
  assert.equal(await tamil2Lyrics(stub).find({ title: 'Kanmani', artist: 'Anirudh Ravichander', film: 'Leo' }), null);
  assert.ok(stub.fetched.filter((path) => path.startsWith('/lyrics/')).length <= 3);
});

test('LyricSites asks only for languages a site covers, and caches what it found', async () => {
  const stub = stubSite({ '/lyrics/mozhiye-song-lyrics/': MOZHIYE_PAGE });
  const sites = new LyricSites([tamil2Lyrics(stub)], new MemoryCacheStore());
  assert.equal(await sites.find({ title: 'Mozhiye', artist: 'Sid Sriram', language: 'english' }), null);
  assert.deepEqual(stub.fetched, []);
  const first = await sites.find({ title: 'Mozhiye', artist: 'Sid Sriram', film: 'Baththa', language: 'tamil' });
  const second = await sites.find({ title: 'Mozhiye', artist: 'Sid Sriram', film: 'Baththa', language: 'Tamil' });
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(stub.fetched.length, 1);
});

test('a site that fails is no answer, never an error', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error('connection reset');
  };
  const sites = new LyricSites([new Tamil2Lyrics(new PoliteFetcher({ fetchImpl, spacingMs: 0 }), new MemoryCacheStore())], new MemoryCacheStore());
  assert.equal(await sites.find({ title: 'Mozhiye', artist: 'Sid Sriram' }), null);
});

test('the polite fetcher spaces requests to one host', async () => {
  const starts: number[] = [];
  const fetchImpl: typeof fetch = async () => {
    starts.push(Date.now());
    return new Response('ok');
  };
  const fetcher = new PoliteFetcher({ fetchImpl, spacingMs: 60 });
  await Promise.all([1, 2, 3].map((n) => fetcher.text(new URL(`https://example.test/${n}`))));
  assert.ok((starts[2] ?? 0) - (starts[0] ?? 0) >= 110, `spaced: ${starts.join(', ')}`);
});

test('the film comes from the title or a soundtrack album; credits split into names', () => {
  assert.equal(filmOf('Mozhiye (From "Baththa")', undefined), 'Baththa');
  assert.equal(filmOf('Vaazhanum Baththa', 'Baththa (Original Motion Picture Soundtrack)'), 'Baththa');
  assert.equal(filmOf('Mozhiye', 'Mozhiye (From “Baththa”)'), 'Baththa');
  assert.equal(filmOf('Song', 'Some Album'), undefined);
  assert.deepEqual(creditedNames('Sai Abhyankkar, Sid Sriram & Karthik Netha'), creditedNames('SaiAbhyankkar,Sid Sriram,Karthik Netha'));
});
