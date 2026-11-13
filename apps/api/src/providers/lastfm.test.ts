import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { LASTFM_API_ROOT, LASTFM_AUTH_PAGE, LastfmClient, LastfmError, lastfmSignature } from './lastfm.js';

const API_KEY = '0123456789abcdef0123456789abcdef';
const SECRET = 's3cr3t';
const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

interface Captured {
  readonly url: string;
  readonly body: URLSearchParams;
}

/** A fetch stand-in that records each POST body and answers with [respond]'s JSON. */
function fakeLastfm(respond: (body: URLSearchParams) => { readonly json: unknown; readonly status?: number }): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    calls.push({ url: String(input), body });
    const reply = respond(body);
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Recomputes the signature from the bytes that were actually sent, independently of the code under test. */
function signatureOverBody(body: URLSearchParams, secret: string): { sent: string; recomputed: string } {
  const sent = body.get('api_sig') ?? '';
  const names = [...body.keys()].filter((name) => name !== 'api_sig' && name !== 'format').sort();
  const base = names.map((name) => `${name}${body.get(name) ?? ''}`).join('');
  return { sent, recomputed: md5(base + secret) };
}

test('the docs example signs to the documented md5', () => {
  assert.equal(lastfmSignature({ api_key: 'xxxxxxxx', method: 'auth.getSession', token: 'xxxxxxx' }, 'mysecret'), '68afb32bee072407a63b6c41f3e1e2b4');
});

test('auth.getSession signs api_key, method and token', () => {
  assert.equal(lastfmSignature({ api_key: API_KEY, method: 'auth.getSession', token: 'TOKEN123' }, SECRET), 'b1fc43025345b55fc157500c52c1cbcf');
});

test('a batch scrobble signs its sorted array-notation names', () => {
  const params = {
    method: 'track.scrobble',
    api_key: API_KEY,
    sk: 'SESSIONKEY',
    'artist[0]': 'Bj\u{f6}rk',
    'track[0]': 'J\u{f3}ga',
    'timestamp[0]': '1700000000',
    'artist[1]': 'A. R. Rahman',
    'track[1]': 'Jai Ho',
    'timestamp[1]': '1700000300',
    'duration[1]': '319'
  };
  assert.equal(lastfmSignature(params, SECRET), 'b391eb61195ff2a99977a8fc131eee41');
});

test('a now-playing call signs its plain names', () => {
  const params = { method: 'track.updateNowPlaying', api_key: API_KEY, sk: 'SESSIONKEY', artist: 'Bj\u{f6}rk', track: 'J\u{f3}ga' };
  assert.equal(lastfmSignature(params, SECRET), '6b121cd8e63a3b24aa5d9be5bdda1992');
});

test('array-notation names sort as plain strings, so artist[10] comes before artist[1]', () => {
  const values: Record<string, string> = {};
  for (let i = 0; i < 12; i += 1) values[`artist[${i}]`] = `v${i}`;
  const order = ['artist[0]', 'artist[10]', 'artist[11]', 'artist[1]', 'artist[2]', 'artist[3]', 'artist[4]', 'artist[5]', 'artist[6]', 'artist[7]', 'artist[8]', 'artist[9]'];
  const expected = md5(order.map((name) => `${name}${values[name]}`).join('') + SECRET);
  assert.equal(lastfmSignature(values, SECRET), expected);
});

test('format and callback never count toward the signature', () => {
  const base = { method: 'auth.getSession', api_key: API_KEY, token: 'TOKEN123' };
  assert.equal(lastfmSignature({ ...base, format: 'json', callback: 'https://example.test/cb' }, SECRET), lastfmSignature(base, SECRET));
  assert.notEqual(lastfmSignature({ ...base, format: 'json' }, SECRET), lastfmSignature({ ...base }, 'other'));
});

test('a batch scrobble builds array notation and signs exactly the bytes it sends', async () => {
  const { fetchImpl, calls } = fakeLastfm(() => ({
    json: {
      scrobbles: {
        '@attr': { accepted: '2', ignored: '0' },
        scrobble: [{ ignoredMessage: { code: '0', '#text': '' } }, { ignoredMessage: { code: '0', '#text': '' } }]
      }
    }
  }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  const outcome = await client.scrobble('SESSIONKEY', [
    { artist: 'Bj\u{f6}rk', track: 'J\u{f3}ga', timestamp: 1_700_000_000 },
    { artist: 'A. R. Rahman', track: 'Jai Ho', timestamp: 1_700_000_300, durationSec: 319 }
  ]);

  assert.deepEqual(outcome, { accepted: 2, ignored: [] });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, LASTFM_API_ROOT);
  assert.ok(LASTFM_API_ROOT.startsWith('https://'));
  assert.equal(call.body.get('method'), 'track.scrobble');
  assert.equal(call.body.get('artist[1]'), 'A. R. Rahman');
  assert.equal(call.body.get('duration[1]'), '319');
  assert.equal(call.body.get('format'), 'json');
  assert.equal(call.body.has('artist'), false);
  const { sent, recomputed } = signatureOverBody(call.body, SECRET);
  assert.equal(sent, recomputed);
  assert.equal(sent, 'b391eb61195ff2a99977a8fc131eee41');
});

test('an album is sent per index and covered by the signature', async () => {
  const { fetchImpl, calls } = fakeLastfm(() => ({
    json: { scrobbles: { '@attr': { accepted: '1', ignored: '0' }, scrobble: { ignoredMessage: { code: '0' } } } }
  }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  await client.scrobble('SESSIONKEY', [{ artist: 'A', track: 'B', timestamp: 1_700_000_000, album: 'Album' }]);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.body.get('album[0]'), 'Album');
  const { sent, recomputed } = signatureOverBody(call.body, SECRET);
  assert.equal(sent, recomputed);
});

/** The rejection of [promise], which must be a LastfmError. */
async function lastfmRejection(promise: Promise<unknown>): Promise<LastfmError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LastfmError) return error;
    throw error;
  }
  assert.fail('expected Last.fm to reject');
}

test('a numeric error becomes a LastfmError carrying the code', async () => {
  const { fetchImpl } = fakeLastfm(() => ({ json: { error: 9, message: 'Invalid session key - Please re-authenticate' } }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  const error = await lastfmRejection(client.updateNowPlaying('SESSIONKEY', { artist: 'A', track: 'B' }));
  assert.equal(error.code, 9);
  assert.equal(error.httpStatus, 200);
});

test('the session key, token and secret never appear in an error message', async () => {
  const { fetchImpl } = fakeLastfm(() => ({ json: { error: 4, message: 'bad key SESSIONKEY-XYZ and secret s3cr3t' } }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  const error = await lastfmRejection(client.scrobble('SESSIONKEY-XYZ', [{ artist: 'A', track: 'B', timestamp: 1 }]));
  assert.equal(error.code, 4);
  assert.equal(error.message.includes('SESSIONKEY-XYZ'), false);
  assert.equal(error.message.includes(SECRET), false);
});

test('an HTTP failure with no Last.fm code is a plain error, not a Last.fm code', async () => {
  const fetchImpl = (async (): Promise<Response> => new Response('<html>gateway</html>', { status: 503 })) as typeof fetch;
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  await assert.rejects(client.updateNowPlaying('SESSIONKEY', { artist: 'A', track: 'B' }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error instanceof LastfmError, false);
    return true;
  });
});

test('the single-object and array forms of a scrobble response both parse', async () => {
  const single = fakeLastfm(() => ({
    json: { scrobbles: { '@attr': { accepted: '1', ignored: '0' }, scrobble: { ignoredMessage: { code: '0', '#text': '' } } } }
  }));
  const singleOutcome = await new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl: single.fetchImpl }).scrobble('SESSIONKEY', [
    { artist: 'A', track: 'B', timestamp: 1 }
  ]);
  assert.deepEqual(singleOutcome, { accepted: 1, ignored: [] });

  const array = fakeLastfm(() => ({
    json: {
      scrobbles: {
        '@attr': { accepted: 1, ignored: 1 },
        scrobble: [{ ignoredMessage: { code: 0, '#text': '' } }, { ignoredMessage: { code: '1', '#text': 'Artist ignored' } }]
      }
    }
  }));
  const arrayOutcome = await new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl: array.fetchImpl }).scrobble('SESSIONKEY', [
    { artist: 'A', track: 'B', timestamp: 1 },
    { artist: '', track: 'C', timestamp: 2 }
  ]);
  assert.deepEqual(arrayOutcome, { accepted: 1, ignored: [{ index: 1, code: 1 }] });
});

test('a scrobble response whose entries do not match the request is unreadable, so it is retried', async () => {
  const { fetchImpl } = fakeLastfm(() => ({
    json: { scrobbles: { '@attr': { accepted: '1', ignored: '1' }, scrobble: [{ ignoredMessage: { code: '1' } }] } }
  }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  await assert.rejects(client.scrobble('SESSIONKEY', [
    { artist: 'A', track: 'B', timestamp: 1 },
    { artist: 'C', track: 'D', timestamp: 2 }
  ]), (error: unknown) => error instanceof Error && !(error instanceof LastfmError));
});

test('missing entries still succeed when the totals say every listen was accepted, so nothing is resent', async () => {
  const { fetchImpl } = fakeLastfm(() => ({
    json: { scrobbles: { '@attr': { accepted: '2', ignored: '0' } } }
  }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  const outcome = await client.scrobble('SESSIONKEY', [
    { artist: 'A', track: 'B', timestamp: 1 },
    { artist: 'C', track: 'D', timestamp: 2 }
  ]);
  assert.deepEqual(outcome, { accepted: 2, ignored: [] });
});

test('a scrobble batch must hold between 1 and 50 listens and sends nothing otherwise', async () => {
  const { fetchImpl, calls } = fakeLastfm(() => ({ json: {} }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  const listen = { artist: 'A', track: 'B', timestamp: 1 };
  await assert.rejects(client.scrobble('SESSIONKEY', []), RangeError);
  await assert.rejects(client.scrobble('SESSIONKEY', Array.from({ length: 51 }, () => listen)), RangeError);
  assert.equal(calls.length, 0);
});

test('getSession returns the session key and the username', async () => {
  const { fetchImpl, calls } = fakeLastfm(() => ({ json: { session: { name: 'listener', key: 'SESSIONKEY', subscriber: 0 } } }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  assert.deepEqual(await client.getSession('TOKEN123'), { sessionKey: 'SESSIONKEY', username: 'listener' });
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.body.get('method'), 'auth.getSession');
  assert.equal(call.body.get('token'), 'TOKEN123');
  assert.equal(call.body.get('api_sig'), 'b1fc43025345b55fc157500c52c1cbcf');
});

test('getSession rejects a session with no key', async () => {
  const { fetchImpl } = fakeLastfm(() => ({ json: { session: { name: 'listener' } } }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  await assert.rejects(client.getSession('TOKEN123'));
});

test('the auth URL carries the API key and an encoded callback', () => {
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET });
  const callback = 'https://allegra.example/api/lastfm/callback?state=abc_-123';
  const url = new URL(client.authUrl(callback));
  assert.equal(`${url.origin}${url.pathname}`, LASTFM_AUTH_PAGE);
  assert.equal(url.searchParams.get('api_key'), API_KEY);
  assert.equal(url.searchParams.get('cb'), callback);
});

test('now playing sends plain names and no timestamp', async () => {
  const { fetchImpl, calls } = fakeLastfm(() => ({ json: { nowplaying: {} } }));
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl });
  await client.updateNowPlaying('SESSIONKEY', { artist: 'Bj\u{f6}rk', track: 'J\u{f3}ga' });
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.body.get('method'), 'track.updateNowPlaying');
  assert.equal(call.body.get('artist'), 'Bj\u{f6}rk');
  assert.equal(call.body.has('timestamp'), false);
  assert.equal(call.body.has('timestamp[0]'), false);
  assert.equal(call.body.get('api_sig'), '6b121cd8e63a3b24aa5d9be5bdda1992');
});

test('a request that never answers rejects within its timeout budget', async () => {
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as typeof fetch;
  const client = new LastfmClient({ apiKey: API_KEY, secret: SECRET, fetchImpl, timeoutMs: 20 });
  const started = Date.now();
  await assert.rejects(client.updateNowPlaying('SESSIONKEY', { artist: 'A', track: 'B' }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'AbortError');
    return true;
  });
  assert.ok(Date.now() - started < 1_000);
});
