import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';

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

/** packages/shared/legal.ts Consent. */
export const consent = v.object({ policyVersion: v.string(), at: v.string() });

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

/**
 * The one rule for a song snapshot crossing the device boundary, used by Connect and by library
 * sync. An empty artist is allowed (the phone produces it for untagged files); ref and title are
 * required. `reject` throws the caller's own error.
 */
export function assertSongSnapshot(song: Infer<typeof songSnapshot>, reject: () => never): void {
  if (
    song.ref.trim().length < 1 || song.ref.length > 512 ||
    song.title.trim().length < 1 || song.title.length > 300 ||
    song.artist.length > 300 ||
    (song.album !== undefined && song.album.length > 300) ||
    song.artwork.length > 2048 ||
    !Number.isFinite(song.duration) || song.duration < 0
  ) {
    reject();
  }
}

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
  v.literal('queue_remove'),
  v.literal('queue_move'),
  v.literal('queue_clear'),
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
  rev: v.number(),
  /**
   * The ownership epoch the transfer was queued under. The receiver does not need it (the
   * command's `expectedOwnershipEpoch` is the fence), but Android builds from a8577af refuse a
   * `take_over` whose state lacks it, so the server always sends it. Missing on older rows.
   */
  ownershipEpoch: v.optional(v.number())
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
  v.object({ song: songSnapshot, queue: v.optional(v.array(songSnapshot)), positionSec: v.optional(v.number()) }),
  v.object({ song: songSnapshot, more: v.optional(v.array(songSnapshot)), next: v.optional(v.boolean()) }),
  v.object({ index: v.number(), ref: v.string() }),
  v.object({ from: v.number(), to: v.number(), ref: v.string() }),
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

/** One track of a day's Blend (packages/shared/blendTypes.ts BlendTrack). */
export const blendTrack = v.object({
  song: songSnapshot,
  for: v.array(v.string()),
  kind: v.union(v.literal('shared'), v.literal('pick'), v.literal('discovery'))
});

/** A pair's taste match (packages/shared/blendTypes.ts PairMatch). */
export const pairMatch = v.object({
  a: v.string(),
  b: v.string(),
  match: v.number(),
  cover: v.object({ a: v.number(), b: v.number() }),
  rare: v.number(),
  confidence: v.union(v.literal('normal'), v.literal('low')),
  together: v.string(),
  contributions: v.array(v.object({ artist: v.string(), value: v.number() }))
});

/** The story songs of a build, kept so cards can be shown without rebuilding. */
export const blendStorySong = v.object({
  identity: v.string(),
  variant: v.union(v.literal('together'), v.literal('closest')),
  song: songSnapshot
});
export const blendGift = v.object({
  fromUserId: v.string(),
  toUserId: v.string(),
  identity: v.string(),
  song: songSnapshot
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
    /** When the listener agreed to the policies, and which version (packages/shared/legal.ts). */
    consent: v.optional(consent),
    /**
     * Server time of the last profile or library write. The retention sweep (convex/account.ts)
     * reads it; a row written before it existed has none and is never swept until it is set.
     */
    lastActiveAt: v.optional(v.number()),
    /** Moves on with every profile write; profiles.update compares it so concurrent writes cannot undo each other. */
    version: v.optional(v.number())
  })
    .index('by_userId', ['userId'])
    .index('by_email', ['email'])
    .index('by_isGuest_and_lastActiveAt', ['isGuest', 'lastActiveAt']),

  /**
   * Derived listening data for a listener, erased with the account. At most 200 rows per user;
   * scores are forward-decayed and the list sheds the lowest score when it reaches the cap.
   */
  tasteSongs: defineTable({
    userId: v.string(),
    identity: v.string(),
    ref: v.string(),
    title: v.string(),
    artist: v.string(),
    artwork: v.string(),
    duration: v.number(),
    score: v.number(),
    likeBonus: v.boolean(),
    /** Timestamp of the +10 contribution so unlike removes that exact decayed amount. */
    likeBonusAt: v.optional(v.number()),
    /** Like bonuses first introduced by the one-time seed and reversible by a later unlike. */
    seedLikeBonusAt: v.optional(v.number()),
    /** Playlist memberships currently represented by the aggregate playlist bonus. */
    playlistMemberships: v.optional(v.number()),
    /** Stable, bounded play checkpoints. At most 16 recent play IDs per song identity. */
    recentPlayEvents: v.optional(v.array(v.object({ playId: v.string(), maxSeconds: v.number(), playedAt: v.number() }))),
    recentListens: v.array(v.number()),
    updatedAt: v.number()
  })
    .index('by_userId_and_identity', ['userId', 'identity'])
    .index('by_userId_and_score', ['userId', 'score']),

  /**
   * A Blend: a playlist shared by 2 (later up to 6) listeners, rebuilt at most once a UTC day when
   * a member opens it (PLAN.md D7). The build lives in the document: ≤ 50 tracks, ≤ 15 pairs.
   */
  blends: defineTable({
    name: v.string(),
    ownerId: v.string(),
    memberCount: v.number(),
    createdAt: v.number(),
    builtFor: v.optional(v.string()),
    /** Compare-and-set guard: a build saves only over the version it read. */
    buildVersion: v.number(),
    /** Changes to membership/privacy inputs invalidate in-flight builders independently of builds. */
    inputVersion: v.optional(v.number()),
    /** Durable lease suppresses duplicate daily build work; publication still checks inputVersion. */
    buildLease: v.optional(v.object({ token: v.string(), inputVersion: v.number(), builtFor: v.string(), expiresAt: v.number() })),
    /** Current invite is directly addressable even when bounded history is full. */
    activeInviteId: v.optional(v.id('blendInvites')),
    /** Membership or a member's learning setting changed since the last build. */
    stale: v.boolean(),
    tracks: v.array(blendTrack),
    pairs: v.array(pairMatch),
    previousPairs: v.array(pairMatch),
    /** Identities in the last two builds, ≤ 100, for the freshness rule. */
    previousTracks: v.array(v.string()),
    /** Story inputs computed with the build (pairs only). */
    together: v.optional(blendStorySong),
    gifts: v.optional(v.array(blendGift)),
    glue: v.optional(v.array(v.string())),
    palette: v.optional(v.object({ a: v.string(), b: v.string() })),
    /** When the Blend last became (or was re-invited while) one member; the sweep clock. */
    waitingSince: v.optional(v.number())
  }).index('by_memberCount_and_waitingSince', ['memberCount', 'waitingSince']),

  /** A listener in a Blend. Display name is a snapshot (≤ 40 chars); no photo or email (D11). */
  blendMembers: defineTable({
    blendId: v.id('blends'),
    userId: v.string(),
    displayName: v.string(),
    joinedAt: v.number(),
    consent: v.object({ policyVersion: v.string(), at: v.number() }),
    /** False: this member's part uses likes and playlists only (D12). */
    learning: v.boolean()
  })
    .index('by_blendId_and_joinedAt', ['blendId', 'joinedAt'])
    .index('by_userId_and_joinedAt', ['userId', 'joinedAt'])
    .index('by_blendId_and_userId', ['blendId', 'userId']),

  /** The join link for a Blend: 12 characters, 7 days. A regenerated link expires the old one. */
  blendInvites: defineTable({
    code: v.string(),
    blendId: v.id('blends'),
    createdBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.number()
  })
    .index('by_code', ['code'])
    .index('by_blendId', ['blendId'])
    .index('by_blendId_and_createdAt', ['blendId', 'createdAt'])
    .index('by_createdBy', ['createdBy'])
    .index('by_expiresAt', ['expiresAt']),

  /** Bounded replay key for create POSTs whose response may be lost after commit. */
  blendOperations: defineTable({
    userId: v.string(),
    operationId: v.string(),
    fingerprint: v.string(),
    blendId: v.id('blends'),
    code: v.string(),
    expiresAt: v.number()
  })
    .index('by_userId_and_operationId', ['userId', 'operationId'])
    .index('by_expiresAt', ['expiresAt']),

  /** Companion row for derived tasteSongs metadata; erased after the last song row. */
  tasteMeta: defineTable({
    userId: v.string(),
    songCount: v.number(),
    seededAt: v.optional(v.number()),
    updatedAt: v.number()
  }).index('by_userId', ['userId']),

  /**
   * A complaint about a shared playlist (its name, description, cover or songs), for the grievance
   * officer to read. Filed by anyone with the link; `contact` is only what the reporter chose to give.
   */
  reports: defineTable({
    code: v.string(),
    ownerId: v.string(),
    libraryId: v.string(),
    reason: v.union(v.literal('copyright'), v.literal('illegal'), v.literal('abuse'), v.literal('other')),
    details: v.optional(v.string()),
    contact: v.optional(v.string()),
    createdAt: v.number(),
    status: v.union(v.literal('open'), v.literal('closed')),
    closedAt: v.optional(v.number())
  })
    .index('by_code', ['code'])
    .index('by_status_and_createdAt', ['status', 'createdAt'])
    .index('by_status_and_closedAt', ['status', 'closedAt']),

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
    /** Set by Import; a like made in the app clears it. Absent means native. */
    origin: v.optional(v.literal('import')),
    updatedAt: v.number(),
    rev: v.number()
  })
    .index('by_userId_and_ref', ['userId', 'ref'])
    .index('by_userId_and_rev', ['userId', 'rev'])
    .index('by_liked_and_updatedAt', ['liked', 'updatedAt'])
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
    /** Set when Import created the playlist. Absent means native. */
    origin: v.optional(v.literal('import')),
    updatedAt: v.number(),
    rev: v.number()
  })
    .index('by_userId_and_playlistId', ['userId', 'playlistId'])
    .index('by_userId_and_rev', ['userId', 'rev'])
    .index('by_deleted_and_updatedAt', ['deleted', 'updatedAt'])
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
    .index('by_deleted_and_updatedAt', ['deleted', 'updatedAt'])
    .index('by_userId_and_deleted_and_addedAt', ['userId', 'deleted', 'addedAt']),

  /** One per listener once their library moved to rows: the newest revision. Its presence means "rows are the truth". */
  libraryState: defineTable({
    userId: v.string(),
    rev: v.number(),
    /** Highest removed tombstone revision, so an older device cursor knows to resync. */
    prunedRev: v.optional(v.number()),
    /**
     * How many current rows the listener has (liked / not deleted), true as of revision
     * `counts.rev`. While `counts.rev` equals `rev` the profile copy is complete, so a change can
     * be applied to it from the rows it touched. Missing or behind (written by older code, or a
     * library past the copy's limits): the next change rebuilds the copy in full.
     */
    counts: v.optional(v.object({
      likes: v.number(),
      playlists: v.number(),
      items: v.number(),
      rev: v.number()
    }))
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
    /** The Connect protocol the registered client speaks. Missing means legacy (1). */
    protocolVersion: v.optional(v.number()),
    createdAt: v.number(),
    retentionCheckedAt: v.number()
  })
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_deviceId', ['deviceId'])
    .index('by_retentionCheckedAt', ['retentionCheckedAt']),

  /**
   * Who plays for this account, one row per account. Kept apart from `playerState` so the device
   * list does not depend on a document that changes with every position report. `epoch` moves on
   * each time the active device changes; commands and reports are bound to the epoch they saw.
   * `handoff` is a transfer whose destination is loaded and waiting for the owner to pause.
   */
  connectOwnership: defineTable({
    userId: v.string(),
    activeDeviceId: v.optional(v.string()),
    epoch: v.number(),
    handoff: v.optional(v.object({
      commandId: v.id('connectCommands'),
      toDeviceId: v.string(),
      executeBefore: v.number()
    }))
  }).index('by_userId', ['userId']),

  playerState: defineTable({
    userId: v.string(),
    /** Kept equal to connectOwnership.activeDeviceId on every claim, for code that predates that table. */
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
    error: v.optional(v.string()),
    // ── V2 (sendV2 / transferV2). All missing on a legacy command. ──
    /** The sender's id for this action; a retry with the same id returns the same command. */
    requestId: v.optional(v.string()),
    /** Server time after which the command must not run. */
    executeBefore: v.optional(v.number()),
    /** The ownership epoch the sender saw. A command from an older epoch never runs. */
    expectedOwnershipEpoch: v.optional(v.number()),
    /** Given to the target by beginV2; prepareV2 and completeV2 must present it. */
    reservationToken: v.optional(v.string()),
    beganAt: v.optional(v.number()),
    /** Why a failed command failed: a stable code, where `error` is display text. */
    errorCode: v.optional(v.string()),
    /** take_over only: ownership has moved to the target; where to start and whether to play. */
    release: v.optional(v.object({ positionSec: v.number(), resume: v.boolean() }))
  })
    .index('by_targetDeviceId_and_status', ['targetDeviceId', 'status'])
    .index('by_sourceDeviceId_and_createdAt', ['sourceDeviceId', 'createdAt'])
    .index('by_createdAt', ['createdAt'])
    // sendV2 / transferV2 dedupe.
    .index('by_userId_and_sourceDeviceId_and_requestId', ['userId', 'sourceDeviceId', 'requestId'])
    // A claim fails this account's pending commands from the epoch it ends.
    .index('by_userId_and_status', ['userId', 'status'])
    // The sweep: pending V2 commands past their deadline, and legacy rows (no executeBefore) by age.
    .index('by_status_and_executeBefore_and_createdAt', ['status', 'executeBefore', 'createdAt']),

  /** Spent OAuth codes and refresh tokens (MCP connect), kept only until they expire. */
  oauthGrants: defineTable({
    jti: v.string(),
    expiresAt: v.number()
  })
    .index('by_jti', ['jti'])
    .index('by_expiresAt', ['expiresAt']),

  /** PKCE state is single-use and short-lived; only encrypted verifier material is stored. */
  spotifyOAuthStates: defineTable({
    stateHash: v.string(), userId: v.string(), encryptedVerifier: v.string(), returnTo: v.union(v.literal('web'), v.literal('mobile')),
    expiresAt: v.number()
  }).index('by_stateHash', ['stateHash']).index('by_expiresAt', ['expiresAt']).index('by_userId', ['userId']),
  /** One encrypted credential record per account; no token is returned by any query. */
  spotifyConnections: defineTable({
    userId: v.string(), spotifyUserId: v.string(), encryptedRefreshToken: v.string(), encryptedAccessToken: v.optional(v.string()),
    accessExpiresAt: v.optional(v.number()), dailyEnabled: v.boolean(), connectedAt: v.number(), updatedAt: v.number()
  }).index('by_userId', ['userId']).index('by_dailyEnabled_and_updatedAt', ['dailyEnabled', 'updatedAt']),
  /** Bounded source playlist list and resumable full-scan cursor. */
  spotifyPlaylists: defineTable({
    userId: v.string(), playlistId: v.string(), name: v.string(), snapshotId: v.string(), total: v.number(),
    libraryId: v.string(), offset: v.number(), scanSnapshotId: v.string(), scanTotal: v.number(), added: v.number(), skipped: v.number(),
    reviewNeeded: v.number(), lastSyncedAt: v.optional(v.number()), leaseUntil: v.optional(v.number()), leaseToken: v.optional(v.string()),
    enabled: v.boolean(), updatedAt: v.number()
  }).index('by_userId_and_playlistId', ['userId', 'playlistId']).index('by_userId_and_updatedAt', ['userId', 'updatedAt'])
    .index('by_enabled_and_updatedAt', ['enabled', 'updatedAt']),
  /** One stable receipt per source song; incomplete/uncertain matches never get a receipt. */
  spotifyReceipts: defineTable({
    userId: v.string(), playlistId: v.string(), spotifyTrackId: v.string(), libraryId: v.string(), savedAt: v.number()
  }).index('by_userId_and_playlistId_and_spotifyTrackId', ['userId', 'playlistId', 'spotifyTrackId'])
    .index('by_userId_and_playlistId', ['userId', 'playlistId']),

  // LuvLink v1 uses independent bounded documents: membership changes do not invalidate queue
  // or playback subscribers, and ephemeral presence never lives in these tables.
  luvLinkRooms: defineTable({
    hostUserId: v.string(),
    leaderUserId: v.string(),
    leaderEpoch: v.number(),
    mode: v.union(v.literal('listen'), v.literal('speaker')),
    status: v.union(v.literal('active'), v.literal('closed')),
    protocolVersion: v.number(),
    revision: v.number(),
    queueRevision: v.number(),
    suggestionRevision: v.number(),
    memberCount: v.number(),
    createdAtMs: v.number(),
    expiresAtMs: v.number(),
    closedAtMs: v.optional(v.number()),
    handoffFromUserId: v.optional(v.string())
  }).index('by_expiresAtMs', ['expiresAtMs']).index('by_hostUserId_and_status', ['hostUserId', 'status']),

  luvLinkMembers: defineTable({
    roomId: v.id('luvLinkRooms'),
    userId: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('host'), v.literal('member')),
    mode: v.union(v.literal('listen'), v.literal('speaker')),
    canControl: v.boolean(),
    canSuggest: v.boolean(),
    joinedAtMs: v.number()
  }).index('by_roomId_and_userId', ['roomId', 'userId']).index('by_roomId_and_joinedAtMs', ['roomId', 'joinedAtMs']).index('by_userId_and_joinedAtMs', ['userId', 'joinedAtMs']),

  luvLinkInvites: defineTable({
    roomId: v.id('luvLinkRooms'),
    codeHash: v.string(),
    generation: v.number(),
    createdAtMs: v.number(),
    expiresAtMs: v.number(),
    revokedAtMs: v.optional(v.number())
  }).index('by_codeHash', ['codeHash']).index('by_roomId_and_generation', ['roomId', 'generation']).index('by_expiresAtMs', ['expiresAtMs']),

  luvLinkPlayback: defineTable({
    roomId: v.id('luvLinkRooms'),
    leaderUserId: v.string(),
    leaderEpoch: v.number(),
    sequence: v.number(),
    trackEpoch: v.number(),
    queueEntryId: v.union(v.string(), v.null()),
    intent: v.union(v.literal('control'), v.literal('natural_end'), v.literal('checkpoint')),
    intentByUserId: v.string(),
    outputAppliedSequence: v.number(),
    barrierPending: v.boolean(),
    song: v.union(songSnapshot, v.null()),
    positionSec: v.number(),
    serverAtMs: v.number(),
    playing: v.boolean(),
    effectiveAtMs: v.number(),
    playbackRate: v.number()
  }).index('by_roomId', ['roomId']),

  luvLinkQueue: defineTable({
    roomId: v.id('luvLinkRooms'),
    entryId: v.string(),
    order: v.number(),
    song: songSnapshot,
    addedByUserId: v.string(),
    addedByName: v.string(),
    createdAtMs: v.number()
  }).index('by_roomId_and_order', ['roomId', 'order']).index('by_roomId_and_entryId', ['roomId', 'entryId']).index('by_addedByUserId', ['addedByUserId']),

  luvLinkRecommendations: defineTable({
    roomId: v.id('luvLinkRooms'),
    revision: v.number(),
    picks: v.array(v.object({ song: songSnapshot, forUserIds: v.array(v.string()), kind: v.union(v.literal('shared'), v.literal('pick')) })),
    builtAtMs: v.number()
  }).index('by_roomId', ['roomId']),

  luvLinkReceipts: defineTable({
    roomId: v.id('luvLinkRooms'),
    commandId: v.string(),
    userId: v.string(),
    kind: v.string(),
    result: v.object({ revision: v.number(), entryId: v.optional(v.string()) }),
    createdAtMs: v.number()
  }).index('by_roomId_and_commandId', ['roomId', 'commandId']).index('by_roomId_and_createdAtMs', ['roomId', 'createdAtMs']).index('by_userId', ['userId']),

  luvLinkReady: defineTable({
    roomId: v.id('luvLinkRooms'),
    trackEpoch: v.number(),
    userId: v.string(),
    ready: v.boolean(),
    updatedAtMs: v.number()
  }).index('by_roomId_and_trackEpoch_and_userId', ['roomId', 'trackEpoch', 'userId']).index('by_roomId_and_trackEpoch', ['roomId', 'trackEpoch']).index('by_userId', ['userId']),

  luvLinkBarriers: defineTable({
    roomId: v.id('luvLinkRooms'),
    trackEpoch: v.number(),
    leaderEpoch: v.number(),
    sequence: v.number(),
    song: songSnapshot,
    queueEntryId: v.union(v.string(), v.null()),
    intent: v.union(v.literal('control'), v.literal('natural_end')),
    intentByUserId: v.string(),
    positionSec: v.number(),
    playbackRate: v.number(),
    deadlineAtMs: v.number(),
    status: v.union(v.literal('pending'), v.literal('completed'), v.literal('cancelled'))
  }).index('by_roomId', ['roomId']).index('by_deadlineAtMs_and_status', ['deadlineAtMs', 'status'])
});
