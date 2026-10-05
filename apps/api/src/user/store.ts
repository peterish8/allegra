export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
  /** S3 object key for a custom cover. Never a browser-facing URL. */
  readonly coverKey?: string;
  /** Derived for the client from coverKey + the public/CloudFront base. Not persisted. */
  readonly coverUrl?: string;
}

/** Recent listens kept per listener. Older ones are dropped on every write, not archived. */
export const RECENTLY_PLAYED_LIMIT = 25;

import type { Consent, ReportReason } from '../shared/legal.js';
import type { SongRef, SongSnapshot } from '../shared/songRef.js';

export interface RecentRecord {
  readonly songId: string;
  readonly playDuration: number;
  readonly playedAt: string;
  /** Provider identity and display data keep Gaana plays distinct from colliding Saavn ids. */
  readonly songRef?: SongRef;
  readonly song?: SongSnapshot;
  /** An idempotency marker for the post-play duration signal sent by offline clients. */
  readonly listenSignalApplied?: boolean;
}

export interface TasteEntry {
  readonly name: string;
  readonly score: number;
}

/** What the listener's behaviour has taught us. Grown a little on every play, like, and playlist add. */
export interface TasteProfile {
  readonly artists: TasteEntry[];
  readonly languages: TasteEntry[];
  /** How many signals have fed this profile; a cheap gauge of how much we know. */
  readonly signals: number;
  /** True once the listener picked favourites (or we have seen enough listening to skip asking). */
  readonly onboarded: boolean;
  readonly updatedAt: string;
}

export interface UserData {
  readonly userId: string;
  readonly isGuest: boolean;
  readonly createdAt: string;
  readonly libraries: LibraryRecord[];
  readonly likedSongIds: string[];
  readonly recentlyPlayed: RecentRecord[];
  readonly settings: Record<string, unknown>;
  readonly displayName?: string;
  readonly email?: string;
  readonly taste?: TasteProfile;
  /** When the listener agreed to the policies, and which version. */
  readonly consent?: Consent;
  /** Server time (ms) of the last write, where the store keeps one. The retention sweep reads it. */
  readonly lastActiveAt?: number;
}

/**
 * False once the listener switched off "learn from my listening" (`settings.personalization`).
 * Then nothing is recorded about what they play and nothing is learned from it; turning it off
 * also erases what was already learned (routes/user.ts).
 */
export function isPersonalised(user: Pick<UserData, 'settings'>): boolean {
  return user.settings.personalization !== false;
}

/** A complaint about a shared playlist, for the grievance officer. */
export interface ReportDraft {
  readonly code: string;
  readonly reason: ReportReason;
  readonly details?: string;
  readonly contact?: string;
}

/** What a listener's export holds beyond their profile and library. */
export interface AccountExtras {
  readonly complete: boolean;
  readonly shares: readonly { readonly code: string; readonly libraryId: string; readonly createdAt: string }[];
  readonly devices: readonly { readonly name: string; readonly kind: string; readonly appVersion: string; readonly createdAt: number }[];
}

/** A playlist someone shared. It points at the owner's playlist, so it stays live. */
export interface ShareRecord {
  readonly code: string;
  readonly ownerId: string;
  readonly libraryId: string;
  readonly createdAt: string;
}

/**
 * A change to one profile, computed from its newest copy. Return the new profile, or null to
 * leave it as it is. It may run more than once (see UserStore.update), so it must not have side
 * effects: look anything up first, then describe the change.
 */
export type ProfileChange = (current: UserData) => UserData | null;

export interface UserStore {
  /** True when preference write and taste/Blend privacy fencing share one backend transaction. */
  readonly atomicLearningPrivacy?: boolean;
  get(userId: string): Promise<UserData | null>;
  findByEmail(email: string): Promise<UserData | null>;
  /** Creates a profile. Changing one goes through `update`, so no write can undo another. */
  save(user: UserData): Promise<void>;
  /**
   * Applies `change` to the newest copy of the profile and saves it only if nobody else saved
   * in between; otherwise re-reads and applies it again. Two devices changing taste, plays or
   * settings at once therefore both land. Resolves to the saved profile (the unchanged one when
   * `change` returns null), or null when there is no such profile.
   *
   * `base` is this profile as the caller read it earlier in the same request (from `get`, or what
   * a previous `update` resolved to). A store may start from it instead of reading again; the
   * save still fails when someone else wrote since, and then it re-reads as usual. So a request
   * costs one profile read however many times it writes.
   */
  update(userId: string, change: ProfileChange, base?: UserData): Promise<UserData | null>;
  getShare(code: string): Promise<ShareRecord | null>;
  findShare(ownerId: string, libraryId: string): Promise<ShareRecord | null>;
  saveShare(share: ShareRecord): Promise<void>;
  deleteShare(code: string): Promise<void>;
  /** Share links and devices, for the listener's data export. */
  accountExtras(userId: string): Promise<AccountExtras>;
  /**
   * Erases everything held about this listener: profile, library, covers, share links, devices
   * and the sign-in identity. Safe to repeat.
   */
  erase(userId: string): Promise<void>;
  /** Records a complaint against a live share link. False when there is no such link. */
  fileReport(report: ReportDraft): Promise<boolean>;
}

/**
 * Once a LibraryStore owns a listener's library (their first like or playlist change), `save`
 * keeps the stored likedSongIds/libraries and ignores the ones passed in: those arrays are a
 * copy the library store rebuilds, and a whole-profile save (a taste or settings update) must
 * never undo a library change that happened in between. convex/profiles.ts `save` does the same.
 */
export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserData>();
  private readonly shares = new Map<string, ShareRecord>();
  private readonly libraryOwned = new Set<string>();
  /** What `fileReport` recorded, for tests to read. */
  public readonly reports: ReportDraft[] = [];

  public async get(userId: string): Promise<UserData | null> {
    return this.users.get(userId) ?? null;
  }

  /** For MemoryLibraryStore: from now on this listener's library copy is written only through writeLibraryCopy. */
  public ownLibrary(userId: string): void {
    this.libraryOwned.add(userId);
  }

  /** For MemoryLibraryStore: replace the profile's library copy. */
  public writeLibraryCopy(userId: string, copy: Pick<UserData, 'likedSongIds' | 'libraries'>): void {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, likedSongIds: copy.likedSongIds, libraries: copy.libraries });
  }

  public async findByEmail(email: string): Promise<UserData | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  public async save(user: UserData): Promise<void> {
    this.write(user);
  }

  private write(user: UserData): void {
    const existing = this.users.get(user.userId);
    this.users.set(
      user.userId,
      existing && this.libraryOwned.has(user.userId) ? { ...user, likedSongIds: existing.likedSongIds, libraries: existing.libraries } : user
    );
  }

  public async update(userId: string, change: ProfileChange): Promise<UserData | null> {
    // No await between the read and the write, so nothing can land in between.
    const current = this.users.get(userId);
    if (!current) return null;
    const next = change(current);
    if (!next) return current;
    this.write({ ...next, userId });
    return this.users.get(userId) ?? null;
  }

  public async getShare(code: string): Promise<ShareRecord | null> {
    return this.shares.get(code) ?? null;
  }

  public async findShare(ownerId: string, libraryId: string): Promise<ShareRecord | null> {
    for (const share of this.shares.values()) {
      if (share.ownerId === ownerId && share.libraryId === libraryId) return share;
    }
    return null;
  }

  public async saveShare(share: ShareRecord): Promise<void> {
    this.shares.set(share.code, share);
  }

  public async deleteShare(code: string): Promise<void> {
    this.shares.delete(code);
  }

  public async accountExtras(userId: string): Promise<AccountExtras> {
    const shares = [...this.shares.values()]
      .filter((share) => share.ownerId === userId)
      .map((share) => ({ code: share.code, libraryId: share.libraryId, createdAt: share.createdAt }));
    return { shares, devices: [], complete: true };
  }

  public async erase(userId: string): Promise<void> {
    this.users.delete(userId);
    this.libraryOwned.delete(userId);
    for (const share of [...this.shares.values()]) {
      if (share.ownerId === userId) this.shares.delete(share.code);
    }
  }

  public async fileReport(report: ReportDraft): Promise<boolean> {
    if (!this.shares.has(report.code)) return false;
    this.reports.push(report);
    return true;
  }
}
