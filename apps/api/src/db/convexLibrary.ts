import { isTombstone, type LibraryChange, type LibraryOp, type RejectReason } from '../shared/library.js';
import type { LibraryApplyResult, LibraryPage, LibraryStore } from '../user/library.js';
import type { ConvexGateway } from './convexGateway.js';

const REJECT_REASONS: readonly RejectReason[] = ['bad_time', 'no_playlist', 'missing_name'];

/** Library sync in Convex: one transaction per batch, rules in packages/shared/library.ts. */
export class ConvexLibraryStore implements LibraryStore {
  public constructor(private readonly convex: ConvexGateway) {}

  public async apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult> {
    return parseApply(await this.convex.mutation('library:apply', { userId, ops }), ops.length);
  }

  public async changes(userId: string, since: number, limit: number): Promise<LibraryPage> {
    let page = await this.convex.query('library:changes', { userId, since, limit });
    // A listener whose library still lives only in their profile: move it into rows (an empty
    // batch does just that), so the first sync sends everything they already have.
    if (isRecord(page) && page.seeded === false) {
      await this.apply(userId, []);
      page = await this.convex.query('library:changes', { userId, since, limit });
    }
    const parsed = parsePage(page);
    // From 0 the caller has nothing, so remembered deletes are left out here whether or not
    // Convex already did; `rev` and `more` are Convex's, so paging is unaffected.
    return since === 0 ? { ...parsed, changes: parsed.changes.filter((change) => !isTombstone(change)) } : parsed;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseApply(value: unknown, sent: number): LibraryApplyResult {
  if (!isRecord(value) || typeof value.rev !== 'number') throw new Error('Unexpected library reply');
  const rejected = Array.isArray(value.rejected)
    ? value.rejected.flatMap((item) =>
        isRecord(item) && typeof item.index === 'number' && REJECT_REASONS.includes(item.reason as RejectReason)
          ? [{ index: item.index, reason: item.reason as RejectReason }]
          : []
      )
    : [];
  const removedCoverKeys = Array.isArray(value.removedCoverKeys) ? value.removedCoverKeys.filter((key): key is string => typeof key === 'string') : [];
  return { rev: value.rev, rejected, ...outcomeOf(value, sent, rejected), removedCoverKeys };
}

/**
 * Which operations lost and how many applied, as convex/library.ts `apply` reports them (both
 * come out of applyLibraryOps there). A deployment that predates those fields cannot say, and the
 * API must not guess in the direction that hides a lost change: it answers that nothing is known
 * to have applied and every operation it did not reject may have lost, so the device pulls and
 * ends up right. That costs one pull per batch until Convex is deployed, never a wrong library.
 */
function outcomeOf(
  value: Record<string, unknown>,
  sent: number,
  rejected: readonly { readonly index: number }[]
): Pick<LibraryApplyResult, 'superseded' | 'applied'> {
  const inBatch = (index: unknown): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < sent;
  if (Array.isArray(value.superseded) && typeof value.applied === 'number' && Number.isInteger(value.applied) && value.applied >= 0) {
    return { superseded: value.superseded.filter(inBatch), applied: Math.min(value.applied, sent) };
  }
  const refused = new Set(rejected.map((item) => item.index));
  return { superseded: Array.from({ length: sent }, (_, index) => index).filter((index) => !refused.has(index)), applied: 0 };
}

function parsePage(value: unknown): LibraryPage {
  if (!isRecord(value) || typeof value.rev !== 'number' || !Array.isArray(value.changes)) throw new Error('Unexpected library reply');
  // Built by packages/shared/library.ts toChange on the Convex side; kinds are checked, the rest passes through.
  const changes = value.changes.filter(
    (change): change is LibraryChange => isRecord(change) && (change.kind === 'like' || change.kind === 'playlist' || change.kind === 'playlist_item')
  );
  return { rev: value.rev, changes, more: value.more === true };
}
