import crypto from 'node:crypto';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import type { CoverStorage } from '../lib/covers.js';
import { NotFoundError } from '../lib/errors.js';
import { CODE_ALPHABET, randomCode } from '../lib/randomCode.js';
import { alignOpTimes, type LibraryOp, type PlaylistCover, type RejectReason } from '../shared/library.js';
import { parseSongRef, type SongRef, type SongSnapshot } from '../shared/songRef.js';
import type { UnifiedSong } from '../types.js';
import { opsForPlaylistCopy, refForId, snapshotOf, unifiedSongFromSnapshot } from './libraryOps.js';
import { RECENTLY_PLAYED_LIMIT, isPersonalised, type LibraryRecord, type RecentRecord, type UserData, type UserStore } from './store.js';
import { SIGNAL_WEIGHT, applySignal, playWeight, type ListenEnding } from './taste.js';
import type { TasteTally } from './tasteTally.js';

/** Eight url-safe characters (~10^11 codes): long enough not to guess, short enough to read out loud. */
const CODE_SHAPE = new RegExp(`^[${CODE_ALPHABET}]{6,12}$`);

export function isShareCode(code: string): boolean {
  return CODE_SHAPE.test(code);
}

export interface PlaylistDraft {
  readonly name: string;
  readonly description?: string;
  readonly isPublic?: boolean;
}

export interface PlaylistEdit {
  readonly name?: string;
  /** null clears it. */
  readonly description?: string | null;
  readonly isPublic?: boolean;
  /** An already-checked upload; null removes the cover. */
  readonly cover?: PlaylistCover | null;
}

export interface SharedPlaylist {
  readonly owner: UserData;
  readonly library: LibraryRecord;
}

/** When a device's batch arrived (server clock) and, if it said, what its own clock read as it left. */
export interface DeviceClock {
  readonly receivedAt: number;
  readonly sentAt?: number;
}

/** The reply to a device's batch (docs/api-contract.md, `POST /api/me/library/ops`). */
export interface DeviceBatchResult {
  readonly rev: number;
  readonly rejected: readonly { readonly index: number; readonly reason: RejectReason }[];
  readonly superseded: readonly number[];
  readonly applied: number;
}

/**
 * What a listener does, whoever asks for it: the website's routes, the MCP tools and the phone's
 * sync all come through here, so a like means the same thing from every one of them.
 *
 * Each library change is one operation (user/library.ts) carrying the song's details, so every
 * device can show it without looking it up; taste learns from it once; and a playlist cover
 * nothing uses any more is deleted. Profile changes go through AuthService.updateProfile, so
 * concurrent actions never undo each other.
 *
 * A playlist or song that isn't there throws NotFoundError. The catalog being down never fails
 * an action: the change still lands, without details, and nothing is learned from it.
 */
export class ListenerActions {
  public constructor(
    private readonly auth: AuthService,
    private readonly users: UserStore,
    private readonly catalog: CatalogService,
    private readonly covers: CoverStorage | undefined,
    private readonly now: () => number = Date.now,
    private readonly tally?: TasteTally
  ) {}

  // ── Likes ─────────────────────────────────────────────────────────────────

  public async like(user: UserData, songId: string): Promise<void> {
    const ref = refOf(songId);
    const song = await this.lookUp(songId);
    const at = this.now();
    const alreadyLiked = user.likedSongIds.includes(songId);
    await this.apply(user.userId, [{ op: 'like', ref, ...withSnapshot(song), at }]);
    if (song && !alreadyLiked) {
      if (isPersonalised(user)) {
        const snapshot = snapshotOf(song);
        if (snapshot) await this.tallySafely(() => this.tally!.bonus(user.userId, snapshot, 'like', at));
      }
      await this.learn(user, song, SIGNAL_WEIGHT.like);
    }
  }

  public async unlike(user: UserData, songId: string): Promise<void> {
    const ref = refForId(songId);
    if (!ref) return; // never liked: nothing to undo
    const at = this.now();
    const wasLiked = user.likedSongIds.includes(songId);
    await this.apply(user.userId, [{ op: 'unlike', ref, at }]);
    if (!wasLiked) return;
    const song = await this.lookUp(songId);
    if (song) {
      if (isPersonalised(user)) {
        const snapshot = snapshotOf(song);
        if (snapshot) await this.tallySafely(() => this.tally!.bonus(user.userId, snapshot, 'unlike', at));
      }
      await this.learn(user, song, SIGNAL_WEIGHT.unlike);
    }
  }

  // ── Playlists ─────────────────────────────────────────────────────────────

  public async createPlaylist(user: UserData, draft: PlaylistDraft): Promise<LibraryRecord> {
    const id = crypto.randomUUID();
    const description = draft.description?.trim().slice(0, 500);
    await this.apply(user.userId, [
      {
        op: 'playlist_upsert',
        playlistId: id,
        name: draft.name.trim().slice(0, 100),
        ...(description ? { description } : {}),
        isPublic: draft.isPublic === true,
        at: this.now()
      }
    ]);
    return this.playlistAfter(user.userId, id);
  }

  public async updatePlaylist(user: UserData, playlistId: string, edit: PlaylistEdit): Promise<LibraryRecord> {
    const library = playlistOf(user, playlistId);
    const name = edit.name?.trim().slice(0, 100);
    const description = edit.description === null ? null : edit.description?.trim().slice(0, 500);
    await this.apply(user.userId, [
      {
        op: 'playlist_upsert',
        playlistId: library.id,
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(edit.isPublic !== undefined ? { isPublic: edit.isPublic } : {}),
        ...(edit.cover !== undefined ? { cover: edit.cover } : {}),
        at: this.now()
      }
    ]);
    return this.playlistAfter(user.userId, library.id);
  }

  public async deletePlaylist(user: UserData, playlistId: string): Promise<void> {
    const library = playlistOf(user, playlistId);
    await this.apply(user.userId, [{ op: 'playlist_delete', playlistId: library.id, at: this.now() }]);
  }

  public async addToPlaylist(user: UserData, playlistId: string, songId: string): Promise<LibraryRecord> {
    const library = playlistOf(user, playlistId);
    const ref = refOf(songId);
    const song = await this.lookUp(songId);
    const at = this.now();
    const alreadyInPlaylist = library.songIds.includes(songId);
    await this.apply(user.userId, [{ op: 'playlist_add', playlistId: library.id, ref, ...withSnapshot(song), at }]);
    if (song && !alreadyInPlaylist) {
      if (isPersonalised(user)) {
        const snapshot = snapshotOf(song);
        if (snapshot) await this.tallySafely(() => this.tally!.bonus(user.userId, snapshot, 'playlistAdd', at));
      }
      await this.learn(user, song, SIGNAL_WEIGHT.playlistAdd);
    }
    return this.playlistAfter(user.userId, library.id);
  }

  public async removeFromPlaylist(user: UserData, playlistId: string, songId: string): Promise<LibraryRecord> {
    const library = playlistOf(user, playlistId);
    await this.apply(user.userId, [{ op: 'playlist_remove', playlistId: library.id, ref: refOf(songId), at: this.now() }]);
    return this.playlistAfter(user.userId, library.id);
  }

  // ── Sharing ───────────────────────────────────────────────────────────────

  /** The playlist's share link (made public), created the first time. */
  public async share(user: UserData, playlistId: string): Promise<{ readonly code: string; readonly created: boolean }> {
    const library = playlistOf(user, playlistId);
    const existing = await this.users.findShare(user.userId, library.id);
    const code = existing?.code ?? randomCode(8);
    if (!existing) await this.users.saveShare({ code, ownerId: user.userId, libraryId: library.id, createdAt: new Date(this.now()).toISOString() });
    if (!library.isPublic) await this.apply(user.userId, [{ op: 'playlist_upsert', playlistId: library.id, isPublic: true, at: this.now() }]);
    return { code, created: !existing };
  }

  /** Turns the link off and makes the playlist private again. */
  public async unshare(user: UserData, playlistId: string): Promise<void> {
    const library = playlistOf(user, playlistId);
    const existing = await this.users.findShare(user.userId, library.id);
    if (existing) await this.users.deleteShare(existing.code);
    await this.apply(user.userId, [{ op: 'playlist_upsert', playlistId: library.id, isPublic: false, at: this.now() }]);
  }

  /** What a share link opens, or null when the code is unknown or the link was turned off. */
  public async openShare(code: string): Promise<SharedPlaylist | null> {
    if (!isShareCode(code)) return null;
    const share = await this.users.getShare(code);
    const owner = share ? await this.users.get(share.ownerId) : null;
    const library = owner?.libraries.find((item) => item.id === share?.libraryId);
    return owner && library?.isPublic ? { owner, library } : null;
  }

  /** A private copy of a shared playlist in the listener's own library, or null when the link is off. */
  public async saveSharedCopy(user: UserData, code: string): Promise<LibraryRecord | null> {
    const shared = await this.openShare(code);
    if (!shared) return null;
    const { library: source } = shared;
    // The copy shows the owner's cover but does not own the file (no coverKey), so replacing or
    // deleting it here can never delete the owner's image.
    const copy: LibraryRecord = {
      id: crypto.randomUUID(),
      name: source.name,
      ...(source.description ? { description: source.description } : {}),
      isPublic: false,
      songIds: [...source.songIds],
      createdAt: new Date(this.now()).toISOString(),
      ...(source.coverUrl ? { coverUrl: source.coverUrl } : {})
    };
    await this.apply(user.userId, opsForPlaylistCopy(copy, this.now(), await this.snapshots(copy.songIds)));
    return (await this.auth.getUser(user.userId))?.libraries.find((item) => item.id === copy.id) ?? copy;
  }

  // ── The phone's library sync ──────────────────────────────────────────────

  // Deliberately no tally bonus here: synchronized rows may be imported and do not identify native user actions.

  /**
   * A batch of operations from another device. Taste learns from them as from the website's buttons.
   *
   * `clock` is when the request arrived and, from a device that sends it, what the device's own
   * clock read when it left: the batch's times are restated on the server's clock first
   * (alignOpTimes), so a phone whose clock is wrong neither loses nor wins because of it. The
   * reply says which operations lost to something newer, so the device knows to pull.
   */
  public async applyFromDevice(user: UserData, ops: readonly LibraryOp[], clock?: DeviceClock): Promise<DeviceBatchResult> {
    const oldLikes = ops.some((op) => op.op === 'unlike') ? await this.auth.library.recentLikes(user.userId, 1000) : [];
    const result = await this.apply(user.userId, clock ? alignOpTimes(ops, clock.sentAt, clock.receivedAt) : ops);
    const applied = new Set(result.appliedIndexes);
    const lessons: { song: SongSnapshot; weight: number }[] = [];
    const tallyWrites: (() => Promise<unknown>)[] = [];
    ops.forEach((op, index) => {
      if (!applied.has(index)) return;
      if (op.op === 'unlike') {
        const previous = oldLikes.find((entry) => entry.ref === op.ref);
        if (!previous?.song || previous.origin === 'import') return;
        lessons.push({ song: previous.song, weight: SIGNAL_WEIGHT.unlike });
        if (isPersonalised(user)) tallyWrites.push(() => this.tally!.bonus(user.userId, previous.song!, 'unlike', op.at));
        return;
      }
      if (!('song' in op) || !op.song ||
        ((op.op === 'like' || op.op === 'playlist_add') && op.origin === 'import')) return;
      const alreadyLiked = user.likedSongIds.some((id) => refForId(id) === op.ref);
      if (op.op === 'like' && !alreadyLiked) {
        lessons.push({ song: op.song, weight: SIGNAL_WEIGHT.like });
        if (isPersonalised(user)) tallyWrites.push(() => this.tally!.bonus(user.userId, op.song!, 'like', op.at));
      }
      if (op.op === 'playlist_add') {
        const library = user.libraries.find((item) => item.id === op.playlistId);
        const alreadyAdded = library?.songIds.some((id) => refForId(id) === op.ref) ?? false;
        if (!alreadyAdded) {
          lessons.push({ song: op.song, weight: SIGNAL_WEIGHT.playlistAdd });
          if (isPersonalised(user)) tallyWrites.push(() => this.tally!.bonus(user.userId, op.song!, 'playlistAdd', op.at));
        }
      }
    });
    if (lessons.length > 0) {
      await this.auth.updateProfile(user.userId, (current) =>
        isPersonalised(current) ? lessons.reduce((taught, lesson) => teach(taught, lesson.song, lesson.weight), current) : null, user);
    }
    for (const write of tallyWrites) await this.tallySafely(write);
    return { rev: result.rev, rejected: result.rejected, superseded: result.superseded, applied: result.applied };
  }

  // ── Listening ─────────────────────────────────────────────────────────────

  /** A play, for Recently played. Pressing play is a mild vote; how long they stayed arrives as `listened`. */
  public async recordPlay(user: UserData, songId: string, playDuration: number, playedAt: string, songRef?: SongRef, snapshot?: SongSnapshot): Promise<RecentRecord> {
    const snapshotSong = snapshot ? unifiedSongFromSnapshot(snapshot) : null;
    const ref = snapshot?.ref ?? songRef;
    const entry: RecentRecord = {
      songId,
      playDuration,
      playedAt,
      ...(ref ? { songRef: ref } : {}),
      ...(snapshot ? { song: snapshot } : {})
    };
    // Personalisation off: the play is not kept and nothing is learned from it.
    if (!isPersonalised(user)) return entry;
    const song = snapshotSong ?? await this.lookUp(songId);
    const identity = recentIdentity(entry);
    await this.auth.updateProfile(user.userId, (current) => {
      if (!isPersonalised(current)) return null;
      // Offline clients retry the same play after a lost response. Keep the history write
      // idempotent for that event so its taste signal is not applied twice.
      const priorEvent = current.recentlyPlayed.find((item) => recentIdentity(item) === identity && item.playedAt === playedAt);
      const alreadyRecorded = priorEvent !== undefined;
      const savedEntry = priorEvent?.listenSignalApplied ? { ...entry, listenSignalApplied: true } : entry;
      const recentlyPlayed = [savedEntry, ...current.recentlyPlayed.filter((item) => recentIdentity(item) !== identity)]
        .sort((left, right) => right.playedAt.localeCompare(left.playedAt))
        .slice(0, RECENTLY_PLAYED_LIMIT);
      const taught = song && !alreadyRecorded
        ? teach(current, song, ref || playDuration <= 0 ? 0.3 : playWeight(playDuration, song.duration))
        : current;
      return { ...taught, recentlyPlayed };
    }, user);
    return entry;
  }

  /** Resolves the listener's cross-provider recent history, preferring the saved playback snapshot. */
  public async recentlyPlayed(user: UserData): Promise<UnifiedSong[]> {
    const records = [...user.recentlyPlayed].sort((left, right) => right.playedAt.localeCompare(left.playedAt)).slice(0, RECENTLY_PLAYED_LIMIT);
    const unresolved = records.filter((record) => !record.song).map((record) => record.songId);
    let hydrated: UnifiedSong[] = [];
    if (unresolved.length > 0) {
      try {
        hydrated = await this.catalog.getSongs([...new Set(unresolved)]);
      } catch {
        hydrated = [];
      }
    }
    const byIdentity = new Map(hydrated.map((song) => [catalogIdentity(song), song]));
    return records.flatMap((record) => {
      const fromSnapshot = record.song ? unifiedSongFromSnapshot(record.song) : null;
      const found = fromSnapshot ?? byIdentity.get(recordIdentity(record)) ?? hydrated.find((song) => song.id === record.songId);
      return found ? [found] : [];
    });
  }

  /** How long a song was actually heard: a few seconds counts against it, most of it for it. */
  public async listened(user: UserData, songId: string, seconds: number, snapshot?: SongSnapshot, songRef?: SongRef, playedAt?: string, playId?: string, ending?: ListenEnding): Promise<UserData> {
    if (!isPersonalised(user)) return user;
    const song = (snapshot ? unifiedSongFromSnapshot(snapshot) : null) ?? await this.lookUp(songId);
    if (!song) return user;
    const ref = snapshot?.ref ?? songRef;
    const weight = playWeight(seconds, song.duration, ending);
    let updated: UserData | null;
    if (!ref || !playedAt) {
      updated = await this.learn(user, song, weight);
    } else {
      updated = await this.auth.updateProfile(user.userId, (current) => {
        if (!isPersonalised(current)) return null;
        const index = current.recentlyPlayed.findIndex((item) => recentIdentity(item) === (ref.startsWith('gaana:') ? ref : parseSongRef(ref)?.id ?? ref) && item.playedAt === playedAt);
        const prior = index >= 0 ? current.recentlyPlayed[index] : undefined;
        if (prior?.listenSignalApplied) return null;
        const taught = teach(current, song, weight);
        if (index < 0 || !prior) return taught;
        const recentlyPlayed = [...current.recentlyPlayed];
        recentlyPlayed[index] = { ...prior, listenSignalApplied: true };
        return { ...taught, recentlyPlayed };
      }, user);
    }
    // Retry the idempotent tally even when the older taste update was already marked applied.
    if (ref && playedAt && isPersonalised(user)) {
      const tallySong = snapshot ?? snapshotOf(song);
      const at = Date.parse(playedAt);
      if (tallySong && Number.isFinite(at)) {
        await this.tallySafely(() => this.tally!.record(user.userId, tallySong, seconds, at, playId));
      }
    }
    return updated ?? user;
  }

  public async skipped(user: UserData, songId: string): Promise<void> {
    const song = await this.lookUp(songId);
    if (song) await this.learn(user, song, SIGNAL_WEIGHT.skip);
  }

  // ── Inside ────────────────────────────────────────────────────────────────

  /** Applies library operations, then deletes playlist covers nothing uses any more. */
  private async apply(userId: string, ops: readonly LibraryOp[]) {
    const result = await this.auth.library.apply(userId, ops);
    for (const key of result.removedCoverKeys) {
      try {
        await this.covers?.remove(key);
      } catch {
        // A leftover image costs storage, not correctness; the playlist change already landed.
      }
    }
    return result;
  }

  /** A playlist as the profile shows it right after a change. */
  private async playlistAfter(userId: string, playlistId: string): Promise<LibraryRecord> {
    const library = (await this.auth.getUser(userId))?.libraries.find((item) => item.id === playlistId);
    if (!library) throw new NotFoundError();
    return library;
  }

  /** The catalog row for an id, or null when the provider is down (the action still goes ahead). */
  private async lookUp(songId: string): Promise<UnifiedSong | null> {
    try {
      const [song] = await this.catalog.getSongs([songId]);
      return song ?? null;
    } catch {
      return null;
    }
  }

  /** Details for many songs at once, for the ones the catalog can find. */
  private async snapshots(songIds: readonly string[]): Promise<Map<string, SongSnapshot>> {
    const found = new Map<string, SongSnapshot>();
    if (songIds.length === 0) return found;
    try {
      for (const song of await this.catalog.getSongs([...songIds])) {
        const snapshot = snapshotOf(song);
        if (snapshot) found.set(song.id, snapshot);
      }
    } catch {
      // Provider down: the copy still lands; other devices look the songs up themselves.
    }
    return found;
  }

  /** `user` is the profile this request already read: the change starts from it instead of reading again. */
  private learn(user: UserData, song: TasteSong, weight: number): Promise<UserData | null> {
    return this.auth.updateProfile(user.userId, (current) => (isPersonalised(current) ? teach(current, song, weight) : null), user);
  }

  /** The tally is derived data: a failed write must not fail the user's underlying action. */
  private async tallySafely(write: () => Promise<unknown>): Promise<void> {
    if (!this.tally) return;
    try {
      await write();
    } catch {
      // The next idempotent listen signal can retry without exposing provider or storage details.
    }
  }
}

type TasteSong = { readonly artist: string; readonly language?: string };

function recentIdentity(record: RecentRecord): string {
  const parsed = record.songRef ? parseSongRef(record.songRef) : null;
  return parsed?.source === 'gaana' ? `gaana:${parsed.id}` : parsed?.id ?? record.songId;
}

function recordIdentity(record: RecentRecord): string {
  const parsed = record.songRef ? parseSongRef(record.songRef) : null;
  return parsed ? `${parsed.source}:${parsed.id}` : record.songId;
}

function catalogIdentity(song: UnifiedSong): string {
  return song.source === 'Gaana' ? `gaana:${song.id}` : song.id;
}

function teach(user: UserData, song: TasteSong, weight: number): UserData {
  return { ...user, taste: applySignal(user.taste, { artist: song.artist, ...(song.language ? { language: song.language } : {}) }, weight) };
}

function playlistOf(user: UserData, playlistId: string): LibraryRecord {
  const library = user.libraries.find((item) => item.id === playlistId);
  if (!library) throw new NotFoundError();
  return library;
}

function refOf(songId: string): SongRef {
  const ref = refForId(songId);
  if (!ref) throw new NotFoundError();
  return ref;
}

function withSnapshot(song: UnifiedSong | null): { song: SongSnapshot } | Record<string, never> {
  const snapshot = song ? snapshotOf(song) : undefined;
  return snapshot ? { song: snapshot } : {};
}
