import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp, type AppOptions } from './app.js';
import { createServices } from './services.js';
import { MemoryCacheStore } from './lib/cache.js';
import { LyricSites } from './providers/lyricsSites/lyricSites.js';
import { LrclibProvider } from './providers/lrclib.js';
import { LyricsService } from './services/lyrics.js';
import { MemoryVerifiedLyricsStore, type PastedLyrics } from './services/verifiedLyrics.js';

function fixture(rateLimit: AppOptions['rateLimit'] = false, store: MemoryVerifiedLyricsStore = new MemoryVerifiedLyricsStore()) {
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    const body = url.includes('/songs/') ? { success: true, data: { id: 'B4-hLCKJ', name: 'Mozhiye (From "Baththa")',
      primaryArtists: 'Sai Abhyankkar, Sid Sriram', duration: '232', language: 'tamil', image: [],
      downloadUrl: [{ quality: '320kbps', url: 'https://audio.example/song.mp4' }] } } : [];
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const services = createServices({ jwtSecret: 'test-secret', saavnApiUrl: 'https://catalog.test', fetchImpl,
    verifiedLyrics: store, accountVerifier: { verify: async token => token.startsWith('account:') ? { userId: token.slice(8), source: 'convex' } : null } });
  const cache = new MemoryCacheStore();
  const lyrics = new LyricsService(new LrclibProvider({ baseUrl: 'https://lrclib.test', fetchImpl }), cache, {
    verified: store,
    lyricSites: new LyricSites([{ languages: ['tamil'], find: async () => ({ source: { name: 'secret-site', url: 'https://private.example/words' },
      versions: [{ script: 'latin', language: 'ta', text: 'Male: First word\nFemale: Second line' }] }) }], cache)
  });
  return createApp({ version: 'test', jwtSecret: 'test-secret', services: { ...services, lyrics }, rateLimit });
}

const query = '/api/lyrics/sources?ref=saavn:B4-hLCKJ';
const auth = 'Bearer account:listener';
const times = [{ start: 10, end: 11 }, { start: 12, end: 13 }, { start: 14, end: 15 }, { start: 16, end: 17 }];

test('guests can find canonical words and preview locally, while sharing requires sign-in', async () => {
  const app = fixture();
  assert.equal((await request(app).get(query)).status, 200);
  const guest = await request(app).post('/api/auth/guest').send({});
  assert.equal((await request(app).get(query).set('Authorization', `Bearer ${guest.body.data.token}`)).status, 200);
  const sources = await request(app).get(query).set('Authorization', auth);
  assert.equal(sources.status, 200);
  assert.equal(sources.headers['cache-control'], 'no-store');
  assert.deepEqual(sources.body.data.candidates[0].lines, ['First word', 'Second line']);
  assert.ok(!JSON.stringify(sources.body).includes('secret-site'));
  assert.ok(!JSON.stringify(sources.body).includes('private.example'));
  const version = { candidateId: sources.body.data.candidates[0].id, script: 'latin', wordTimes: times, confidence: 0.95 };
  assert.equal((await request(app).post('/api/lyrics/sync').set('Authorization', `Bearer ${guest.body.data.token}`).send({ ref: 'saavn:B4-hLCKJ', versions: [version] })).status, 403);
  assert.equal((await request(app).post('/api/lyrics/sync').set('Authorization', auth).send({ ref: 'saavn:B4-hLCKJ', versions: [{ ...version, words: ['forged'] }] })).status, 400);
  assert.equal((await request(app).post('/api/lyrics/sync').send({ ref: 'saavn:B4-hLCKJ', versions: [version] })).status, 401);
  const saved = await request(app).post('/api/lyrics/sync').set('Authorization', auth).send({ ref: 'saavn:B4-hLCKJ', versions: [version] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.versions[0].saved, true);
  const publicLyrics = await request(app).get('/api/lyrics/verified?ref=saavn:B4-hLCKJ');
  assert.equal(publicLyrics.body.data.versions[0].lrc.includes('First'), true);
  for (const user of ['listener', 'another', 'third']) {
    const report = await request(app).post('/api/lyrics/report').set('Authorization', `Bearer account:${user}`).send({ ref: 'saavn:B4-hLCKJ', script: 'latin' });
    assert.equal(report.status, 200);
    assert.equal(report.body.data.hidden, user === 'third');
  }
  assert.equal((await request(app).get('/api/lyrics/verified?ref=saavn:B4-hLCKJ')).body.data, null);
});

test('finder, sync and report have independent limits and do not consume the ordinary lyrics bucket', async () => {
  const rateLimit = { lyricsSources: { windowMs: 60000, limit: 1 }, lyricsSync: { windowMs: 60000, limit: 1 }, lyricsReport: { windowMs: 60000, limit: 1 } };
  const app = fixture(rateLimit);
  assert.equal((await request(app).get(query).set('Authorization', auth)).status, 200);
  assert.equal((await request(app).get(query).set('Authorization', auth)).status, 429);
  for (const path of ['/api/lyrics/sync', '/api/lyrics/report']) {
    assert.equal((await request(app).post(path).set('Authorization', auth).send({})).status, 400);
    const limited = await request(app).post(path).set('Authorization', auth).send({});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.success, false);
  }
  assert.equal((await request(app).get('/api/lyrics/verified?ref=saavn:B4-hLCKJ')).status, 200);
});

class PastingStore extends MemoryVerifiedLyricsStore {
  private readonly pasted = new Map<string, PastedLyrics>();
  public async createPasted(candidate: PastedLyrics, passcode: string): Promise<boolean> {
    if (passcode !== 'right-passcode') return false;
    this.pasted.set(`${candidate.id}:${candidate.userId}:${candidate.ref}`, candidate);
    return true;
  }
  public async getPasted(id: string, ref: string, userId: string): Promise<PastedLyrics | null> {
    return this.pasted.get(`${id}:${userId}:${ref}`) ?? null;
  }
}

test('pasting needs an account and the passcode, takes a long paste, and its words sync like found ones', async () => {
  const app = fixture(false, new PastingStore());
  const paste = { ref: 'saavn:B4-hLCKJ', text: 'Pasted word\nAnother line', passcode: 'right-passcode' };
  assert.equal((await request(app).post('/api/lyrics/paste').send(paste)).status, 401);
  const wrong = await request(app).post('/api/lyrics/paste').set('Authorization', auth).send({ ...paste, passcode: 'nope' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.success, false);
  assert.equal((await request(app).post('/api/lyrics/paste').set('Authorization', auth).send({ ...paste, extra: 1 })).status, 400);
  // Near the 24,000-character cap with accented letters: more than the ordinary 32 KB body limit.
  const long = Array.from({ length: 1400 }, () => 'éèàùñéèàùñ éèàù').join('\n');
  assert.ok(Buffer.byteLength(JSON.stringify({ ...paste, text: long })) > 32 * 1024);
  assert.equal((await request(app).post('/api/lyrics/paste').set('Authorization', auth).send({ ...paste, text: long })).status, 200);
  const approved = await request(app).post('/api/lyrics/paste').set('Authorization', auth).send(paste);
  assert.equal(approved.status, 200);
  assert.equal(approved.headers['cache-control'], 'no-store');
  assert.equal(approved.body.data.origin, 'manual');
  assert.ok(!JSON.stringify(approved.body).includes('right-passcode'));
  const version = { candidateId: approved.body.data.id, script: 'latin', wordTimes: times, confidence: 0.95 };
  const saved = await request(app).post('/api/lyrics/sync').set('Authorization', auth).send({ ref: 'saavn:B4-hLCKJ', versions: [version] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.versions[0].saved, true);
  assert.ok((await request(app).get('/api/lyrics/verified?ref=saavn:B4-hLCKJ')).body.data.versions[0].lrc.includes('Pasted'));
});

test('pastes share the sync rate limit, so passcode guesses cannot use the lookup bucket', async () => {
  const app = fixture({ lyricsSync: { windowMs: 60000, limit: 1 } }, new PastingStore());
  const paste = { ref: 'saavn:B4-hLCKJ', text: 'Pasted word', passcode: 'nope' };
  assert.equal((await request(app).post('/api/lyrics/paste').set('Authorization', auth).send(paste)).status, 400);
  assert.equal((await request(app).post('/api/lyrics/paste').set('Authorization', auth).send(paste)).status, 429);
});
