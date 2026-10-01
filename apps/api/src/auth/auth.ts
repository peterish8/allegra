import crypto from 'node:crypto';

import { PersistenceError } from '../lib/errors.js';
import { MemoryLibraryStore, type LibraryStore } from '../user/library.js';
import { opsForGuestMerge } from '../user/libraryOps.js';
import type { SongSnapshot } from '../shared/songRef.js';
import { MemoryUserStore, type ProfileChange, type UserData, type UserStore } from '../user/store.js';
import { mergeTaste } from '../user/taste.js';
import type { GuestTokenVerifier, TokenVerifier, VerifiedCaller } from './verifier.js';

export interface AuthUser {
  readonly userId: string;
}

export interface Session {
  readonly token: string;
  readonly userId: string;
}

/** What the identity provider knows about someone, copied onto their profile once. */
export interface Identity {
  readonly email?: string;
  readonly displayName?: string;
}

/** Seam for reading a signed-in identity. Convex implements it; in-memory setups do not need to. */
export interface IdentityDirectory {
  identity(userId: string): Promise<Identity | null>;
}

export interface AuthServiceOptions {
  readonly store: UserStore;
  /** Signs and checks guest tokens. */
  readonly guest: GuestTokenVerifier;
  /** Guest tokens plus, when configured, Convex Auth sessions. */
  readonly verifier: TokenVerifier;
  readonly directory?: IdentityDirectory;
  /** Where likes and playlists change. Defaults to an in-memory one beside a MemoryUserStore. */
  readonly library?: LibraryStore;
  /** Best-effort catalog details for guest library rows copied to an account. */
  readonly songSnapshots?: (songIds: readonly string[]) => Promise<ReadonlyMap<string, SongSnapshot>>;
}

/**
 * Who the caller is, and what happens the first time a real account appears.
 *
 * Sign-in itself is not here: Convex Auth owns Google and issues the session token.
 * This service only decides which profile a verified token belongs to.
 */
export class AuthService {
  private readonly store: UserStore;
  private readonly guest: GuestTokenVerifier;
  private readonly verifier: TokenVerifier;
  private readonly directory: IdentityDirectory | undefined;
  private readonly libraryStore: LibraryStore | undefined;
  private readonly songSnapshots: AuthServiceOptions['songSnapshots'];

  public constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.guest = options.guest;
    this.verifier = options.verifier;
    this.directory = options.directory;
    this.libraryStore = options.library ?? (options.store instanceof MemoryUserStore ? new MemoryLibraryStore(options.store) : undefined);
    this.songSnapshots = options.songSnapshots;
  }

  public async createGuest(): Promise<Session> {
    const userId = crypto.randomUUID();
    await this.persist(emptyProfile(userId, true));
    return { token: this.guest.sign(userId), userId };
  }

  /**
   * Resolves a bearer token to a profile id, creating the profile the first time a
   * Google account signs in. Returns null when the token is not ours.
   */
  public async resolveCaller(token: string): Promise<VerifiedCaller | null> {
    const caller = await this.verifier.verify(token);
    if (!caller) return null;
    if (caller.source === 'guest') return caller;

    if (!(await this.getUser(caller.userId))) await this.createAccountProfile(caller.userId);
    return caller;
  }

  /**
   * The caller's profile from their bearer token, in one profile read: what every route that
   * needs the listener's data asks for. Creates the profile the first time a Google account
   * signs in, exactly as `resolveCaller` does. Null when the token is not ours, or a guest
   * token's profile is gone.
   *
   * Hand the result to `updateProfile` as its `base` and a request that writes reads once too.
   */
  public async resolveUser(token: string): Promise<UserData | null> {
    const caller = await this.verifier.verify(token);
    if (!caller) return null;
    const existing = await this.getUser(caller.userId);
    if (existing || caller.source === 'guest') return existing;
    return this.createAccountProfile(caller.userId);
  }

  private async createAccountProfile(userId: string): Promise<UserData> {
    const identity = (await this.directory?.identity(userId).catch(() => null)) ?? null;
    const profile: UserData = {
      ...emptyProfile(userId, false),
      ...(identity?.email ? { email: identity.email } : {}),
      ...(identity?.displayName ? { displayName: identity.displayName.slice(0, 60) } : {})
    };
    await this.persist(profile);
    return profile;
  }

  /**
   * Folds what this browser did as a guest into the account that just signed in, so
   * nothing built before signing in is lost. Safe to call twice: merging is a union.
   */
  public async linkGuest(guestUserId: string, accountUserId: string): Promise<void> {
    if (guestUserId === accountUserId) return;
    const [guest, account] = await Promise.all([this.getUser(guestUserId), this.getUser(accountUserId)]);
    if (!guest?.isGuest || !account || !hasContent(guest)) return;
    await this.updateProfile(accountUserId, (current) => mergeGuestInto(current, guest));
    // Likes and playlists move as library operations, like every other library change.
    const ids = guestSongIdsToCopy(account, guest);
    let snapshots: ReadonlyMap<string, SongSnapshot> = new Map();
    try {
      snapshots = (await this.songSnapshots?.(ids)) ?? snapshots;
    } catch {
      // The merge still succeeds if a catalog provider is unavailable.
    }
    const ops = opsForGuestMerge(account, guest, Date.now(), snapshots);
    if (ops.length > 0) await this.library.apply(accountUserId, ops);
  }

  public async getUser(userId: string): Promise<UserData | null> {
    try {
      return await this.store.get(userId);
    } catch {
      throw new PersistenceError();
    }
  }

  /**
   * Changes a profile atomically (UserStore.update): `change` gets the newest copy and may run
   * more than once, so look things up before calling this. Resolves to the saved profile, or
   * null when there is none.
   *
   * `base` is the profile this request already read (`resolveUser`, `getUser`): the change starts
   * from it instead of reading again, and is re-applied to a fresh read if it was out of date.
   */
  public async updateProfile(userId: string, change: ProfileChange, base?: UserData): Promise<UserData | null> {
    try {
      return await this.store.update(userId, change, base);
    } catch {
      throw new PersistenceError();
    }
  }

  /** The only way likes and playlists change (user/library.ts). */
  public get library(): LibraryStore {
    if (!this.libraryStore) throw new PersistenceError();
    return this.libraryStore;
  }

  private async persist(user: UserData): Promise<void> {
    try {
      await this.store.save(user);
    } catch {
      throw new PersistenceError();
    }
  }
}

function emptyProfile(userId: string, isGuest: boolean): UserData {
  return {
    userId,
    isGuest,
    createdAt: new Date().toISOString(),
    libraries: [],
    likedSongIds: [],
    recentlyPlayed: [],
    settings: {}
  };
}

function guestSongIdsToCopy(account: UserData, guest: UserData): string[] {
  const ids = new Set<string>();
  const accountLikes = new Set(account.likedSongIds);
  for (const id of guest.likedSongIds) if (!accountLikes.has(id)) ids.add(id);

  const accountPlaylists = new Set(account.libraries.map((library) => library.id));
  for (const library of guest.libraries) {
    if (!accountPlaylists.has(library.id)) for (const id of library.songIds) ids.add(id);
  }
  return [...ids];
}

function hasContent(user: UserData): boolean {
  return user.likedSongIds.length > 0 || user.libraries.length > 0 || user.recentlyPlayed.length > 0 || Boolean(user.taste);
}

/** Account data wins on conflicts; the guest's likes, playlists, plays and taste are added underneath it. */
export function mergeGuestInto(account: UserData, guest: UserData): UserData {
  const likedSongIds = [...new Set([...account.likedSongIds, ...guest.likedSongIds])];
  const known = new Set(account.libraries.map((library) => library.id));
  const libraries = [...account.libraries, ...guest.libraries.filter((library) => !known.has(library.id))];
  const recentlyPlayed = [...account.recentlyPlayed, ...guest.recentlyPlayed]
    .sort((left, right) => right.playedAt.localeCompare(left.playedAt))
    .filter((entry, index, all) => all.findIndex((other) => other.songId === entry.songId) === index)
    .slice(0, 50);
  const taste = account.taste && guest.taste ? mergeTaste(account.taste, guest.taste) : (account.taste ?? guest.taste);
  return { ...account, likedSongIds, libraries, recentlyPlayed, ...(taste ? { taste } : {}) };
}

export function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith('Bearer ')) {
    return null;
  }
  return value.slice('Bearer '.length).trim() || null;
}
