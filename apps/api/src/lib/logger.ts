import pino, { type Logger } from 'pino';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-convex-server-secret"]',
  'res.headers["set-cookie"]'
] as const;

/**
 * Access logs intentionally retain only request metadata needed for operations.
 * Header values and query strings are omitted because either can carry reusable credentials.
 */
export function serializeRequest(request: {
  readonly id?: string | number;
  readonly method?: string;
  readonly url?: string;
  readonly remoteAddress?: string;
  readonly socket?: { readonly remoteAddress?: string };
}) {
  const url = request.url ?? '';
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return {
    id: request.id,
    method: request.method,
    url: path,
    remoteAddress: request.remoteAddress ?? request.socket?.remoteAddress
  };
}

export function createLogger(enabled: boolean): Logger {
  return pino({
    enabled,
    level: enabled ? 'info' : 'silent',
    redact: {
      paths: [...REDACTED_PATHS],
      censor: '[redacted]'
    }
  });
}
