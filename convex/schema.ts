import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const library = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  isPublic: v.boolean(),
  songIds: v.array(v.string()),
  createdAt: v.string(),
  /** Convex storage id of a custom playlist cover (owned by this playlist). */
  coverKey: v.optional(v.string()),
  /** Served URL for the cover. Kept alongside the id: Convex URLs cannot be derived from it. */
  coverUrl: v.optional(v.string())
});

const recent = v.object({
  songId: v.string(),
  playDuration: v.number(),
    playedAt: v.string(),
    songRef: v.optional(v.string()),
    listenSignalApplied: v.optional(v.boolean()),
  song: v.optional(v.object({
    ref: v.string(),
    title: v.string(),
    artist: v.string(),
    album: v.optional(v.string()),
    artwork: v.string(),
    duration: v.number()
  }))
});

const tasteEntry = v.object({ name: v.string(), score: v.number() });

/** What we have learned about a listener. Arrays, not records: Convex field names must be ASCII, artist names are not. */
const taste = v.object({
  artists: v.array(tasteEntry),
  languages: v.array(tasteEntry),
  signals: v.number(),
  onboarded: v.boolean(),
  updatedAt: v.string()
});

/** How much one song has been listened to (apps/api/src/user/plays.ts). Capped at 200 per listener. */
export const playStat = v.object({
  songId: v.string(),
  plays: v.number(),
  seconds: v.number(),
  recent: v.number(),
  lastPlayedAt: v.string()
});

/** packages/shared/songRef.ts SongSnapshot: enough to show a song on another device. Duration in seconds. */
export const songSnapshot = v.object({
  ref: v.string(),
  title: v.string(),
  artist: v.string(),
  album: v.optional(v.string()),
  artwork: v.string(),
  duration: v.number()
});

export const repeatMode = v.union(v.literal('off'), v.literal('all'), v.literal('one'));
export const connectCommandKind = v.union(
  v.literal('play'),
  v.literal('pause'),
  v.literal('seek'),
  v.literal('next'),
  v.literal('prev'),
  v.literal('volume'),
  v.literal('shuffle'),
  v.literal('repeat'),
  v.literal('play_song'),
  v.literal('queue_add'),
  v.literal('take_over')
);

/** A snapshot sent as the complete payload of a Connect command. */
export const playerStateSnapshot = v.object({
  song: v.optional(songSnapshot),
  queue: v.array(songSnapshot),
  isPlaying: v.boolean(),
  positionSec: v.number(),
  positionAt: v.number(),
  volume: v.number(),
  shuffle: v.boolean(),
  repeat: repeatMode,
  rev: v.number()
});

/** Client-owned playback fields accepted when a device claims the player. */
export const playerSnapshot = v.object({
  song: v.optional(songSnapshot),
  queue: v.array(songSnapshot),
  isPlaying: v.boolean(),
  positionSec: v.number(),
  volume: v.number(),
  shuffle: v.boolean(),
  repeat: repeatMode
});

/** Arguments are validated individually, then checked against the command kind in connect.ts. */
export const connectCommandArgs = v.union(
  v.object({ sec: v.number() }),
  v.object({ v: v.number() }),
  v.object({ on: v.boolean() }),
  v.object({ mode: repeatMode }),
  v.object({ song: songSnapshot, queue: v.optional(v.array(songSnapshot)) }),
  v.object({ song: songSnapshot }),
  v.object({ state: playerStateSnapshot })
);

/** A catalog row as stored inside a song relation: enough to rank and show it without a lookup. */
export const relatedSong = v.object({
  id: v.string(),
  title: v.string(),
  artist: v.string(),
  album: v.optional(v.string()),
  artwork: v.string(),
  duration: v.number(),
  hasLyrics: v.boolean(),
  language: v.optional(v.string()),
  playCount: v.number(),
  source: v.union(v.literal('Saavn'), v.literal('Gaana'))
});

export default defineSchema({
  // Convex Auth owns `users`, `authAccounts`, `authSessions` and friends. It is the
  // identity record (who signed in with Google); `profiles` below is what they listen to.
  ...authTables,

  /**
   * One row per listener, keyed by `userId`.
   *
   * For a signed-in listener that is their Convex Auth user id, so the identity and
   * the library stay joined without duplicating either. For a guest it is a random
   * id held only by that browser.
   */
  profiles: defineTable({
    userId: v.string(),
    isGuest: v.boolean(),
    createdAt: v.string(),
    libraries: v.array(library),
    likedSongIds: v.array(v.string()),
    recentlyPlayed: v.array(recent),
    settings: v.any(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    taste: v.optional(taste),
    playStats: v.optional(v.array(playStat)),
    /** Moves on with every profile write; profiles.update compares it so concurrent writes cannot undo each other. */
    version: v.optional(v.number())
  })
    .index('by_userId', ['userId'])
    .index('by_email', ['email']),

  /**
   * "Listeners of this song go on to play…" — YouTube Music's song radio and the catalog's own
   * suggestions, merged and matched to catalog rows. Not per listener: a song's neighbours are
   * the same for everyone, so each is worked out once and shared (Echo's related_song_map).
   * Derived data: losing a row only costs a recompute.
   */
  songRelations: defineTable({
    songId: v.string(),
    songs: v.array(relatedSong),
    updatedAt: v.string()
  }).index('by_songId', ['songId']),

  /** A playlist someone chose to share. Live: it points at the owner's playlist, so edits show up for everyone with the link. */
  shares: defineTable({
    code: v.string(),
    ownerId: v.string(),
    libraryId: v.string(),
    createdAt: v.string()
  })
    .index('by_code', ['code'])
    .index('by_owner_library', ['ownerId', 'libraryId']),

  // ── Library sync (convex/library.ts, rules in packages/shared/library.ts) ──────────────
  // A listener's likes and playlists as rows, so the website and the phone can each change
  // one item without overwriting the other. The profile's likedSongIds/libraries stay as a
  // copy rebuilt in the same transaction, for everything that already reads them.

  libraryLikes: defineTable({
    userId: v.string(),
    ref: v.string(),
    song: v.optional(songSnapshot),
    liked: v.boolean(),
    likedAt: v.number(),
    updatedAt: v.number(),
    rev: v.number()
  })
    .index('by_userId_and_ref', ['userId', 'ref'])
    .index('by_userId_and_rev', ['userId', 'rev'])
    // The profile copy reads current likes only, newest first, so unlikes never use up its budget.
    .index('by_userId_and_liked_and_likedAt', ['userId', 'liked', 'likedAt']),

  libraryPlaylists: defineTable({
    userId: v.string(),
    playlistId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    isPublic: v.boolean(),
    coverKey: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    createdAt: v.number(),
    deleted: v.boolean(),
    updatedAt: v.number(),
    rev: v.number()
  })
    .index('by_userId_and_playlistId', ['userId', 'playlistId'])
    .index('by_userId_and_rev', ['userId', 'rev'])
    .index('by_userId_and_deleted_and_createdAt', ['userId', 'deleted', 'createdAt']),

  libraryItems: defineTable({
    userId: v.string(),
    playlistId: v.string(),
    ref: v.string(),
    song: v.optional(songSnapshot),
    addedAt: v.number(),
    deleted: v.boolean(),
    updatedAt: v.number(),
    rev: v.number()
  })
    .index('by_userId_and_playlistId_and_ref', ['userId', 'playlistId', 'ref'])
    .index('by_userId_and_rev', ['userId', 'rev'])
    .index('by_userId_and_deleted_and_addedAt', ['userId', 'deleted', 'addedAt']),

  /** One per listener once their library moved to rows: the newest revision. Its presence means "rows are the truth". */
  libraryState: defineTable({
    userId: v.string(),
    rev: v.number()
  }).index('by_userId', ['userId']),

  // ── Connect: cross-device player ownership and command queue ───────────────
  // Online status and heartbeat expiry live in @convex-dev/presence. The
  // retention marker below is only advanced by registration and stale-device
  // cleanup; it is not used as an online-status source.
  devices: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    name: v.string(),
    kind: v.union(v.literal('web'), v.literal('android'), v.literal('ios')),
    appVersion: v.string(),
    canPlay: v.boolean(),
    createdAt: v.number(),
    retentionCheckedAt: v.number()
  })
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_deviceId', ['deviceId'])
    .index('by_retentionCheckedAt', ['retentionCheckedAt']),

  playerState: defineTable({
    userId: v.string(),
    activeDeviceId: v.optional(v.string()),
    song: v.optional(songSnapshot),
    queue: v.array(songSnapshot),
    isPlaying: v.boolean(),
    positionSec: v.number(),
    positionAt: v.number(),
    volume: v.number(),
    shuffle: v.boolean(),
    repeat: repeatMode,
    rev: v.number()
  }).index('by_userId', ['userId']),

  connectCommands: defineTable({
    userId: v.string(),
    targetDeviceId: v.string(),
    /** The registered device that originated the command. */
    sourceDeviceId: v.string(),
    /** The authenticated account that requested the command. */
    issuedBy: v.string(),
    kind: connectCommandKind,
    args: v.optional(connectCommandArgs),
    createdAt: v.number(),
    status: v.union(v.literal('pending'), v.literal('done'), v.literal('failed')),
    error: v.optional(v.string())
  })
    .index('by_targetDeviceId_and_status', ['targetDeviceId', 'status'])
    .index('by_sourceDeviceId_and_createdAt', ['sourceDeviceId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  /** Spent OAuth codes and refresh tokens (MCP connect), kept only until they expire. */
  oauthGrants: defineTable({
    jti: v.string(),
    expiresAt: v.number()
  })
    .index('by_jti', ['jti'])
    .index('by_expiresAt', ['expiresAt'])
});
