/**
 * The Blend seam (PLAN.md B2): membership, invites and the stored daily build. Adapters:
 * ConvexBlendStore (db/convexBlendStore.ts, convex/blends.ts) and MemoryBlendStore (tests and local
 * development without Convex), which enforce the same rules.
 */
import { randomUUID } from 'node:crypto';

import {
  BLEND_DISPLAY_NAME_MAX,
  BLEND_INVITE_DAYS,
  BLEND_MAX_MEMBERS,
  BLEND_MAX_PER_USER,
  BLEND_NAME_MAX,
  isBlendInviteCode
} from '../shared/blendLimits.js';
import type { BlendTrack, PairMatch } from '../shared/blendTypes.js';
import type { SongSnapshot } from '../shared/songRef.js';

export type BlendErrorCode = 'full' | 'limit' | 'notfound' | 'expired' | 'invalid';

export class BlendError extends Error {
  public constructor(public readonly code: BlendErrorCode) {
    super(`blend: ${code}`);
    this.name = 'BlendError';
  }
}

export interface BlendConsent {
  readonly policyVersion: string;
  /** ms since epoch. */
  readonly at: number;
}

export interface BlendMemberRecord {
  readonly userId: string;
  readonly displayName: string;
  readonly joinedAt: number;
  readonly learning: boolean;
}

export interface StoredStorySong {
  readonly identity: string;
  readonly variant: 'together' | 'closest';
  readonly song: SongSnapshot;
}

export interface StoredGift {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly identity: string;
  readonly song: SongSnapshot;
}

export interface StoredBlend {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly memberCount: number;
  readonly createdAt: number;
  readonly builtFor?: string;
  readonly buildVersion: number;
  readonly inputVersion?: number;
  readonly stale: boolean;
  readonly tracks: readonly BlendTrack[];
  readonly pairs: readonly PairMatch[];
  readonly previousPairs: readonly PairMatch[];
  readonly previousTracks: readonly string[];
  readonly together?: StoredStorySong;
  readonly gifts?: readonly StoredGift[];
  readonly glue?: readonly string[];
  /** In join order. */
  readonly members: readonly BlendMemberRecord[];
}

export interface BlendListEntry {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly joinedAt: number;
  readonly builtFor?: string;
  readonly members: readonly BlendMemberRecord[];
}

export type BlendPreview =
  | { readonly status: 'ok'; readonly blendId: string; readonly inviterName: string; readonly memberCount: number; readonly full: boolean }
  | { readonly status: 'notfound' };

export interface SaveBuildInput {
  readonly blendId: string;
  readonly expectedVersion: number;
  readonly expectedInputVersion: number;
  readonly leaseToken?: string;
  readonly builtFor: string;
  readonly tracks: readonly BlendTrack[];
  readonly pairs: readonly PairMatch[];
  readonly together?: StoredStorySong;
  readonly gifts: readonly StoredGift[];
  readonly glue: readonly string[];
  /** The build's track identities, for the next builds' freshness rule. */
  readonly identities: readonly string[];
}

export interface BlendStore {
  create(input: { userId: string; displayName: string; name: string; consent: BlendConsent; learning: boolean; code: string; operationId?: string }): Promise<{ blendId: string; code: string; expiresAt: number }>;
  /** Null when it does not exist or the caller is not a member. */
  get(blendId: string, userId: string): Promise<StoredBlend | null>;
  listForUser(userId: string): Promise<readonly BlendListEntry[]>;
  /** The live invite, or a new one with `code` when none is live or `regenerate`. */
  invite(blendId: string, userId: string, code: string, regenerate: boolean): Promise<{ code: string; expiresAt: number }>;
  preview(code: string, now: number): Promise<BlendPreview>;
  join(input: { code: string; userId: string; displayName: string; consent: BlendConsent; learning: boolean }): Promise<{ blendId: string }>;
  leave(blendId: string, userId: string): Promise<void>;
  rename(blendId: string, userId: string, name: string): Promise<void>;
  /** Compare-and-set on `expectedVersion`. */
  saveBuild(input: SaveBuildInput): Promise<{ saved: boolean }>;
  claimBuild(input: { blendId: string; userId: string; inputVersion: number; builtFor: string; token: string; leaseUntil: number }): Promise<{ claimed: boolean }>;
  releaseBuild(blendId: string, token: string): Promise<void>;
  setLearning(userId: string, learning: boolean): Promise<void>;
  renameMember(userId: string, displayName: string): Promise<void>;
  /**
   * Leaves every Blend after an account erase. Only the memory store needs it: in Convex the
   * account erase applies the leave rules itself.
   */
  forget?(userId: string): Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (value: string, max: number): string => value.trim().replace(/\s+/g, ' ').slice(0, max);

interface MemoryBlend extends Omit<StoredBlend, 'members' | 'id' | 'together'> {
  members: BlendMemberRecord[];
  together?: StoredStorySong;
}

interface MemoryInvite {
  readonly code: string;
  readonly blendId: string;
  readonly createdBy: string;
  readonly createdAt: number;
  expiresAt: number;
}

function invalidateMemoryBuild(blend: MemoryBlend, changes: Partial<MemoryBlend> = {}): MemoryBlend {
  const stored: Record<string, unknown> = { ...blend };
  for (const field of ['builtFor', 'together', 'gifts', 'glue']) delete stored[field];
  return {
    ...stored,
    ...changes,
    inputVersion: (blend.inputVersion ?? 0) + 1,
    tracks: [], pairs: [], previousPairs: [], previousTracks: [],
    stale: true
  } as MemoryBlend;
}

/** The rules of convex/blends.ts, in memory. */
export class MemoryBlendStore implements BlendStore {
  private readonly blends = new Map<string, MemoryBlend>();
  private readonly invites = new Map<string, MemoryInvite>();
  private readonly operations = new Map<string, { fingerprint: string; result: { blendId: string; code: string; expiresAt: number }; expiresAt: number }>();
  private readonly leases = new Map<string, { token: string; inputVersion: number; builtFor: string; expiresAt: number }>();

  public constructor(private readonly now: () => number = Date.now) {}

  public async create(input: { userId: string; displayName: string; name: string; consent: BlendConsent; learning: boolean; code: string; operationId?: string }): Promise<{ blendId: string; code: string; expiresAt: number }> {
    const name = clean(input.name, BLEND_NAME_MAX);
    if (!name || !isBlendInviteCode(input.code)) throw new BlendError('invalid');
    const now = this.now();
    for (const [key, operation] of this.operations) if (operation.expiresAt <= now) this.operations.delete(key);
    const operationKey = input.operationId ? `${input.userId}:${input.operationId}` : undefined;
    const fingerprint = `${name}\n${input.consent.policyVersion}`;
    const prior = operationKey ? this.operations.get(operationKey) : undefined;
    if (prior && prior.expiresAt > now) {
      if (prior.fingerprint !== fingerprint) throw new BlendError('invalid');
      return prior.result;
    }
    if (operationKey) this.operations.delete(operationKey);
    if (this.countFor(input.userId) >= BLEND_MAX_PER_USER) throw new BlendError('limit');
    const blendId = randomUUID();
    this.blends.set(blendId, {
      name, ownerId: input.userId, memberCount: 1, createdAt: now, buildVersion: 0, inputVersion: 0, stale: true,
      tracks: [], pairs: [], previousPairs: [], previousTracks: [],
      members: [{ userId: input.userId, displayName: clean(input.displayName, BLEND_DISPLAY_NAME_MAX) || 'Listener', joinedAt: now, learning: input.learning }]
    });
    const expiresAt = now + BLEND_INVITE_DAYS * DAY_MS;
    this.invites.set(input.code, { code: input.code, blendId, createdBy: input.userId, createdAt: now, expiresAt });
    const result = { blendId, code: input.code, expiresAt };
    if (operationKey) this.operations.set(operationKey, { fingerprint, result, expiresAt: now + 24 * 60 * 60 * 1000 });
    return result;
  }

  public async get(blendId: string, userId: string): Promise<StoredBlend | null> {
    const blend = this.blends.get(blendId);
    if (!blend || !blend.members.some((member) => member.userId === userId)) return null;
    return { id: blendId, ...blend, members: [...blend.members] };
  }

  public async listForUser(userId: string): Promise<readonly BlendListEntry[]> {
    return [...this.blends]
      .flatMap(([id, blend]) => {
        const mine = blend.members.find((member) => member.userId === userId);
        return mine ? [{ id, name: blend.name, memberCount: blend.memberCount, joinedAt: mine.joinedAt, ...(blend.builtFor ? { builtFor: blend.builtFor } : {}), members: [...blend.members] }] : [];
      })
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .slice(0, BLEND_MAX_PER_USER);
  }

  public async invite(blendId: string, userId: string, code: string, regenerate: boolean): Promise<{ code: string; expiresAt: number }> {
    const blend = this.blends.get(blendId);
    if (!blend || !blend.members.some((member) => member.userId === userId)) throw new BlendError('notfound');
    const now = this.now();
    const live = [...this.invites.values()].filter((invite) => invite.blendId === blendId && invite.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (live && !regenerate) return { code: live.code, expiresAt: live.expiresAt };
    if (!isBlendInviteCode(code)) throw new BlendError('invalid');
    for (const invite of this.invites.values()) if (invite.blendId === blendId && invite.expiresAt > now) invite.expiresAt = now;
    const expiresAt = now + BLEND_INVITE_DAYS * DAY_MS;
    this.invites.set(code, { code, blendId, createdBy: userId, createdAt: now, expiresAt });
    const history = [...this.invites.values()].filter((invite) => invite.blendId === blendId && invite.code !== code).sort((a, b) => b.createdAt - a.createdAt);
    for (const old of history.slice(49)) this.invites.delete(old.code);
    return { code, expiresAt };
  }

  public async preview(code: string, now: number): Promise<BlendPreview> {
    const invite = isBlendInviteCode(code) ? this.invites.get(code) : undefined;
    const blend = invite && invite.expiresAt > now ? this.blends.get(invite.blendId) : undefined;
    if (!invite || !blend) return { status: 'notfound' };
    const inviter = blend.members.find((member) => member.userId === invite.createdBy) ?? blend.members[0];
    return { status: 'ok', blendId: invite.blendId, inviterName: inviter?.displayName ?? 'Listener', memberCount: blend.memberCount, full: blend.memberCount >= BLEND_MAX_MEMBERS };
  }

  public async join(input: { code: string; userId: string; displayName: string; consent: BlendConsent; learning: boolean }): Promise<{ blendId: string }> {
    const invite = isBlendInviteCode(input.code) ? this.invites.get(input.code) : undefined;
    const blend = invite ? this.blends.get(invite.blendId) : undefined;
    if (!invite || !blend) throw new BlendError('notfound');
    if (blend.members.some((member) => member.userId === input.userId)) return { blendId: invite.blendId };
    if (invite.expiresAt <= this.now()) throw new BlendError('expired');
    if (blend.memberCount >= BLEND_MAX_MEMBERS) throw new BlendError('full');
    if (this.countFor(input.userId) >= BLEND_MAX_PER_USER) throw new BlendError('limit');
    blend.members.push({ userId: input.userId, displayName: clean(input.displayName, BLEND_DISPLAY_NAME_MAX) || 'Listener', joinedAt: this.now(), learning: input.learning });
    this.blends.set(invite.blendId, invalidateMemoryBuild(blend, { memberCount: blend.members.length }));
    return { blendId: invite.blendId };
  }

  public async leave(blendId: string, userId: string): Promise<void> {
    if (!this.leaveOne(blendId, userId)) throw new BlendError('notfound');
  }

  public async rename(blendId: string, userId: string, name: string): Promise<void> {
    const blend = this.blends.get(blendId);
    if (!blend || blend.ownerId !== userId) throw new BlendError('notfound');
    const cleaned = clean(name, BLEND_NAME_MAX);
    if (!cleaned || name.trim().length > BLEND_NAME_MAX) throw new BlendError('invalid');
    this.blends.set(blendId, { ...blend, name: cleaned });
  }

  public async claimBuild(input: { blendId: string; userId: string; inputVersion: number; builtFor: string; token: string; leaseUntil: number }): Promise<{ claimed: boolean }> {
    const blend = this.blends.get(input.blendId);
    if (!blend || !blend.members.some((member) => member.userId === input.userId)) return { claimed: false };
    if ((blend.inputVersion ?? 0) !== input.inputVersion || (blend.builtFor === input.builtFor && !blend.stale)) return { claimed: false };
    const lease = this.leases.get(input.blendId);
    if (lease && lease.expiresAt > this.now()) return { claimed: false };
    this.leases.set(input.blendId, { token: input.token, inputVersion: input.inputVersion, builtFor: input.builtFor, expiresAt: Math.min(input.leaseUntil, this.now() + 60_000) });
    return { claimed: true };
  }

  public async releaseBuild(blendId: string, token: string): Promise<void> {
    if (this.leases.get(blendId)?.token === token) this.leases.delete(blendId);
  }

  public async saveBuild(input: SaveBuildInput): Promise<{ saved: boolean }> {
    const blend = this.blends.get(input.blendId);
    if (!blend || blend.buildVersion !== input.expectedVersion || (blend.inputVersion ?? 0) !== input.expectedInputVersion) return { saved: false };
    const lease = this.leases.get(input.blendId);
    if (lease && lease.expiresAt > this.now() &&
      (lease.token !== input.leaseToken || lease.inputVersion !== input.expectedInputVersion || lease.builtFor !== input.builtFor)) return { saved: false };
    // Same rule as convex/blends.ts saveBuild: a build can only name current members.
    const known = (id: string): boolean => blend.members.some((member) => member.userId === id);
    if (!input.tracks.every((track) => track.for.every(known)) || !input.pairs.every((pair) => known(pair.a) && known(pair.b))
      || !(input.gifts ?? []).every((gift) => known(gift.fromUserId) && known(gift.toUserId))) return { saved: false };
    // The build being replaced is the first `tracks.length` identities: keep it and the new one only.
    const lastBuild = blend.previousTracks.slice(0, blend.tracks.length);
    const rest: MemoryBlend = { ...blend };
    delete rest.together;
    this.blends.set(input.blendId, {
      ...rest,
      builtFor: input.builtFor,
      tracks: input.tracks,
      previousPairs: blend.pairs.length > 0 ? blend.pairs : blend.previousPairs,
      pairs: input.pairs,
      previousTracks: [...input.identities, ...lastBuild.filter((identity) => !input.identities.includes(identity))].slice(0, 100),
      ...(input.together ? { together: input.together } : {}),
      gifts: input.gifts,
      glue: input.glue,
      buildVersion: blend.buildVersion + 1,
      inputVersion: blend.inputVersion ?? 0,
      stale: false
    });
    this.leases.delete(input.blendId);
    return { saved: true };
  }

  public async setLearning(userId: string, learning: boolean): Promise<void> {
    for (const [id, blend] of this.blends) {
      const index = blend.members.findIndex((member) => member.userId === userId && member.learning !== learning);
      const member = blend.members[index];
      if (!member) continue;
      blend.members[index] = { ...member, learning };
      this.blends.set(id, invalidateMemoryBuild(blend));
    }
  }

  public async renameMember(userId: string, displayName: string): Promise<void> {
    const name = clean(displayName, BLEND_DISPLAY_NAME_MAX) || 'Listener';
    for (const blend of this.blends.values()) {
      blend.members = blend.members.map((member) => (member.userId === userId ? { ...member, displayName: name } : member));
    }
  }

  public async forget(userId: string): Promise<void> {
    for (const id of [...this.blends.keys()]) this.leaveOne(id, userId);
  }

  private leaveOne(blendId: string, userId: string): boolean {
    const blend = this.blends.get(blendId);
    if (!blend || !blend.members.some((member) => member.userId === userId)) return false;
    const members = blend.members.filter((member) => member.userId !== userId);
    const heir = members[0];
    if (!heir) {
      this.blends.delete(blendId);
      for (const [code, invite] of this.invites) if (invite.blendId === blendId) this.invites.delete(code);
      return true;
    }
    for (const [code, invite] of this.invites) {
      if (invite.blendId === blendId && invite.createdBy === userId) this.invites.set(code, { ...invite, createdBy: heir.userId });
    }
    this.blends.set(blendId, invalidateMemoryBuild(blend, {
      members, memberCount: members.length, ownerId: blend.ownerId === userId ? heir.userId : blend.ownerId
    }));
    return true;
  }

  private countFor(userId: string): number {
    let count = 0;
    for (const blend of this.blends.values()) if (blend.members.some((member) => member.userId === userId)) count += 1;
    return count;
  }
}
