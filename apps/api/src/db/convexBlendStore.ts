import { ConvexError } from 'convex/values';

import type { BlendTrack, PairMatch } from '../shared/blendTypes.js';
import {
  BlendError,
  type BlendConsent,
  type BlendErrorCode,
  type BlendListEntry,
  type BlendMemberRecord,
  type BlendPreview,
  type BlendStore,
  type SaveBuildInput,
  type StoredBlend,
  type StoredGift,
  type StoredStorySong
} from '../user/blendStore.js';
import type { ConvexGateway } from './convexGateway.js';

const CODES: readonly BlendErrorCode[] = ['full', 'limit', 'notfound', 'expired', 'invalid'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Convex rule refusal becomes a BlendError; anything else (timeouts, outages) passes through. */
async function mapped<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    const data = error instanceof ConvexError ? (error.data as unknown) : undefined;
    const code = isRecord(data) ? data.code : undefined;
    if (typeof code === 'string' && (CODES as readonly string[]).includes(code)) throw new BlendError(code as BlendErrorCode);
    throw error;
  }
}

function member(value: unknown): BlendMemberRecord | null {
  if (!isRecord(value) || typeof value.userId !== 'string' || typeof value.displayName !== 'string' || typeof value.joinedAt !== 'number' || typeof value.learning !== 'boolean') return null;
  return { userId: value.userId, displayName: value.displayName, joinedAt: value.joinedAt, learning: value.learning };
}

function members(value: unknown): BlendMemberRecord[] {
  return Array.isArray(value) ? value.map(member).filter((row): row is BlendMemberRecord => row !== null) : [];
}

const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * A stored Blend. Nested build arrays were checked by the Convex validators when they were
 * written (convex/schema.ts blendTrack, pairMatch), so they are taken as stored.
 */
function parseBlend(value: unknown): StoredBlend | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.ownerId !== 'string'
    || typeof value.memberCount !== 'number' || typeof value.buildVersion !== 'number' || typeof value.stale !== 'boolean') {
    throw new Error('Unexpected blend reply');
  }
  return {
    id: value.id,
    name: value.name,
    ownerId: value.ownerId,
    memberCount: value.memberCount,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
    ...(typeof value.builtFor === 'string' ? { builtFor: value.builtFor } : {}),
    buildVersion: value.buildVersion,
    inputVersion: typeof value.inputVersion === 'number' ? value.inputVersion : 0,
    stale: value.stale,
    tracks: array<BlendTrack>(value.tracks),
    pairs: array<PairMatch>(value.pairs),
    previousPairs: array<PairMatch>(value.previousPairs),
    previousTracks: array<unknown>(value.previousTracks).filter((item): item is string => typeof item === 'string'),
    ...(isRecord(value.together) ? { together: value.together as unknown as StoredStorySong } : {}),
    gifts: array<StoredGift>(value.gifts),
    glue: array<unknown>(value.glue).filter((item): item is string => typeof item === 'string'),
    members: members(value.members)
  };
}

export class ConvexBlendStore implements BlendStore {
  public constructor(private readonly convex: ConvexGateway) {}

  public async create(input: { userId: string; displayName: string; name: string; consent: BlendConsent; learning: boolean; code: string; operationId?: string }) {
    const reply = await mapped(this.convex.mutation('blends:create', { ...input }));
    if (!isRecord(reply) || typeof reply.blendId !== 'string' || typeof reply.code !== 'string' || typeof reply.expiresAt !== 'number') throw new Error('Unexpected blend reply');
    return { blendId: reply.blendId, code: reply.code, expiresAt: reply.expiresAt };
  }

  public async get(blendId: string, userId: string): Promise<StoredBlend | null> {
    return parseBlend(await this.convex.query('blends:get', { blendId, userId }));
  }

  public async listForUser(userId: string): Promise<readonly BlendListEntry[]> {
    const reply = await this.convex.query('blends:listForUser', { userId });
    if (!Array.isArray(reply)) throw new Error('Unexpected blend reply');
    return reply.flatMap((row): BlendListEntry[] => {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.memberCount !== 'number' || typeof row.joinedAt !== 'number') return [];
      return [{ id: row.id, name: row.name, memberCount: row.memberCount, joinedAt: row.joinedAt, ...(typeof row.builtFor === 'string' ? { builtFor: row.builtFor } : {}), members: members(row.members) }];
    });
  }

  public async invite(blendId: string, userId: string, code: string, regenerate: boolean) {
    const reply = await mapped(this.convex.mutation('blends:invite', { blendId, userId, code, regenerate }));
    if (!isRecord(reply) || typeof reply.code !== 'string' || typeof reply.expiresAt !== 'number') throw new Error('Unexpected blend reply');
    return { code: reply.code, expiresAt: reply.expiresAt };
  }

  public async preview(code: string, now: number): Promise<BlendPreview> {
    const reply = await this.convex.query('blends:preview', { code, now });
    if (isRecord(reply) && reply.status === 'ok' && typeof reply.blendId === 'string' && typeof reply.inviterName === 'string'
      && typeof reply.memberCount === 'number' && typeof reply.full === 'boolean') {
      return { status: 'ok', blendId: reply.blendId, inviterName: reply.inviterName, memberCount: reply.memberCount, full: reply.full };
    }
    return { status: 'notfound' };
  }

  public async join(input: { code: string; userId: string; displayName: string; consent: BlendConsent; learning: boolean }) {
    const reply = await mapped(this.convex.mutation('blends:join', { ...input }));
    if (!isRecord(reply) || typeof reply.blendId !== 'string') throw new Error('Unexpected blend reply');
    return { blendId: reply.blendId };
  }

  public async leave(blendId: string, userId: string): Promise<void> {
    await mapped(this.convex.mutation('blends:leave', { blendId, userId }));
  }

  public async rename(blendId: string, userId: string, name: string): Promise<void> {
    await mapped(this.convex.mutation('blends:rename', { blendId, userId, name }));
  }

  public async saveBuild(input: SaveBuildInput): Promise<{ saved: boolean }> {
    const reply = await mapped(this.convex.mutation('blends:saveBuild', { ...input }));
    return { saved: isRecord(reply) && reply.saved === true };
  }

  public async claimBuild(input: { blendId: string; userId: string; inputVersion: number; builtFor: string; token: string; leaseUntil: number }): Promise<{ claimed: boolean }> {
    const reply = await this.convex.mutation('blends:claimBuild', input);
    return { claimed: isRecord(reply) && reply.claimed === true };
  }

  public async releaseBuild(blendId: string, token: string): Promise<void> {
    await this.convex.mutation('blends:releaseBuild', { blendId, token });
  }

  public async setLearning(userId: string, learning: boolean): Promise<void> {
    await this.convex.mutation('blends:setLearning', { userId, learning });
  }

  public async renameMember(userId: string, displayName: string): Promise<void> {
    await this.convex.mutation('blends:renameMember', { userId, displayName });
  }
}
