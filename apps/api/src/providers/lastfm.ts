import { createHash } from 'node:crypto';

import { fetchBodyWithTimeout } from '../lib/fetchWithTimeout.js';

/** Last.fm API 2.0. The docs print http://; https is used and the live check confirms it. */
export const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_AUTH_PAGE = 'https://www.last.fm/api/auth/';
const TIMEOUT_MS = 8_000;
const SCROBBLE_BATCH_MAX = 50;
/** Never part of the signature: format and callback are excluded by Last.fm, and api_sig cannot sign itself. */
const UNSIGNED = new Set(['format', 'callback', 'api_sig']);

export class LastfmError extends Error {
  public constructor(public readonly code: number, message: string, public readonly httpStatus: number) {
    super(message);
    this.name = 'LastfmError';
  }
}

/** md5 over the params sorted by name (plain code-unit order), each as `<name><value>`, then the secret. UTF-8. */
export function lastfmSignature(params: Readonly<Record<string, string>>, secret: string): string {
  const base = Object.entries(params)
    .filter(([name]) => !UNSIGNED.has(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}${value}`)
    .join('');
  return createHash('md5').update(base + secret, 'utf8').digest('hex');
}

export interface ScrobbleItem {
  readonly artist: string;
  readonly track: string;
  /** Unix seconds (UTC) when the listen started. */
  readonly timestamp: number;
  readonly album?: string;
  readonly durationSec?: number;
}

export interface ScrobbleOutcome {
  readonly accepted: number;
  /** Rows Last.fm refused, by their position in the request. Codes 1 to 5 are final. */
  readonly ignored: ReadonlyArray<{ readonly index: number; readonly code: number }>;
}

export interface LastfmClientOptions {
  readonly apiKey: string;
  readonly secret: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class LastfmClient {
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;

  public constructor(options: LastfmClientOptions) {
    this.apiKey = options.apiKey;
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  /** The page the listener visits to approve Allegra. Last.fm returns to [callbackUrl] with `token`. */
  public authUrl(callbackUrl: string): string {
    return `${LASTFM_AUTH_PAGE}?${new URLSearchParams({ api_key: this.apiKey, cb: callbackUrl }).toString()}`;
  }

  public async getSession(token: string): Promise<{ readonly sessionKey: string; readonly username: string }> {
    const json = await this.post({ method: 'auth.getSession', token }, [token]);
    const session = isRecord(json) && isRecord(json.session) ? json.session : undefined;
    if (!session || typeof session.key !== 'string' || session.key === '' || typeof session.name !== 'string') {
      throw unreadable('auth.getSession');
    }
    return { sessionKey: session.key, username: session.name };
  }

  public async updateNowPlaying(sessionKey: string, item: Omit<ScrobbleItem, 'timestamp'>): Promise<void> {
    const params: Record<string, string> = { method: 'track.updateNowPlaying', sk: sessionKey, artist: item.artist, track: item.track };
    if (item.album) params.album = item.album;
    const duration = durationParam(item.durationSec);
    if (duration) params.duration = duration;
    await this.post(params, [sessionKey]);
  }

  /** One request for 1 to 50 listens. Always array notation, even for one item. */
  public async scrobble(sessionKey: string, items: readonly ScrobbleItem[]): Promise<ScrobbleOutcome> {
    if (items.length < 1 || items.length > SCROBBLE_BATCH_MAX) {
      throw new RangeError(`Last.fm takes 1 to ${SCROBBLE_BATCH_MAX} scrobbles per request.`);
    }
    const params: Record<string, string> = { method: 'track.scrobble', sk: sessionKey };
    items.forEach((item, i) => {
      params[`artist[${i}]`] = item.artist;
      params[`track[${i}]`] = item.track;
      params[`timestamp[${i}]`] = String(item.timestamp);
      if (item.album) params[`album[${i}]`] = item.album;
      const duration = durationParam(item.durationSec);
      if (duration) params[`duration[${i}]`] = duration;
    });
    const json = await this.post(params, [sessionKey]);
    return parseScrobbleOutcome(json, items.length);
  }

  /**
   * Signs and POSTs one method call. Throws LastfmError when Last.fm returns an `error` code, and a
   * plain Error when the body is unreadable or the HTTP status is not OK without a Last.fm code.
   * Messages never echo the session key, token, secret or api key.
   */
  private async post(params: Record<string, string>, secrets: readonly string[]): Promise<unknown> {
    const signed: Record<string, string> = { ...params, api_key: this.apiKey };
    const body = new URLSearchParams({ ...signed, api_sig: lastfmSignature(signed, this.secret), format: 'json' });
    const response = await fetchBodyWithTimeout(
      LASTFM_API_ROOT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString()
      },
      this.timeoutMs,
      this.fetchImpl ?? fetch
    );
    const json = parseJson(response.body);
    const code = isRecord(json) ? numberish(json.error) : undefined;
    if (isRecord(json) && code !== undefined) {
      const raw = typeof json.message === 'string' ? json.message : 'Last.fm rejected the request.';
      const sensitive = [...secrets, this.secret, this.apiKey].filter((value) => value !== '');
      const message = sensitive.some((value) => raw.includes(value)) ? 'Last.fm rejected the request.' : raw;
      throw new LastfmError(code, message, response.status);
    }
    if (!response.ok || json === undefined) {
      throw new Error(`Last.fm answered HTTP ${response.status} with no readable result.`);
    }
    return json;
  }
}

function parseScrobbleOutcome(json: unknown, count: number): ScrobbleOutcome {
  const scrobbles = isRecord(json) && isRecord(json.scrobbles) ? json.scrobbles : undefined;
  const attr = scrobbles && isRecord(scrobbles['@attr']) ? scrobbles['@attr'] : undefined;
  const accepted = numberish(attr?.accepted);
  if (!scrobbles || accepted === undefined) throw unreadable('track.scrobble');
  const raw = scrobbles.scrobble;
  const entries: unknown[] = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : [];
  // Entries come back in submission order. If their count differs from the request, positions
  // cannot be mapped to rows safely, so the batch is treated as unreadable and retried rather than
  // dropping a row Last.fm may not have stored.
  if (entries.length !== count) throw unreadable('track.scrobble');
  const ignored = entries.flatMap((entry, index) => {
    const message = isRecord(entry) ? entry.ignoredMessage : undefined;
    const code = isRecord(message) ? numberish(message.code) : undefined;
    return code !== undefined && code !== 0 ? [{ index, code }] : [];
  });
  return { accepted, ignored };
}

function durationParam(durationSec: number | undefined): string | undefined {
  if (durationSec === undefined || !Number.isFinite(durationSec) || durationSec < 1) return undefined;
  return String(Math.floor(durationSec));
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function unreadable(method: string): Error {
  return new Error(`Last.fm sent an unreadable ${method} response.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Last.fm sends some numbers as strings in JSON responses; accept either. */
function numberish(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}
