import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

import type { CacheStore } from './cache.js';
import { correlationId, errorShape, redactUrl, SILENT_LOG, type DiagLog } from './diagnostics.js';
import { ProviderUnavailableError, TimeoutError } from './errors.js';
import { fetchUntilHeaders, isAbortError } from './fetchWithTimeout.js';
import { parsePublicHttpsUrl } from './publicUrl.js';
import { BROWSER_HEADERS } from '../providers/saavn.js';
import type { SaavnProvider } from '../providers/saavn.js';
import type { GaanaProvider } from '../providers/gaana.js';
import { parseSongRef } from '../shared/songRef.js';

const STREAM_HEADER_TIMEOUT_MS = 25_000;
const STREAM_URL_TTL_SECONDS = 3_600;
const DEAD_SONG_TTL_SECONDS = 60;
const REFUSED_URL_TTL_SECONDS = 600;
const PASSTHROUGH_STATUSES = new Set([200, 206, 416]);
const REFUSED_STATUSES = new Set([403, 404, 410]);
const STREAM_CACHE_CONTROL = 'private, max-age=86400';

// Keys keep the song id's case. cacheKey() lowercases, so `saavn:AbC` and `saavn:abc` shared one
// cached URL (BE-001). The version bump leaves any v1 entry unread.
const streamKey = (songId: string): string => `stream:v2:${songId}`;
const deadKey = (songId: string): string => `stream-dead:v1:${songId}`;
const refusedKey = (url: string): string => `stream-refused:v1:${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;

interface DeadMarker {
  readonly status: number;
}

/** A forced refresh handed back a link this instance already saw refused. The CDN is not asked again. */
class RefusedLinkError extends ProviderUnavailableError {
  public constructor(public readonly url: string) {
    super();
  }
}

export interface StreamResolverOptions {
  readonly saavn: SaavnProvider;
  readonly gaana?: GaanaProvider;
  readonly cache: CacheStore;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly log?: DiagLog;
}

export class StreamResolver {
  private readonly saavn: SaavnProvider;
  private readonly gaana: Pick<SaavnProvider, 'getSong'>;
  private readonly cache: CacheStore;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly log: DiagLog;

  public constructor(options: StreamResolverOptions) {
    this.saavn = options.saavn;
    this.gaana = options.gaana ?? options.saavn;
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? STREAM_HEADER_TIMEOUT_MS;
    this.log = options.log ?? SILENT_LOG;
  }

  /** Server-only source CDN URL for stem separation etc. Never send this to the browser. */
  public async resolveSourceUrl(songId: string, force = false): Promise<string> {
    return this.resolve(songId, force);
  }

  public async pipe(songId: string, range: string | undefined, response: ExpressResponse, corr = correlationId('str')): Promise<void> {
    // The song's refreshed link was also refused within the last minute: answer at once, with no lookup or CDN call.
    if ((await this.cache.get<DeadMarker>(deadKey(songId))) !== null) {
      throw new ProviderUnavailableError();
    }
    let upstream = await this.fetchResolved(songId, range, false);
    if (REFUSED_STATUSES.has(upstream.response.status)) {
      const firstStatus = upstream.response.status;
      this.log.warn({ op: 'stream', corr, song: songId, status: firstStatus, url: redactUrl(upstream.url), step: 'refresh' }, 'stream link refused');
      await this.cache.set(refusedKey(upstream.url), true, REFUSED_URL_TTL_SECONDS);
      upstream.abort();
      try {
        upstream = await this.fetchResolved(songId, range, true);
      } catch (error) {
        if (error instanceof RefusedLinkError) {
          await this.markDead(songId, corr, firstStatus, error.url);
        }
        throw error;
      }
      if (REFUSED_STATUSES.has(upstream.response.status)) {
        await this.cache.set(refusedKey(upstream.url), true, REFUSED_URL_TTL_SECONDS);
        upstream.abort();
        await this.markDead(songId, corr, upstream.response.status, upstream.url);
        throw new ProviderUnavailableError();
      }
    }

    if (!PASSTHROUGH_STATUSES.has(upstream.response.status)) {
      this.log.warn({ op: 'stream', corr, song: songId, status: upstream.response.status }, 'stream upstream status');
      upstream.abort();
      throw new ProviderUnavailableError();
    }

    response.status(upstream.response.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.response.headers.get(header);
      if (value) {
        response.setHeader(header, value);
      }
    }
    // A song id always names the same file. Without this every replay, and the karaoke download
    // of a song the player already streamed, pulled the whole file through the function again.
    // Private: the bytes stay in the listener's browser, never in a shared cache.
    if (upstream.response.status !== 416) response.setHeader('Cache-Control', STREAM_CACHE_CONTROL);
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstream.response.body) {
      response.end();
      return;
    }

    const onClose = (): void => {
      if (!response.writableFinished) {
        upstream.abort();
      }
    };
    response.on('close', onClose);
    const body = Readable.fromWeb(upstream.response.body as NodeReadableStream<Uint8Array>);
    // Passive count only: the plain pipe below still owns backpressure.
    let sentBytes = 0;
    body.on('data', (chunk: Uint8Array) => {
      sentBytes += chunk.byteLength;
    });
    body
      .on('error', (error: unknown) => {
        // An event handler cannot throw to the route's try/catch: throwing here would be an
        // uncaught exception. Before the first byte the client can still get the JSON failure.
        upstream.abort();
        if (!response.headersSent) {
          this.log.warn({ op: 'stream', corr, song: songId, error: errorShape(error), headersSent: false }, 'stream body failed');
          response.removeHeader('content-length');
          response.removeHeader('content-range');
          response.status(502).type('application/json').json({ success: false, data: null, error: 'Music service is having a moment. Try again shortly.' });
          return;
        }
        this.log.warn({ op: 'stream', corr, song: songId, error: errorShape(error), headersSent: true, sentBytes }, 'stream body failed');
        response.destroy();
      })
      .pipe(response);
  }

  private async fetchResolved(
    songId: string,
    range: string | undefined,
    force: boolean
  ): Promise<{ response: Response; abort: () => void; url: string }> {
    const url = await this.resolve(songId, force);
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (range) {
      headers.Range = range;
    }
    try {
      const { response, abort } = await fetchUntilHeaders(url, { headers }, this.timeoutMs, this.fetchImpl);
      return { response, abort, url };
    } catch (error) {
      if (isAbortError(error)) {
        throw new TimeoutError();
      }
      throw new ProviderUnavailableError();
    }
  }

  private async markDead(songId: string, corr: string, status: number, url: string): Promise<void> {
    const marker: DeadMarker = { status };
    await this.cache.set(deadKey(songId), marker, DEAD_SONG_TTL_SECONDS);
    await this.cache.delete(streamKey(songId));
    this.log.warn({ op: 'stream', corr, song: songId, status, url: redactUrl(url) }, 'stream song dead');
  }

  private async resolve(songId: string, force: boolean): Promise<string> {
    const key = streamKey(songId);
    if (!force) {
      const cached = await this.cache.get<string>(key);
      if (cached) {
        return assertStreamUrl(cached);
      }
    }

    const ref = parseSongRef(songId);
    const provider = ref?.source === 'gaana' ? this.gaana : this.saavn;
    const providerId = ref?.id ?? songId;
    const result = await provider.getSong(providerId);
    const downloads = result.data?.downloadUrl ?? [];
    const url = downloads.find((asset) => asset.quality === '320kbps')?.url ?? downloads.at(-1)?.url;
    if (!result.ok || !url) {
      throw result.reason === 'timeout' ? new TimeoutError() : new ProviderUnavailableError();
    }
    const safeUrl = assertStreamUrl(url);
    if (force && (await this.cache.get<boolean>(refusedKey(safeUrl))) !== null) {
      throw new RefusedLinkError(safeUrl);
    }
    await this.cache.set(key, safeUrl, STREAM_URL_TTL_SECONDS);
    return safeUrl;
  }
}

function assertStreamUrl(value: string): string {
  try {
    return parsePublicHttpsUrl(value).toString();
  } catch {
    throw new ProviderUnavailableError();
  }
}
