/**
 * `POST /api/me/library/ops` (docs/api-contract.md, "Library sync"), with the two things the
 * sync loop needs from it: the phone's clock goes out with the batch (`sentAt`), and the reply
 * says which operations lost (`superseded`) and how many took a revision (`applied`).
 *
 * An API that predates those fields answers with neither; the reply then carries only `rev`
 * and `rejected`, and the loop pulls as it always did.
 */
import type { LibraryOp } from '@shared/library';

import type { SendOutcome } from '../account/allegraApi';
import { ALLEGRA_API_URL } from '../account/config';

export interface OpsReply {
  /** The account's newest revision after the batch. */
  readonly rev: number;
  readonly rejected: readonly { readonly index: number; readonly reason: string }[];
  /** Indexes of operations that lost to newer state on the account. Absent from an older API. */
  readonly superseded?: readonly number[];
  /** How many operations changed something; each took exactly one revision. Absent from an older API. */
  readonly applied?: number;
}

const TIMEOUT_MS = 15_000;

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The reply as far as it can be trusted: a field of the wrong shape is treated as not sent. */
export function readOpsReply(data: unknown): OpsReply | null {
  if (typeof data !== 'object' || data === null) return null;
  const reply = data as { rev?: unknown; rejected?: unknown; superseded?: unknown; applied?: unknown };
  if (typeof reply.rev !== 'number' || !Number.isFinite(reply.rev)) return null;
  const rejected = Array.isArray(reply.rejected)
    ? reply.rejected.flatMap((item: unknown) => {
        const entry = item as { index?: unknown; reason?: unknown } | null;
        return entry && isIndex(entry.index) ? [{ index: entry.index, reason: typeof entry.reason === 'string' ? entry.reason : '' }] : [];
      })
    : [];
  return {
    rev: reply.rev,
    rejected,
    ...(Array.isArray(reply.superseded) ? { superseded: reply.superseded.filter(isIndex) } : {}),
    ...(isIndex(reply.applied) ? { applied: reply.applied } : {}),
  };
}

/**
 * Sends a batch. 'refused': the server will never take it. 'offline': try again later (no
 * network, a server error, an expired token, or an API that does not have the route yet).
 */
export async function postLibraryOps(token: string, ops: readonly LibraryOp[], sentAt: number): Promise<SendOutcome<OpsReply>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ALLEGRA_API_URL}/api/me/library/ops`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ops, sentAt }),
      signal: controller.signal,
    });
    if (res.status >= 400 && res.status < 500 && ![401, 404, 408, 429].includes(res.status)) return { outcome: 'refused' };
    if (!res.ok) return { outcome: 'offline' };
    const json = (await res.json()) as { success?: unknown; data?: unknown };
    const reply = json.success === true ? readOpsReply(json.data) : null;
    return reply ? { outcome: 'sent', data: reply } : { outcome: 'offline' };
  } catch {
    return { outcome: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
