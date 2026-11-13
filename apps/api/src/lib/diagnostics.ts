import { createHash, randomBytes } from 'node:crypto';

export interface DiagLog {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
}

/** A logger that drops everything (tests, local dev without logging). */
export const SILENT_LOG: DiagLog = { warn: () => undefined, error: () => undefined, info: () => undefined };

const short = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);

export function redactSecret(value: string | null | undefined): string {
  return value ? `len=${value.length},sha256=${short(value)}` : 'absent';
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/~${short(url.pathname + url.search)}`;
  } catch {
    return 'invalid-url';
  }
}

const VERCEL_ID = /^[A-Za-z0-9:_-]{1,64}$/;

export function correlationId(prefix: string, vercelId?: string | null): string {
  const trimmed = vercelId?.trim().slice(0, 64);
  return trimmed && VERCEL_ID.test(trimmed) ? trimmed : `${prefix}-${randomBytes(4).toString('hex')}`;
}

/** Name and code of an error, never its message (messages can echo URLs or tokens). */
export function errorShape(error: unknown): { readonly name: string; readonly code?: string } {
  if (typeof error !== 'object' || error === null) return { name: typeof error };
  const record = error as { name?: unknown; code?: unknown; cause?: unknown };
  const cause = record.cause as { code?: unknown } | undefined;
  const code = typeof record.code === 'string' ? record.code : typeof cause?.code === 'string' ? cause.code : undefined;
  return { name: typeof record.name === 'string' ? record.name : 'Error', ...(code ? { code } : {}) };
}

/** Runs [work]; on failure logs one warning with the elapsed ms and the error shape, then rethrows. */
export async function timedWarn<T>(log: DiagLog, op: string, fields: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } catch (error) {
    log.warn({ op, ms: Date.now() - started, ...fields, error: errorShape(error) }, `${op} failed`);
    throw error;
  }
}
