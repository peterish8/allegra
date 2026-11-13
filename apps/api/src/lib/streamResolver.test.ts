import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { Response as ExpressResponse } from 'express';

import { MemoryCacheStore } from './cache.js';
import { redactUrl, type DiagLog } from './diagnostics.js';
import { ProviderUnavailableError } from './errors.js';
import { StreamResolver } from './streamResolver.js';
import { SaavnProvider, type SaavnSong } from '../providers/saavn.js';
import { GaanaProvider } from '../providers/gaana.js';

const song: SaavnSong = {
  id: 'song-1',
  name: 'Test Song',
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeResponse(): ExpressResponse & { readonly headerMap: Map<string, string> } {
  const stream = new PassThrough();
  const headerMap = new Map<string, string>();
  Object.assign(stream, {
    statusCode: 0,
    headerMap,
    status(code: number) {
      (stream as PassThrough & { statusCode: number }).statusCode = code;
      return stream;
    },
    setHeader(name: string, value: string) {
      headerMap.set(name.toLowerCase(), value);
      return stream;
    },
    getHeader(name: string) {
      return headerMap.get(name.toLowerCase());
    }
  });
  return stream as unknown as ExpressResponse & { readonly headerMap: Map<string, string> };
}

test('Range requests preserve 206 and required headers and forward the exact Range', async () => {
  const requested: string[] = [];
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async (input) => {
        requested.push(`meta:${String(input)}`);
        return json({ success: true, data: song });
      }
    }),
    fetchImpl: async (input, init) => {
      requested.push(`cdn:${String(input)}:${new Headers(init?.headers).get('range')}`);
      return new Response('audio-bytes', {
        status: 206,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': '11',
          'content-range': 'bytes 0-10/100',
          'accept-ranges': 'bytes'
        }
      });
    }
  });

  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-10', response);
  assert.equal(response.statusCode, 206);
  assert.equal(response.headerMap.get('content-range'), 'bytes 0-10/100');
  assert.equal(response.headerMap.get('accept-ranges'), 'bytes');
  assert.equal(response.headerMap.get('content-type'), 'audio/mp4');
  assert.equal(response.headerMap.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(requested.at(-1), 'cdn:https://cdn.example/song.mp4:bytes=0-10');
});

test('no Range request returns 200', async () => {
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({ success: true, data: song })
    }),
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('range'), null);
      return new Response('full-audio', {
        status: 200,
        headers: { 'content-type': 'audio/mp4', 'content-length': '10', 'accept-ranges': 'bytes' }
      });
    }
  });
  const response = fakeResponse();
  await resolver.pipe('song-1', undefined, response);
  assert.equal(response.statusCode, 200);
});

test('403 causes exactly one forced URL refresh', async () => {
  let songCalls = 0;
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => {
        songCalls += 1;
        return json({
          success: true,
          data: {
            ...song,
            downloadUrl: [{ quality: '320kbps', url: `https://cdn.example/song-${songCalls}.mp4` }]
          }
        });
      }
    }),
    fetchImpl: async () => {
      cdnCalls += 1;
      if (cdnCalls === 1) {
        return new Response('expired', { status: 403 });
      }
      return new Response('audio-bytes', {
        status: 206,
        headers: { 'content-range': 'bytes 0-10/100', 'accept-ranges': 'bytes', 'content-type': 'audio/mp4' }
      });
    }
  });

  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-10', response);
  assert.equal(songCalls, 2);
  assert.equal(cdnCalls, 2);
  assert.equal(response.statusCode, 206);
});

test('private stream URLs are rejected instead of being fetched', async () => {
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({
        success: true,
        data: { ...song, downloadUrl: [{ quality: '320kbps', url: 'https://127.0.0.1/secret.mp4' }] }
      })
    }),
    fetchImpl: async () => {
      cdnCalls += 1;
      return new Response('nope');
    }
  });

  await assert.rejects(() => resolver.pipe('song-1', undefined, fakeResponse()), ProviderUnavailableError);
  assert.equal(cdnCalls, 0);
});

test('provider-qualified Gaana stream requests resolve the Gaana CDN and preserve range responses', async () => {
  const requested: string[] = [];
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({ baseUrl: 'https://saavn.example/api', fetchImpl: async () => json({ success: true, data: song }) }),
    gaana: new GaanaProvider({
      baseUrl: 'https://gaana.example/api',
      fetchImpl: async (input) => {
        requested.push(String(input));
        return json({ success: true, data: { ...song, id: 'g1', downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/gaana.mp4' }] } });
      }
    }),
    fetchImpl: async (input, init) => {
      requested.push(`cdn:${String(input)}:${new Headers(init?.headers).get('range')}`);
      return new Response('audio', { status: 206, headers: { 'content-range': 'bytes 0-4/20', 'content-type': 'audio/mp4' } });
    }
  });
  const response = fakeResponse();
  await resolver.pipe('gaana:g1', 'bytes=0-4', response);
  assert.equal(response.statusCode, 206);
  assert.ok(requested.some((url) => url === 'https://gaana.example/api/songs/g1'));
  assert.ok(requested.includes('cdn:https://cdn.example/gaana.mp4:bytes=0-4'));
  assert.equal(requested.some((url) => url === 'https://saavn.example/api/songs/g1'), false);
});

interface CapturedLine {
  readonly level: 'warn' | 'error' | 'info';
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

function capturingLog(): DiagLog & { readonly lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  const capture = (level: CapturedLine['level']) => (fields: Record<string, unknown>, message: string): void => {
    lines.push({ level, fields, message });
  };
  return { lines, warn: capture('warn'), error: capture('error'), info: capture('info') };
}

test('a refused link logs a redacted url and the refresh step', async () => {
  const signed = 'https://cdn.example/song.mp4?sig=fixture-signature';
  const refreshed = 'https://cdn.example/song-2.mp4?sig=fixture-fresh';
  let songCalls = 0;
  let cdnCalls = 0;
  const log = capturingLog();
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    log,
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => {
        songCalls += 1;
        const url = songCalls === 1 ? signed : refreshed;
        return json({ success: true, data: { ...song, downloadUrl: [{ quality: '320kbps', url }] } });
      }
    }),
    fetchImpl: async () => {
      cdnCalls += 1;
      if (cdnCalls === 1) {
        return new Response('expired', { status: 403 });
      }
      return new Response('audio-bytes', {
        status: 206,
        headers: { 'content-range': 'bytes 0-10/100', 'accept-ranges': 'bytes', 'content-type': 'audio/mp4' }
      });
    }
  });

  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-10', response, 'str-refused01');
  assert.equal(response.statusCode, 206);

  assert.equal(log.lines.length, 1);
  const [line] = log.lines;
  assert.equal(line?.level, 'warn');
  assert.equal(line?.message, 'stream link refused');
  assert.deepEqual(line?.fields, {
    op: 'stream',
    corr: 'str-refused01',
    song: 'song-1',
    status: 403,
    url: 'https://cdn.example/~8a863b64',
    step: 'refresh'
  });
  const serialized = JSON.stringify(log.lines);
  assert.equal(serialized.includes('sig='), false, 'logs must not carry the signature parameter');
  assert.equal(serialized.includes('fixture-signature'), false, 'logs must not carry the signature value');
  assert.equal(serialized.includes(signed), false, 'logs must not carry the full signed url');
  assert.equal(serialized.includes('song.mp4'), false, 'logs must not carry the url path');
});

test('a body failure after headers logs sentBytes', async () => {
  const failure = Object.assign(new TypeError('terminated https://cdn.example/song.mp4?sig=fixture-signature'), {
    cause: { code: 'UND_ERR_SOCKET' }
  });
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode('audio-'));
          return;
        }
        controller.error(failure);
      }
    },
    { highWaterMark: 0 }
  );
  const log = capturingLog();
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    log,
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({ success: true, data: song })
    }),
    fetchImpl: async () => new Response(body, {
      status: 206,
      headers: { 'content-range': 'bytes 0-10/100', 'accept-ranges': 'bytes', 'content-type': 'audio/mp4' }
    })
  });

  // Headers already went out before the body failed, so the route must destroy instead of sending JSON.
  const response = Object.assign(fakeResponse(), { headersSent: true });
  const closed = once(response, 'close');
  await resolver.pipe('song-1', 'bytes=0-10', response, 'str-bodyfail1');
  await closed;

  assert.equal(log.lines.length, 1);
  const [line] = log.lines;
  assert.equal(line?.level, 'warn');
  assert.equal(line?.message, 'stream body failed');
  assert.deepEqual(line?.fields, {
    op: 'stream',
    corr: 'str-bodyfail1',
    song: 'song-1',
    error: { name: 'TypeError', code: 'UND_ERR_SOCKET' },
    headersSent: true,
    sentBytes: 6
  });
  const serialized = JSON.stringify(log.lines);
  assert.equal(serialized.includes('sig='), false);
  assert.equal(serialized.includes('fixture-signature'), false);
  assert.equal(serialized.includes('terminated'), false, 'the error message must never be logged');
});

/** A provider whose n-th lookup returns urlFor(n), and that counts its lookups. */
function numberedProvider(urlFor: (lookup: number) => string): { readonly provider: SaavnProvider; readonly lookups: () => number } {
  let lookups = 0;
  const provider = new SaavnProvider({
    baseUrl: 'https://saavn.example/api',
    fetchImpl: async () => {
      lookups += 1;
      return json({ success: true, data: { ...song, downloadUrl: [{ quality: '320kbps', url: urlFor(lookups) }] } });
    }
  });
  return { provider, lookups: () => lookups };
}

const partialAudio = (): Response =>
  new Response('audio', { status: 206, headers: { 'content-range': 'bytes 0-4/20', 'content-type': 'audio/mp4' } });

test('song ids that differ only in letter case resolve to their own audio', async () => {
  const cdnUrls: string[] = [];
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async (input) => {
        const id = new URL(String(input)).pathname.split('/').at(-1) ?? '';
        return json({ success: true, data: { ...song, id, downloadUrl: [{ quality: '320kbps', url: `https://cdn.example/${id}.mp4` }] } });
      }
    }),
    fetchImpl: async (input) => {
      cdnUrls.push(String(input));
      return partialAudio();
    }
  });

  await resolver.pipe('song-AbC', 'bytes=0-4', fakeResponse());
  await resolver.pipe('song-abc', 'bytes=0-4', fakeResponse());
  assert.deepEqual(cdnUrls, ['https://cdn.example/song-AbC.mp4', 'https://cdn.example/song-abc.mp4']);
});

test('a song whose link is refused twice is answered from the dead marker without new lookups', async () => {
  const provider = numberedProvider((lookup) => `https://cdn.example/dead-${lookup}.mp4`);
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: provider.provider,
    fetchImpl: async () => {
      cdnCalls += 1;
      return new Response('gone', { status: 403 });
    }
  });

  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-10', fakeResponse()), ProviderUnavailableError);
  assert.equal(provider.lookups(), 2);
  assert.equal(cdnCalls, 2);

  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-10', fakeResponse()), ProviderUnavailableError);
  assert.equal(provider.lookups(), 2, 'the dead marker answers before any provider lookup');
  assert.equal(cdnCalls, 2, 'the dead marker answers before any CDN request');
});

test('the dead marker expires after 60 seconds and the song is looked up again', async (t) => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const provider = numberedProvider((lookup) => `https://cdn.example/expiry-${lookup}.mp4`);
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: provider.provider,
    fetchImpl: async () => {
      cdnCalls += 1;
      return cdnCalls <= 2 ? new Response('gone', { status: 403 }) : partialAudio();
    }
  });

  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-4', fakeResponse()), ProviderUnavailableError);
  now += 59_000;
  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-4', fakeResponse()), ProviderUnavailableError);
  assert.equal(provider.lookups(), 2, 'still inside the 60 second window');

  now += 2_000;
  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-4', response);
  assert.equal(response.statusCode, 206);
  assert.equal(provider.lookups(), 3);
});

test('a refresh that returns the same refused link is not fetched again, and the logs carry no secret', async () => {
  const signed = 'https://cdn.example/song.mp4?sig=fixture-signature';
  let cdnCalls = 0;
  const log = capturingLog();
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    log,
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({ success: true, data: { ...song, downloadUrl: [{ quality: '320kbps', url: signed }] } })
    }),
    fetchImpl: async () => {
      cdnCalls += 1;
      return new Response('expired', { status: 403 });
    }
  });

  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-10', fakeResponse(), 'str-deadlink01'), ProviderUnavailableError);
  assert.equal(cdnCalls, 1, 'the refresh returned a link already refused, so the CDN is not asked again');
  assert.deepEqual(log.lines.map((line) => line.message), ['stream link refused', 'stream song dead']);
  assert.equal(log.lines[1]?.level, 'warn');
  assert.deepEqual(log.lines[1]?.fields, { op: 'stream', corr: 'str-deadlink01', song: 'song-1', status: 403, url: redactUrl(signed) });
  const serialized = JSON.stringify(log.lines);
  assert.equal(serialized.includes('sig='), false, 'logs must not carry the signature parameter');
  assert.equal(serialized.includes('fixture-signature'), false, 'logs must not carry the signature value');
});

test('a 410 link is refreshed like a 403', async () => {
  const provider = numberedProvider((lookup) => `https://cdn.example/gone-${lookup}.mp4`);
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: provider.provider,
    fetchImpl: async () => {
      cdnCalls += 1;
      return cdnCalls === 1 ? new Response('gone', { status: 410 }) : partialAudio();
    }
  });

  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-4', response);
  assert.equal(response.statusCode, 206);
  assert.equal(provider.lookups(), 2);
});

test('a server error from the CDN is not a refused link and does not mark the song dead', async () => {
  const provider = numberedProvider(() => 'https://cdn.example/flaky.mp4');
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: provider.provider,
    fetchImpl: async () => {
      cdnCalls += 1;
      return new Response('oops', { status: 500 });
    }
  });

  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-4', fakeResponse()), ProviderUnavailableError);
  await assert.rejects(() => resolver.pipe('song-1', 'bytes=0-4', fakeResponse()), ProviderUnavailableError);
  assert.equal(cdnCalls, 2, 'the second request still reaches the CDN');
  assert.equal(provider.lookups(), 1, 'the cached link is reused; nothing was marked dead');
});
