# Remote control (Connect): fix plan and Spotify Connect parity

Written 2026-10-04 against `feat/native-queue-engine` at `10f1e0c` (`main` is fully contained in it).

**Status (2026-10-04, evening):** Phases 0, 1 and 2 are implemented, which fixes B1, B2 and B3, and
so is Phase 3.4 (autoplay on the device that plays). The decisions taken were the recommended ones:
D1 (a), D2 (a), D3 (a), D5 (a), D6 later. Checked with unit tests and typechecks only: there has been
no signed-in two-device run and no phone was attached, so section 8.2 is still open. Not built yet:
3.1/3.2 (lock-screen controls and volume keys for the other device, native Android), 3.3 ("Playing
from", protocol 4), 3.5 (per-action restrictions in the UI; the server already refuses commands to
a device that cannot play), 3.6, 3.7 (drag to reorder), 2.9 (optional server-side cover
normalisation) and Phase 4. What landed differs from the plan in two places: the "Sending to …"
state shows the picked song's title in the remote mini player, and a wait for Connect that ran out
is not repeated for 30 seconds, so a dead connection costs one short pause rather than one per tap.

This supplements [PLAN.md](./PLAN.md) (the original Connect design), [IMPROVEMENT-PLAN.md](./IMPROVEMENT-PLAN.md)
(reliability slices P0–P9) and [HANDOFF.md](./HANDOFF.md) (what shipped and what was verified). It does not
replace them. The wire contract stays [`docs/connect-contract.md`](../../docs/connect-contract.md). Any change
to it follows the order in [`docs/architecture.md`](../../docs/architecture.md): propose, update the doc,
announce, then adapt Convex, both clients and `MemoryTransport` together.

## Contents

1. [What was reported](#1-what-was-reported)
2. [Root causes, with the code that causes them](#2-root-causes-with-the-code-that-causes-them)
3. [How Spotify Connect works](#3-how-spotify-connect-works)
4. [Spotify Connect against Allegra today](#4-spotify-connect-against-allegra-today)
5. [Target behaviour](#5-target-behaviour)
6. [Implementation plan](#6-implementation-plan)
7. [Contract, compatibility and rollout](#7-contract-compatibility-and-rollout)
8. [Verification](#8-verification)
9. [Risks](#9-risks)
10. [Decisions needed before building](#10-decisions-needed-before-building)
11. [Files this plan touches](#11-files-this-plan-touches)
12. [Sources](#12-sources)

---

## 1. What was reported

Reported by the owner on 2026-10-04, one account signed in on the website (laptop) and on LuvLyrics (Android).

| # | Setup | What happens | What should happen |
|---|---|---|---|
| B1 | The laptop is playing. The phone shows "Playing on Chrome on Windows" and is used as a remote. | Tapping a song on the phone starts it **on the phone**, and the laptop stops. | The song plays **on the laptop**; the phone stays a remote. This is Spotify's rule, and this project's own decision in [PLAN.md §1](./PLAN.md): "Remote picks a song → it plays on the active device". |
| B2 | The laptop is playing. | The laptop shows the real cover. The phone's remote player and mini player show the generated colourful cover. | The phone shows the same cover as the laptop, and its backdrop takes that cover's colours. |
| B3 | The phone is playing. | The website shows the song and its synced lyrics, but the generated cover. | The website shows the phone's cover, in the bar, the full player and the OS media controls. |

All three were traced end to end through the code (section 2). None of them needs a backend change: the fixes
are in the two clients plus one shared helper.

---

## 2. Root causes, with the code that causes them

Paths below are relative to the repo root unless they start with `src/` (then `apps/mobile/src/`). Line numbers
are from `10f1e0c` and will drift; the named functions are the stable anchors.

### 2.1 B1: a song picked on the phone plays on the phone

The common case is a song in Library, tapped while the laptop is the active device:

1. `src/screens/LibraryScreen.tsx:147` calls `usePlayerStore.getState().setPlaylistQueue('library', items, index)`.
2. `src/store/playerStore.ts:537-542` offers the pick to Connect through `playlistSelectionRouter` before
   anything plays.
3. The router (`src/services/connect/ConnectProvider.tsx:144-156`) needs a `SongSnapshot` for the tapped song and
   builds it with `snapshotOfSong` (`src/services/connect/mobilePlayerPort.ts:19-31`). That works only when the
   song carries a provider ref: an `originId` (recorded by the downloader since the Connect work,
   `src/components/BackgroundDownloader.tsx:200`) or a `stream:<source>:<id>` id. A download from before origins
   were recorded, a file added from the phone's storage, or any row whose origin was never matched has neither,
   so `snapshotOfSong` returns `undefined` and the router answers `false`.
4. `setPlaylistQueue` carries on as if Connect did not exist: on Android it hands the queue to the Kotlin
   engine and calls `requestPlayback(true)` (`playerStore.ts:559-565`).
5. Media3 starts. The phone's player port reports a playing snapshot, and `onPlayerChange` in
   `packages/connect/src/connectSession.ts:624-635` reads "started playing while not the active device" as the
   listener choosing to play here, so it calls `claimLocal()`.
6. The claim makes the phone the active device. The laptop's session sees that it lost ownership while playing
   and pauses itself (`connectSession.ts:372`, `pauseAfterOwnershipLoss` at `:382`).

So the router exists (it was added after audit item 10 in [AUDIT-TRIAGE.md](./AUDIT-TRIAGE.md)), but it only
forwards songs that already carry a ref. PLAN.md's decision for exactly this case ("Older downloads fall back to
a title + artist search") was never wired into it. The lookup exists: `refFor()` in
`src/services/sync/LibrarySync.ts:162-168` searches the catalog by title and lead artist (`findInCatalog`,
`:643-657`) and remembers the result with `db.setOriginId`. It is async, and the router has to answer
synchronously, so it is not used.

The same router also drops queue songs it cannot name (`flatMap` at `ConnectProvider.tsx:150-153`). When it
does route, the laptop receives a shorter queue than the list that was tapped, and nothing says so.

Other ways the phone makes sound while it should be a remote:

| Entry point | Code | What it does today |
|---|---|---|
| Voice transport words: next, previous, pause, play, shuffle, "play number N" | `src/hooks/useVoiceCommands.ts:116-160` | Calls `nextInPlaylist`, `previousInPlaylist`, `requestPlayback` and `loadSong` on the phone's own player |
| Voice search, picking a song already on the phone | `src/components/VoiceSearchCard.tsx:121-128` | `loadSong` + `requestPlayback(true)`; never reaches the router |
| Home-screen widget, tapping the song the phone last held | `src/widget/useWidgetSync.ts:121-131` | `requestPlayback(true)` on the phone |
| Headset, Bluetooth, car, notification and lock-screen buttons | The Media3 session in `PlaybackService` (`QueueForwardingPlayer`) | Resume the phone's paused song, which then claims |
| The laptop briefly counted offline: Presence lag, or the phone opened a moment ago and has not received the device list yet | Router check `!active.activeDeviceOnline` (`ConnectProvider.tsx:149`); session `control()` falling back to `playLocally` (`connectSession.ts:584-587`) | Plays on the phone without saying why |

Why the tests stayed green: the router tests in `src/store/playerStore.test.ts:130-150` use songs that have refs.
Nothing covers a ref-less download, voice, the widget, media buttons, or the first second after the app opens
(`MemoryTransport` marks a device online the moment it registers, see [AUDIT-TRIAGE.md](./AUDIT-TRIAGE.md)).

### 2.2 B2 and B3: covers do not cross between devices

The contract already says what a cover on the wire must be: `SongSnapshot.artwork` is "https URL or ''"
(`docs/api-contract.md:217`). Covers get lost in three places, and neither app repairs a missing one.

**The phone sends no cover for anything it has downloaded (B3).**

- `snapshotOfSong` keeps `coverImageUri` only when it starts with `https://` (`mobilePlayerPort.ts:28`).
- A downloaded song's `coverImageUri` is the local `cover.jpg` the download saved
  (`src/services/DownloadManager.ts:109-117` for the WorkManager path, `:190-195` for the in-process path). The
  https URL the download started from (`selectedCoverUri`, `BackgroundDownloader.tsx:113-114`) is thrown away.
  A cover chosen with "Change cover" is a local file too.
- Result: every downloaded song is published as `artwork: ''`. The phone draws its local file, so the phone
  looks right; the website gets nothing.
- The listen tracker writes the same empty cover into account history (`ConnectProvider.tsx:224-231`), and from
  there it reaches library snapshots, which feeds B2.

**The website republishes stored snapshots instead of the cover it shows (B2).**

- `snapshotFromSong` (`apps/web/src/hooks/useConnect.ts:58-70`) returns `librarySong.librarySnapshot`
  unchanged whenever one exists. That is the snapshot stored with a like, playlist item or recent play
  (`apps/web/src/lib/libraryRows.ts:21-22`), or the snapshot that arrived from the phone (`resolvePlayable`,
  `useConnect.ts:97` and `:101`). Its `artwork` is whatever its first writer had, which is often `''`: from
  the phone (above), or because the API keeps only https covers (`apps/api/src/routes/user.ts:353`).
- Meanwhile the website *shows* the hydrated catalog row, whose `artwork` is a real https cover (production
  `GET /api/search` returns `https://c.saavncdn.com/…-500x500.jpg`, checked 2026-10-04). So the laptop looks
  right while the phone receives `''`.
- A song moved from the phone to the laptop keeps the phone's empty cover for good, because `resolvePlayable`
  attaches the incoming snapshot to the catalog song it found.
- Liking the song from the remote view (`apps/web/src/App.tsx:1073-1092`, through `snapshotForSong`) stores
  the empty cover again, so the problem feeds itself.
- Queued songs go through the same function, so queue rows lose their covers the same way.

**Receivers draw `''` as "no cover".**

- Phone: `src/components/connect/ConnectRemotePlayer.tsx:193` and `ConnectMiniPlayer.tsx:47` pass
  `view.song.artwork` straight to the cover, backdrop and palette (`:306`, `:327`, `:352`; queue rows at
  `:405`). `''` renders `GeneratedArtwork`, the duotone-and-monogram cover in
  `src/components/allegra/Artwork.tsx:30-99` (the "default colourful cover"), and the backdrop falls back to
  `FALLBACK_COLORS` (`:196`).
- Website: `remoteSong = snapshotToDisplaySong(connectView.song)` (`App.tsx:207`, `useConnect.ts:72-88`)
  carries `''` into the bar, the full player and the OS media controls (`useMediaSession`, `App.tsx:320-333`).
  Lyrics still work because they are looked up by title and artist.
- Both apps could find the cover from the ref. The phone has its own library (`originId` or `matchKey`),
  `getAllegraSongById`, and `CoverArtResolver`. The website has `fetchSongsByIds` (Saavn refs) and
  `GET /api/artwork?title&artist` (`apps/api/src/routes/artwork.ts:8-16`).

Convex is not involved: `assertSongSnapshot` only caps the length (`convex/schema.ts:72-83`).

---

## 3. How Spotify Connect works

Sources are listed in [section 12](#12-sources). Spotify's internal protocol is not public; section 3.2 relies on
librespot, the open-source client that implements it, and on the request logs its issues contain.

### 3.1 What a listener gets

- **A device picker.** The Connect button lists every device signed in to the account; picking one moves
  playback there. Any device can be the remote for any other.
- **Remote control of the active device**: play, pause, skip, previous, seek, shuffle, repeat and volume. The
  public Player API exposes the same verbs, one endpoint each.
- **A pick on a controller plays on the active device.** "Start/Resume Playback" starts the requested context
  or tracks on the active device; its `device_id` parameter is optional, and without it the target is the
  account's currently active device. The phone does not start its own audio because you browsed on it.
- **Transfer** takes one target device and a `play` flag: `true` makes sure playback runs on the new device,
  `false` (or absent) keeps the current play/pause state.
- **Devices are described**, not just named: `is_active`, `is_restricted` (no commands accepted),
  `is_private_session`, `type` (computer, smartphone, speaker), `volume_percent` and `supports_volume`.
- **Playback state** carries the device, the `context` the music plays from (album, playlist, artist), a
  `timestamp` plus `progress_ms` (so every device can extrapolate the position), `is_playing`, the item with
  its album `images` (https URLs every device can load), `shuffle_state`, `repeat_state`, and
  `actions.disallows` (interrupting playback, pausing, resuming, seeking, skipping either way, toggling repeat
  and shuffle, transferring). Remotes grey out what the playing device cannot do instead of failing.
- **The queue** can be read (`currently_playing` plus `queue`) and added to from any device.
- **Lock screen and notification on Android.** The "Spotify Connect control" setting (Settings → Apps and
  devices) shows controls for the device you are listening on in the phone's notification and lock screen.
- **Volume from the phone.** While listening on a PC, the phone's controls change the PC's volume. iOS lost the
  hardware-button version of this because Apple withdrew the API it used.
- **Local files stay on their device.** Spotify's community answer is that local files cannot be played through
  Connect; they play only on the device that stores them.
- **Jam**: a shared session where guests add songs to the host's queue. Allegra's equivalent is Listen Together,
  which is a separate system (Echo's protocol) and out of scope here.
- **Device settings** include "Show local devices only" and "Device broadcast status" (named in a SlashGear
  troubleshooting guide), and the lock-screen Connect control above.

### 3.2 How it works inside

- Every device keeps one websocket (the "dealer") for pushes and writes its whole state to the server whenever
  it changes (a `PutStateRequest`). The state has two halves:
  - `device_info`: `can_play`, `volume`, `name`, `device_type`, and `capabilities` (`can_be_player`,
    `is_controllable`, `supports_transfer_command`, `command_acks`, `volume_steps`, `supported_types`).
  - `player_state`: `timestamp`, `position_as_of_timestamp`, `duration`, `playback_speed`, `context_url`,
    `play_origin`, `index`, the `track` with its `uri` and `metadata` (title, artist, album,
    `image_url`, `image_small_url`, `image_large_url`), `prev_tracks`, `next_tracks`, `options` (shuffling
    context, repeating context, repeating track), `restrictions`, `session_id`, `playback_id`.
  - Plus `is_active`, `put_state_reason`, `started_playing_at` and `client_side_timestamp`.
- **Covers travel as catalog image ids** (`spotify:image:<id>`), which any device resolves. A device never puts
  a path that only it can open into shared state. This is the property Allegra is missing (B2, B3).
- **Commands are requests that get a reply** (done or failed), sent only to the active player: `transfer`,
  `play` (a context plus options such as `skip_to`, `initially_paused` and `only_for_local_device`), `pause`,
  `resume`, `seek_to`, `skip_next` (optionally to a given track), `skip_prev`, `set_shuffling_context`,
  `set_repeating_context`, `set_repeating_track`, `add_to_queue`, `set_queue` (with a `queue_revision`),
  `set_options` and `update_context`. Volume changes and logout are fire-and-forget messages.
- **Queue entries carry a uid** (`q0`, `q1`, …), so a reorder or removal names one entry even when the same
  song is queued twice. Allegra names entries by `{index, ref}` instead (`docs/connect-contract.md`, Commands).
- **Track metadata matters to remotes**: librespot's docs note that mobile clients in particular rely on it to
  show the context correctly (for example, that a song came from autoplay).

### 3.3 What to take from it

1. **Shared state holds only what every device can use.** Song identity is a catalog ref; the cover is a
   catalog URL or id. Nothing device-local crosses (no `file:`, no `content:`).
2. **The active device is the default target.** A controller sends picks and controls there. It makes sound
   itself only when the listener chooses it (the picker, or an explicit "play here").
3. **Commands and state stay separate.** Commands are acknowledged requests; state is one document with a
   position anchor that every device extrapolates. Allegra already does this (`positionAt` plus server clock
   offset, V2 acknowledged commands).
4. **Capabilities and restrictions are explicit**, so remotes hide controls that cannot work.
5. **Queue entries need their own identity**, not only a position.
6. **The OS integration follows the active device**: the lock screen, notification and volume keys control
   whichever device is playing.

---

## 4. Spotify Connect against Allegra today

"Works" means present in code; most of it was never run on two signed-in devices (see HANDOFF.md).

| Capability | Spotify | Allegra web | Allegra phone | State | Plan |
|---|---|---|---|---|---|
| Device picker, device type icons, rename | Yes | `ConnectPicker.tsx` | `ConnectDeviceSheet.tsx` | Works | – |
| One device plays at a time | Yes | Yes | Yes | Works | – |
| Transfer with song, position, queue, shuffle, repeat | Yes | V2 transfer with confirmed pause | Same | Works | – |
| Take over from an owner that went offline | Yes | Yes (2026-10-01) | Yes | Works | – |
| Remote play, pause, next, previous, seek, volume, shuffle, repeat | Yes | Yes | Yes | Works | – |
| A pick on a controller plays on the active device | Yes | Yes (catalog songs always have refs) | Only songs that already carry a ref | **Broken (B1)** | Phase 1 |
| Voice, widget and media-button actions control the active device | Yes (Connect control) | Media keys: yes (`useMediaSession`) | No: they act on the phone | **Broken (B1)** | Phases 1, 3 |
| Local-only song picked while another device plays | Plays only where stored | n/a | Silently plays on the phone and steals | **Broken (B1)** | Phase 1 |
| Cover of the remote song | Yes (catalog image ids) | Often missing | Often missing | **Broken (B2, B3)** | Phase 2 |
| Covers in the remote queue | Yes | Often missing | Often missing | **Broken** | Phase 2 |
| Synced lyrics following the remote position | No equivalent | Yes | Yes | Better than Spotify | – |
| Queue: view, add next or last, remove, clear | Add and view (public API) | Yes (protocol 3) | Yes (protocol 3) | Works | – |
| Queue: drag to reorder | Yes | Move-to-next only | Move-to-next only | Partly | Phase 3.7 |
| Queue entries with their own identity | Yes (uids) | `{index, ref}` | `{index, ref}` | Partly | Phase 3.6 (later) |
| "Playing from" context (album, playlist, radio) | Yes | Not shared | Not shared | Missing | Phase 3.3 |
| Autoplay keeps going on the active device after a remote pick or transfer | Yes | Only if radio was on locally | Never: Connect queues are excluded from refills (`StreamService.ts:204`, `:219`) | Missing | Phase 3.4 |
| Lock-screen and notification controls for the other device | Yes (Android) | Browser media hub already shows the remote | No | Missing | Phase 3.1 |
| Hardware volume keys change the other device's volume | Yes (Android) | n/a | No | Missing | Phase 3.2 |
| Per-action restrictions ("disallows") | Yes | `canPlay`, `queueEditable` only | Same | Partly | Phase 3.5 |
| `canPlay:false` (Listen Together) blocks every command, not only transfers | Yes (`is_restricted`) | Transfers only (audit item 9) | Same | Partly | Phase 3.5 |
| Visible feedback when a pick is on its way to another device | Yes | Pending state exists | Nothing while a ref is looked up | Missing | Phase 1.6 |
| Waking a device whose app is closed | Yes (speakers, apps in background) | n/a | No (needs push) | Missing | Phase 4 (deferred) |
| Several tabs of one browser act as one device | n/a | Web Locks leader | n/a | Works | – |

**What has to be implemented, in order of importance:**

1. Route every phone pick and control to the active device, including songs without a ref yet, voice, the
   widget, and the moment after the app opens (Phase 1).
2. Never let a controller make sound by accident: a local-only song asks first; an offline owner falls back
   with a message (Phase 1).
3. Make covers travel: both apps publish an https catalog cover, and both apps look up a missing cover by ref
   (Phase 2).
4. Spotify parity that listeners notice: notification and lock-screen controls plus volume keys for the other
   device on Android, "Playing from", autoplay on the active device, drag-to-reorder, explicit restrictions
   (Phase 3).
5. Later: push to wake a closed phone app (Phase 4).

---

## 5. Target behaviour

### 5.1 Rules

1. **One target.** While another of the listener's devices is active and online, every pick and every control
   made on a controller goes to that device.
2. **A controller makes sound only when the listener chooses it**: by picking it in the device list, or by
   confirming "Play on this phone" when the active device cannot play the song or is offline. Never as a side
   effect of browsing.
3. **Shared song data is device-independent.** A `SongSnapshot` names the song by catalog ref and its cover by
   an https URL, or `''` when none is known.
4. **`''` means "look it up", not "no cover".** Receivers resolve a missing cover from the ref before falling
   back to the generated cover.
5. **Everything a remote shows comes from shared state plus local lookups**: cover, colours, lyrics, queue
   covers and OS media controls. No device-local path crosses the boundary.
6. **Every routed action shows that it is on its way** within about 150 ms (pending state or haptic), then
   confirms or rolls back. The rollback already exists (V2 outcomes).

### 5.2 Where an action on the phone goes

| This phone | Active device | Pick a song or a list | Play, pause, next, previous, seek, shuffle, repeat | Volume keys |
|---|---|---|---|---|
| Signed out, or the Connect session has not started | – | Here | Here | Phone |
| In a Listen Together room | – | Here (the room owns playback) | Here | Phone |
| Signed in | None, or this phone | Here | Here | Phone |
| Signed in | Another device, online | **That device.** The song is named by its ref; an older download is looked up first. A song only this phone has opens "Play on this phone?" | **That device** | That device (Phase 3.2) |
| Signed in | Another device, offline | Here, with "Chrome on Windows is offline, so this plays here." | Here | Phone |
| Signed in | Another device, but the first state and device list have not arrived yet | Wait up to 1.5 s for them, then decide as above | Same | – |

The website follows the same table. Its catalog songs always carry refs, so only the offline row and the
"not loaded yet" row need work there.

### 5.3 What a cover on the wire is

- An `https://` URL of at most 2048 characters that any device can load without credentials, or `''`.
- Never `file:`, `content:`, `data:`, `blob:`, a relative path, or `http:`. Android refuses cleartext image
  requests by default, so an `http:` cover from a known catalog CDN is upgraded to `https:` before it is sent.
- When the cover a device shows is local (a downloaded `cover.jpg`, a cover the listener chose), it sends the
  catalog cover for the same song instead.

---

## 6. Implementation plan

Sizes: S is under a day, M is one to three days, L is more. Each phase is its own branch and pull request,
squash-merged, with the root and mobile gates green (section 8). Phases 1 and 2 are independent of each other
and of IMPROVEMENT-PLAN P1–P9; Phase 3.1 overlaps P7 (lifecycle) and should be reviewed against it.

### Phase 0: make the bugs fail in tests first (S)

Each of these fails on `10f1e0c` and passes once its phase lands.

- [ ] 0.1 `src/store/playerStore.test.ts`: another device is active and online; `setPlaylistQueue('library',
  [download without originId, …], 0)` must not load anything locally (no `pushQueue`, no `loadSong`, no
  `requestPlayback(true)`), and the router must be asked.
- [ ] 0.2 Same file: the router answers with a `play_song` whose queue keeps the ref-less songs once they are
  looked up, in order (stub `refFor`).
- [ ] 0.3 New `src/services/connect/playbackRoute.test.ts`: the decision table in 5.2, row by row.
- [ ] 0.4 `src/services/connect/mobilePlayerPort.test.ts` (or a new test beside it): `snapshotOfSong` for a
  download with a local `coverImageUri` and an https `coverRemoteUri` sends the https cover.
- [ ] 0.5 Web, new `apps/web/src/hooks/connectSnapshot.test.ts` (extract `snapshotFromSong` into a pure module
  so it can be tested without React): a `LibrarySong` whose `librarySnapshot.artwork` is `''` while `artwork`
  is https publishes the https cover.
- [ ] 0.6 `packages/connect/src/connectSession.test.ts`: `control({kind:'play_song'})` while the active device
  is offline records a notice (`ConnectView.notice`, Phase 1.7) instead of failing silently.

### Phase 1: every action on the phone goes where the music is (M)

**1.1 One routing decision.** New `src/services/connect/playbackRoute.ts`, pure:

```ts
export type PlaybackRoute =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly deviceId: string; readonly deviceName: string }
  | { readonly kind: 'local_owner_offline'; readonly deviceName: string }
  | { readonly kind: 'wait' };

export function decidePlaybackRoute(input: {
  readonly view: ConnectView | null;
  readonly deviceId: string | null;
  readonly roomActive: boolean;
}): PlaybackRoute;
```

It implements table 5.2. `remote` does not require `view.song`: an active device with nothing loaded still
receives the pick, as on Spotify. The same predicate replaces the two that disagree today, the web's
`remotePlayback` (`App.tsx:205-206`, no song required) and the phone's (`ConnectProvider.tsx:289`, song
required), by moving `isControllingAnotherDevice(view, deviceId)` into `packages/connect`.

**1.2 Tell "offline" from "not loaded yet".** Add `ready: boolean` to `ConnectView`
(`packages/connect/src/types.ts`, built in `view()` in `connectSession.ts:214-255`): true once the first
`state()` and `devices()` results have arrived. No wire change. `decidePlaybackRoute` returns `wait` while it
is false; callers wait for the next view (at most 1.5 s) and then decide again, treating a timeout as `local`.

**1.3 One door for user playback on the phone.** New `src/services/connect/playbackIntents.ts`:

```ts
export const playback = {
  playList(playlistId: string, songs: readonly Song[], startIndex: number, options?: { forceLocal?: boolean }): void;
  resume(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(sec: number): void;
  setShuffle(on: boolean): void;
  setRepeat(mode: RepeatMode): void;
  playQueueIndex(index: number): void;
};
```

- `ConnectProvider` registers the live session and device id into a module slot, as `setPlaylistSelectionRouter`
  does today, so `playerStore` never imports Connect (no import cycle).
- The local branch calls the existing store functions, so `requestPlayback` stays the only local play/pause
  funnel (mobile invariant 1) and nothing touches load effects (invariant 2) or seeks (invariant 3).
- The remote branch calls `session.control(...)`. `playQueueIndex` maps to `play_song` with the rest of the
  remote queue, exactly as the remote queue sheet does (`ConnectRemotePlayer.tsx:398-401`).

**1.4 The router owns a pick as soon as the music is elsewhere.** Change the contract of
`setPlaylistSelectionRouter` (`playerStore.ts:30-37`): it returns `true` whenever the route is `remote`, even
before every song has a ref, and resolves the rest itself:

```ts
async function sendPick(songs: readonly Song[], startIndex: number, generation: number): Promise<void> {
  const selected = songs[startIndex];
  const ref = knownRef(selected) ?? await withTimeout(refFor(selected), 6_000).catch(() => null);
  if (generation !== latestPick) return;              // a newer tap won
  if (!ref) { askPlayHere(selected, songs, startIndex); return; }
  const rest = songs.slice(startIndex + 1);
  const ready = rest.flatMap(song => { const r = knownRef(song); return r ? [snapshotFor(song, r)] : []; });
  session.control({ kind: 'play_song', song: snapshotFor(selected, ref), queue: ready.slice(0, 49) });
  const missing = rest.filter(song => !knownRef(song)).slice(0, 49);
  if (missing.length) appendWhenFound(missing, generation); // refFor, two at a time, then one queue_add with `more`
}
```

- `knownRef(song)` is the synchronous part: `refForLocalSong(song)` (`src/services/sync/plan.ts:56`) or
  `fromMobileId(song.id)`. `refFor` is the existing async lookup; it also saves the origin, so the next tap on
  the same song is instant. Phase 2.5 runs the same lookup in the background, so most taps never wait.
- Songs found late are appended at the end with one `queue_add {song, more}` (protocol 3). Their order among
  themselves is kept; they land after the songs that were ready. A target on protocol 2 gets them one
  `queue_add` at a time. This is the documented trade-off for not delaying the first song.
- Songs never found are left out and counted: "2 songs that are only on this phone were left out."

**1.5 Ask before a local-only song moves playback.** New `src/components/connect/ConnectChoiceSheet.tsx`, a
`PlayerSheet` in the player's glass style:

- Title: "Play on this phone?"
- Body: "“<title>” is only on this phone, so <device> can't play it. <device> will stop."
- Buttons: "Play on this phone", which calls `playback.playList(..., { forceLocal: true })` (the existing
  local path; the session's claim then pauses the other device, as a pick in the device list would), and
  "Cancel", which changes nothing.
- The same sheet serves the website-only case later if one appears. Copy follows the mobile rules: sentence
  case, no emoji.

**1.6 Show that a pick is on its way.** While `sendPick` resolves, `ConnectMiniPlayer` shows "Sending to
<device>…" with the tapped song's title, plus a light haptic on the tap. It clears on the `play_song` outcome
(confirmed or rolled back by the existing V2 outcome path) or on the choice sheet.

**1.7 Say so when an offline owner makes this phone play.** Add `notice?: { code: 'played_here_owner_offline';
deviceName: string; at: number }` to `ConnectView`, set by `control()` in `connectSession.ts:584-587` when it
falls back to `playLocally`. The phone shows it as a toast ("Chrome on Windows is offline, so this plays
here."); the website shows it in the picker and the bar. No wire change.

**1.8 Move the callers that bypass Connect onto `playback`:**

- `src/hooks/useVoiceCommands.ts:116-160`: every transport case. "Play number N" uses the remote queue when
  the route is `remote`.
- `src/components/VoiceSearchCard.tsx:121-128`: a local pick becomes `playback.playList('voice', [song], 0)`.
- `src/widget/useWidgetSync.ts:121-131`: `playback.resume()` for the same song, `playback.playList` otherwise.
- `lyricflow://play?q=` already goes through `StreamService.play` → `setPlaylistQueue`; add a test so it stays
  routed.
- Luvs pauses only the phone's own player before a clip (`LuvsScreen.tsx:180`, `:190`); confirm it never
  sends a pause to the other device. Its "play this" goes through `StreamService.play` and is routed.

**1.9 Keep it routed.** New `src/connectRouting.test.ts`, in the style of `src/workletSafety.test.ts`: it scans
`src/**/*.ts(x)` and fails on `requestPlayback(true)`, `loadSong(`, `nextInPlaylist(`, `previousInPlaylist(`
or `skipToQueueIndex(` outside an allowlist (`playerStore.ts`, `playbackIntents.ts`, `mobilePlayerPort.ts`, the
local player's own load and transport code in `MiniPlayer.tsx` and `useNowPlayingLogic.ts`, `UpNextPanel.tsx`,
`playback/recovery.ts`). A new screen that starts audio directly then fails CI instead of reopening B1.

**1.10 Media buttons until Phase 3.1** (decision D3). Today a headset, car or notification "play" resumes the
phone's paused song and takes over. Until the remote notification exists, keep that and document it: it is
a deliberate press on this phone's own player, which is also what Spotify does when its Connect control is
off. Phase 3.1 makes those buttons control the active device.

**1.11 Website parity.** `playRemote` (`useConnect.ts:600-616`) falls back to local playback when the active
device is offline, without a word: show the 1.7 notice. Use the shared predicate from 1.1 for
`remotePlayback`.

**Phase 1 is done when**, with the laptop playing and the phone as remote:

- Tapping any song on the phone plays it on the laptop: a stream result, a playlist row, a search row, a
  download with an origin, a download without one (after its lookup), a voice pick, a widget tap. The rest of
  the list is queued on the laptop. The phone makes no sound and still shows "Playing on Chrome on Windows".
- A song that exists only on the phone opens the choice sheet. "Play on this phone" moves playback; "Cancel"
  changes nothing.
- Voice "next", "pause" and "play" act on the laptop.
- With the laptop offline for more than 150 s (lid closed), a tap plays on the phone and says why.
- Opening the app and tapping a song within the first second still routes to the laptop.

### Phase 2: covers that travel (M)

**2.1 One rule for a shareable cover.** New `packages/shared/artwork.ts` (imports nothing, per the Metro rule
for `packages/`), with a test beside it:

```ts
/** The first candidate every device can load: https, credential-free, at most 2048 characters; else ''. */
export function shareableArtwork(...candidates: readonly (string | null | undefined)[]): string;
```

- Upgrades `http:` to `https:` for the catalog image hosts Allegra uses (`*.saavncdn.com`, `*.gaanacdn.com`,
  `i.ytimg.com`, `*.googleusercontent.com`, `*.mzstatic.com`). Rejects every other scheme and relative paths.
- Written with string checks, not `new URL()`: React Native's `URL` is partial, and its setters throw.
- Used by every place that builds a `SongSnapshot` on either app.

**2.2 The phone keeps the catalog cover beside the local file.**

- SQLite: add `songs.cover_remote_uri TEXT` with a migration in `src/database/db.ts` (as `lyrics.words` was
  added on 2026-10-03), read and write it in `src/database/queries.ts` (the row mappers near `:85`, `:132`,
  `:191`; the inserts near `:230`, `:275`), and add `coverRemoteUri?: string` to `src/types/song.ts`.
- `src/components/BackgroundDownloader.tsx`: before `addSong(newSong)`, set
  `newSong.coverRemoteUri = shareableArtwork(item.song.highResArt, item.song.thumbnail) || undefined`.
  The local `cover.jpg` stays for offline display.

**2.3 Older downloads learn their origin and cover once.**

- `findInCatalog` (`LibrarySync.ts:643-657`) returns `{ ref, artwork }` instead of the ref alone; `refFor` saves
  both (`db.setOriginId`, plus a new `db.setCoverRemoteUri` that writes only when the row has none).
- New `src/services/sync/originBackfill.ts`, started with `runWhenIdle` (`services/bootPhases`): only when
  signed in, the app is in front and Battery Saver is off; up to 10 songs per run, one lookup at a time with a
  pause between them; a per-song `origin_checked_at` so a miss is not retried for 7 days. It ends itself, per
  the "nothing ticks when nothing is watching" rule in `apps/mobile/CLAUDE.md`.
- Payoff for Phase 1 too: once a song has its origin, a tap on it routes without waiting.

**2.4 The phone publishes shareable covers.**

- `snapshotOfSong` (`mobilePlayerPort.ts:19-31`): `artwork: shareableArtwork(song.coverImageUri, song.coverRemoteUri)`.
- The listen tracker (`ConnectProvider.tsx:224-231`): `HeardSong` carries `coverRemoteUri`, and `snapshotFor`
  uses the same helper, so account history stops recording empty covers.
- `adopt` (`mobilePlayerPort.ts:69-88`) already keeps the sender's cover when the matched song has none to
  share; keep that, now through the helper.

**2.5 The website publishes the cover it shows.**

- `snapshotFromSong` (`useConnect.ts:58-70`): start from the stored snapshot, but set
  `artwork: shareableArtwork(song.artwork, base.artwork)`, the hydrated catalog cover first.
- `resolvePlayable` (`useConnect.ts:90-102`): attach
  `librarySnapshot: { ...snapshot, artwork: shareableArtwork(found.artwork, snapshot.artwork) }`, so a song
  that arrived with `''` is sent on with the cover the website found.
- Likes and playlist edits made from the remote view use the same function, so they store the cover from now
  on.

**2.6 The phone fills a missing cover when it draws one.** New `src/services/connect/useSnapshotCover.ts`:

- Returns `snapshot.artwork` when it is set.
- Otherwise, in order: this phone's own copy of the song (`originId === ref`, or the same `matchKey`), whose
  local `coverImageUri` is fine to draw on this phone; `getAllegraSongById(ref, token)`; `CoverArtResolver`
  (iTunes, then Saavn).
- Caches per ref (at most 200, in memory), runs one lookup per ref, and cancels with the component.
- Used by `ConnectRemotePlayer` (cover, backdrop and palette), `ConnectMiniPlayer` and the remote queue rows.

**2.7 The website fills a missing cover when it draws one.** New `apps/web/src/hooks/useSnapshotArtwork.ts`
with the same contract: `fetchSongsByIds` for a Saavn ref, otherwise `GET /api/artwork?title&artist&limit=1`;
cached per ref. Used for `remoteSong` (and so the bar, the full player and `useMediaSession`) and for the remote
queue rows that are on screen.

**2.8 Write the rule down.** In `docs/connect-contract.md` ("Every song crossing the device boundary…") add the
rule from 5.3, and that receivers treat `''` as "look it up by ref". `docs/api-contract.md:217` already says
"https URL or ''"; link the two. No validator changes.

**2.9 Optional server guard.** In `convex/connect.ts`, normalise a non-https `artwork` to `''` before storing
a snapshot, instead of storing it, with a Convex test. Old phones never send one (they filter), so nothing
changes for them; it protects against a future client bug.

**2.10 Development check.** In development builds, the Connect trace flags any `file:`, `content:` or `http:`
artwork that reaches `convexWire.ts` (`song()` at `:37-50`), so a regression shows up in testing.

**Phase 2 is done when:**

- The laptop plays a liked song whose stored snapshot had no cover: the phone's remote player shows the real
  cover, its backdrop takes the cover's colours, and the queue rows have covers.
- The phone plays a download, with or without a recorded origin: the website shows the real cover in the bar,
  the full player, the queue and the OS media controls.
- A file that exists only on the phone and has no catalog match shows the generated cover on both devices.
  That is expected.
- No `file:`, `content:` or `http:` cover is ever stored in `playerState` (2.10 stays silent through the
  acceptance run).

### Phase 3: Spotify parity (L in total; each item ships on its own)

**3.1 Controls for the other device in the phone's notification and lock screen (L).** Spotify's "Connect
control".

- Kotlin: a `ConnectRemotePlayer` that extends Media3's `SimpleBasePlayer`, beside `QueueForwardingPlayer` in
  the playback service. JavaScript feeds it the Connect view through `MainPlayer.setRemoteState({ title,
  artist, artworkUri, durationMs, positionMs, positionAtMs, playing, volume, deviceName, canSeek, canNext,
  canPrevious })`; the artwork comes from Phase 2.
- Its `State` uses `DeviceInfo` of type `PLAYBACK_TYPE_REMOTE` with a volume range of 0–100, and the
  device-volume commands. Media3 then shows the notification and lock-screen controls and routes the volume
  keys to the player's device-volume handlers.
- Its handlers (play/pause, seek, next, previous, device volume) emit `onRemoteCommand` back to JavaScript,
  which calls `session.control(...)`.
- While another device is active, the playback service's session uses this player; when this phone becomes
  active again it switches back to the local one. The notification's subtitle names the device: "Playing on
  Chrome on Windows".
- Setting: Settings → Playback → "Control other devices from the lock screen", on by default.
- Lifecycle (decision D4): the session's `shouldListen()` (`connectSession.ts:266`) is today "visible, or
  playing here, or active". While the remote notification is shown, it must also listen while the other device
  plays, or the notification goes stale. Proposal: listen while the other device plays and the setting is on;
  stop after the other device has been paused for 10 minutes. Cost: one Convex subscription, which pushes only
  on change, plus the 60-second heartbeat. Review against IMPROVEMENT-PLAN P7.
- Tests: Kotlin unit tests for the state mapping (`./gradlew :app:testDebugUnitTest`); a phone probe step that
  checks the notification text while the website plays.

**3.2 Volume keys change the other device's volume (S, comes with 3.1).** Map the device-volume handlers to a
`volume` command, one per key burst: send the settled value 300 ms after the last press. The existing command
queue coalesces bursts.

**3.3 "Playing from" (M, protocol 4, additive).**

- Add `context?: { kind: 'album' | 'playlist' | 'liked' | 'artist' | 'search' | 'radio' | 'library' | 'other';
  title: string; id?: string }` (title at most 200 characters) to `PlayerSnapshot`, `PlayerStatePatch`, the
  `playerState` table, the `play_song` arguments and the `take_over` state. The decoders in `convexWire.ts`
  treat it as optional.
- Phone: from `currentPlaylistId` and the existing `coverStage.playingFromLabel`. Website: passed by each
  `playSong` caller (album page, playlist page, Liked songs, search, home shelves, radio).
- Remotes show "Playing from Liked songs" in the header. A transfer carries it, so the new device can continue
  in the same spirit (3.4).

**3.4 Autoplay on the device that plays (S).**

- Phone: remove `'connect'` from `NOT_OURS` (`StreamService.ts:204`), so a queue that arrived by Connect is
  topped up with similar songs like any other queue when Settings → Playback → "Keep playing similar songs"
  is on. Listen Together stays excluded.
- Website: after a Connect load, set `radioActiveRef` from `settings.autoplaySimilar`, as `playSong` does for a
  local pick (`App.tsx:1006-1008`).
- The playing device's own setting decides (decision D5). Added songs reach every remote through the normal
  queue report.

**3.5 Explicit restrictions (M).**

- The server refuses ordinary commands to a device registered with `canPlay: false` (Listen Together), with
  `target_cannot_play`, not only transfers (audit item 9).
- `ConnectView` gains `controls: { playPause, seek, next, previous, shuffle, repeat, volume, queueEdit,
  transfer }`, derived from what is already known: the active device is online and can play, its protocol
  version, a known duration, a non-empty queue or repeat. Remotes on both apps disable what is false and say
  why ("In Listen Together on Pixel 8").

**3.6 Queue entries with their own identity (later).** Add an optional per-entry `uid` to queue snapshots and
queue commands in protocol 4 only if duplicate songs in one queue turn out to matter in practice. Until then
`{index, ref}` stays.

**3.7 Drag to reorder the remote queue (S–M).** The command exists (`queue_move {from, to, ref}`); only the
UI is missing. Phone: reuse `UpNextPanel`'s drag handle in the remote queue sheet. Website: the Playing Next
panel.

**3.8 Polish the "Listening on" state (S).** The phone's remote mini player names the device (it does today)
and shows the 1.6 pending state and the 1.7 notice; the website's bar does the same. Check both at 360, 768,
1280 and 1920 px per the repo rules.

### Phase 4: wake a phone whose app is closed (deferred, L)

HANDOFF.md lists this as the planned push path. Outline only:

- The phone registers an FCM token with its device row.
- `transferV2` or `sendV2` to an offline Android device sends a high-priority data message.
- The message starts a headless task that registers, drains the inbox and executes the `take_over`.

Needs Firebase setup, a server key in the Convex environment, and the Android 12+ rules for starting a
foreground service from the background (a high-priority message is the allowed path). Not started until the
owner asks for it (decision D6).

### Phase 5: two-device acceptance and documentation (M)

- Run the script in 8.2 on a signed-in website and the release APK on a physical Android phone. Record the
  results in HANDOFF.md, as the 2026-10-01 runs were.
- Update `docs/architecture.md` (Connect section: the routing rule and the cover rule),
  `docs/connect-contract.md` (2.8, and protocol 4 if 3.3 or 3.6 ship), `apps/mobile/CLAUDE.md` (Connect
  file-map entry: `playbackIntents`, `playbackRoute`, `cover_remote_uri`, `useSnapshotCover`, the remote
  notification), HANDOFF.md, and LEARNING-LOG.md ("shared state must carry device-independent covers").

---

## 7. Contract, compatibility and rollout

| Phase | Wire change | Order | Mixed versions |
|---|---|---|---|
| 1 | None (`ConnectView.ready` and `notice` are client-side) | APK | An old website is unaffected. |
| 2 | None. The contract text is clarified (2.8); 2.9 is server-side normalisation only | Website (Vercel), then APK | Fine both ways: receivers fill missing covers, so an old sender's `''` still shows a cover on a new receiver. |
| 3.1, 3.2, 3.4, 3.7, 3.8 | None | APK (3.4 and 3.7 also the website) | Fine. |
| 3.3 (and 3.6 if needed) | Protocol 4, additive | Convex first, then the website, then the APK | `register` returns the server's protocol version, and a client sends `context` only to a server that accepts it. This is the lesson of the 2026-10-01 incident, when a new client's `protocolVersion` was rejected by an old backend and the picker stayed empty. `scripts/vercel-build.mjs` already deploys Convex first in production. |
| 3.5 | Server refuses commands to `canPlay: false` targets | Convex | Old clients see `target_cannot_play` as a failed command, which their existing copy handles. |
| 4 | New device-token field and push action | Convex, then APK | Deferred. |

Delivery follows the repo rules: one branch per phase (`fix/connect-remote-picks`, `fix/connect-covers`,
`feat/connect-lock-screen`, …), conventional commits without AI attribution footers, small pull requests
squash-merged after review, and `main` always green. No production deploy happens from a dirty tree
(HANDOFF.md).

---

## 8. Verification

### 8.1 Automated, before each pull request

- Root: `npm run typecheck`, `npm run lint`, `npm test` (shared, Convex, web, API).
- Convex: `npx tsc --noEmit -p convex`, plus Convex tests for 2.9 and 3.5.
- Phone: `npm run mobile:check` (tsc, eslint, jest including `connectRouting.test.ts` and
  `workletSafety.test.ts`).
- Kotlin (3.1): `cd apps/mobile/android && ./gradlew :app:testDebugUnitTest`.
- Before a release: `npm run e2e`, and the Android player probe.

Test files this plan adds or extends:

| Test | Covers |
|---|---|
| `src/services/connect/playbackRoute.test.ts` | Table 5.2, row by row |
| `src/store/playerStore.test.ts` | Ref-less downloads, late refs, the choice sheet path, `forceLocal` |
| `src/services/connect/playbackIntents.test.ts` | Each intent goes to `session.control` or to the store |
| `src/connectRouting.test.ts` | No new caller starts audio outside the allowlist |
| `packages/shared/artwork.test.ts` | Schemes, the http upgrade list, length, credentials, relative paths |
| `src/services/connect/mobilePlayerPort.test.ts` | Downloads send `coverRemoteUri`; a local custom cover sends the catalog cover |
| `src/services/sync/originBackfill.test.ts` (real SQLite, per the mobile rule) | Batch size, the retry gap, stopping itself |
| `apps/web/src/hooks/connectSnapshot.test.ts` | Stored `''` versus shown https; `resolvePlayable` carries the found cover on |
| `packages/connect/src/connectSession.test.ts` | `ready`, `notice`, `controls` |
| `convex` tests | Artwork normalisation (2.9); `canPlay: false` refuses commands (3.5) |

### 8.2 Two-device acceptance script

Signed in to the same Google account on the website (production, or the local app on :5173, never an :8080
URL) and on the release APK on a physical phone.

| # | Steps | Expected |
|---|---|---|
| A1 | Laptop plays a search result. Phone opens Library and taps a downloaded song that has an origin. | Plays on the laptop within about 2 s. Phone silent, shows "Playing on …". |
| A2 | Same, with a download made before origins existed. | "Sending to …" appears, then it plays on the laptop. A second tap on the same song is instant. |
| A3 | Same, with a file copied onto the phone that has no catalog match. | The choice sheet. "Cancel": nothing changes. "Play on this phone": the phone plays, the laptop pauses. |
| A4 | Phone voice: "next", "pause", "play". | Each acts on the laptop. |
| A5 | Phone widget: tap a song. | Plays on the laptop. |
| A6 | Close the laptop lid, wait 3 minutes, tap a song on the phone. | Plays on the phone, with the offline notice. |
| A7 | Force-stop the phone app, reopen it, tap a song at once. | Routed to the laptop (the `wait` row). |
| C1 | Laptop plays a liked song from its Library. | The phone's remote player shows the same cover, its backdrop tinted by it, and queue rows have covers. |
| C2 | Phone plays a download. | The website's bar, full player, queue and OS media controls show its cover. |
| C3 | Move playback phone → laptop, then laptop → phone. | The cover is right on both devices after each move. |
| C4 | Like the remote song from the website. | The like keeps the cover in Library on both devices. |
| P1 (3.1) | Laptop plays; lock the phone. | The lock screen shows the song, cover and controls for the laptop; play, pause and skip act on the laptop. |
| P2 (3.2) | Phone volume keys while the laptop plays. | The laptop's volume changes, once per press burst. |
| P3 (3.3) | Laptop plays from an album. | The phone shows "Playing from <album>". |
| P4 (3.4) | Phone sends a three-song list to the laptop with "Keep playing similar songs" on. | Similar songs follow when the list runs out. |

Record the time from tap to sound for A1 and A2 (sender's clock only, as IMPROVEMENT-PLAN P0 requires).

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A download's title-and-artist lookup finds a different recording (a cover version, a remix), so the laptop plays the wrong one | `findInCatalog` already requires the same cleaned title and lead artist (`matchKey`). Show the matched title in the "Sending to …" state, so a wrong match is visible and can be cancelled. |
| A slow lookup delays the first song | 6-second cap, then the choice sheet; the background backfill (2.3) makes lookups rare. |
| Songs found late join the end of the remote queue instead of their original place | Documented trade-off (1.4). Revisit with `queue_add` at an index if listeners notice. |
| Cover lookups add API calls | Only for snapshots with `''`, once per ref, cached; senders stop sending `''` after Phase 2. |
| The remote notification keeps the phone listening in the background (battery, Convex) | Only while the other device plays and the setting is on; stops after 10 minutes paused (D4). |
| The remote notification needs JavaScript alive to send commands | The playback service keeps the process; if React Native's instance has died, the controls fail with the existing command-failure path, not silently. |
| A protocol 4 client meets a protocol 3 backend | The version handshake in section 7. |
| Mobile invariants (one funnel, load effects, seek resume) | `playbackIntents` calls only the existing store functions; no new load effect; seeks go through the existing paths. |

---

## 10. Decisions needed before building

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | A song that is only on the phone is tapped while another device plays | (a) Ask, then play here if confirmed; (b) play here without asking (today); (c) refuse | **(a)**: nothing moves by accident, and nothing is impossible either |
| D2 | The active device is offline when the phone taps a song | (a) Play here with a notice; (b) ask first | **(a)**: the listener clearly wants music and the other device cannot answer |
| D3 | Headset, car and notification buttons before Phase 3.1 | (a) Keep acting on the phone's own player; (b) ignore them while another device is active | **(a)**: a press on this phone's own player is a choice to play here; Phase 3.1 changes it properly |
| D4 | Remote notification in the background | (a) Only while the app is open; (b) while the other device plays, stopping 10 minutes after it pauses; (c) never | **(b)**: closest to Spotify, bounded cost |
| D5 | Autoplay after a remote pick or transfer | (a) The playing device's own "Keep playing similar songs" setting; (b) always on; (c) never | **(a)** |
| D6 | Push to wake a closed phone app | Now / later | **Later**: Phases 1–3 fix what was reported and close most of the gap |
| D7 | Protocol 4 ("Playing from") in this round | Now / later | **Now, after Phases 1 and 2**: it is additive and the handshake makes it safe |

---

## 11. Files this plan touches

| File | Phase | Change |
|---|---|---|
| `packages/shared/artwork.ts` (new) + test | 2.1 | `shareableArtwork` |
| `packages/connect/src/types.ts`, `connectSession.ts` | 1.1, 1.2, 1.7, 3.1, 3.5 | Shared remote predicate, `ready`, `notice`, background listening while the remote plays, `controls` |
| `packages/connect/src/convexWire.ts`, `memoryTransport.ts` | 2.10, 3.3 | Development cover check; optional `context` |
| `apps/mobile/src/services/connect/playbackRoute.ts` (new) | 1.1 | `decidePlaybackRoute` |
| `apps/mobile/src/services/connect/playbackIntents.ts` (new) | 1.3 | The phone's one door for user playback |
| `apps/mobile/src/services/connect/ConnectProvider.tsx` | 1.3, 1.4, 2.4, 3.1 | Registers the session for intents; async router; tracker covers; remote notification feed |
| `apps/mobile/src/store/playerStore.ts` | 1.4 | Router contract: `true` means "the music is elsewhere" |
| `apps/mobile/src/components/connect/ConnectChoiceSheet.tsx` (new) | 1.5 | "Play on this phone?" |
| `apps/mobile/src/components/connect/ConnectMiniPlayer.tsx` | 1.6, 2.6 | Pending state, notice, resolved cover |
| `apps/mobile/src/components/connect/ConnectRemotePlayer.tsx` | 2.6, 3.3, 3.5, 3.7 | Resolved cover and palette, "Playing from", restrictions, drag to reorder |
| `apps/mobile/src/hooks/useVoiceCommands.ts`, `components/VoiceSearchCard.tsx`, `widget/useWidgetSync.ts` | 1.8 | Through `playback` |
| `apps/mobile/src/connectRouting.test.ts` (new) | 1.9 | Structural guard |
| `apps/mobile/src/services/connect/mobilePlayerPort.ts` | 2.4 | Shareable covers |
| `apps/mobile/src/services/connect/useSnapshotCover.ts` (new) | 2.6 | Fill missing covers |
| `apps/mobile/src/database/db.ts`, `queries.ts`, `src/types/song.ts` | 2.2 | `cover_remote_uri` |
| `apps/mobile/src/components/BackgroundDownloader.tsx` | 2.2 | Keep the catalog cover |
| `apps/mobile/src/services/sync/LibrarySync.ts`, `originBackfill.ts` (new) | 2.3 | Origin and cover lookups |
| `apps/mobile/src/services/stream/StreamService.ts` | 3.4 | Autoplay for Connect queues |
| `apps/mobile/android/.../playback/ConnectRemotePlayer.kt` (new), `PlaybackService.kt`, `MainPlayerModule.kt` | 3.1, 3.2 | Remote notification, lock screen, volume keys |
| `apps/web/src/hooks/useConnect.ts` (and an extracted `connectSnapshot.ts`) | 1.11, 2.5 | Notice; publish the shown cover |
| `apps/web/src/hooks/useSnapshotArtwork.ts` (new) | 2.7 | Fill missing covers |
| `apps/web/src/App.tsx` | 1.11, 2.7, 3.3, 3.4 | Shared predicate, resolved remote cover, context, autoplay after Connect loads |
| `apps/web/src/components/ConnectPicker.tsx` | 1.11, 3.5 | Notice, restrictions |
| `convex/connect.ts`, `convex/schema.ts` | 2.9, 3.3, 3.5 | Cover normalisation, `context`, `canPlay` enforcement |
| `docs/connect-contract.md`, `docs/architecture.md`, `apps/mobile/CLAUDE.md`, `HANDOFF.md`, `LEARNING-LOG.md` | 2.8, 5 | Documentation |

---

## 12. Sources

Read on 2026-10-04.

Spotify, official:

- Spotify Support, "Spotify Connect": <https://support.spotify.com/us/article/spotify-connect/>
- Spotify Support, "Start or join a Jam": <https://support.spotify.com/us/article/jam/>
- Spotify for Developers, Get Playback State (device fields, `context`, `timestamp`, `progress_ms`, `actions`):
  <https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback>
- Spotify for Developers, Start/Resume Playback (the active device is the default target):
  <https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback>
- Spotify for Developers, Transfer Playback (`device_ids`, `play`):
  <https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback>
- Spotify for Developers, Get Available Devices:
  <https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices>
- Spotify for Developers, Get the User's Queue: <https://developer.spotify.com/documentation/web-api/reference/get-queue>
- Spotify Engineering, "Spotify's Player API" (2022): <https://engineering.atspotify.com/2022/04/spotifys-player-api>

Spotify, community answers:

- Local files and Connect:
  <https://community.spotify.com/t5/Your-Library/Local-Files-can-t-be-played-via-Spotify-Connect-on-my-Sonos/td-p/5062728>
- The "Spotify Connect control" lock-screen setting:
  <https://community.spotify.com/t5/Android/How-do-I-stop-Android-from-detecting-I-m-using-Spotify-on/td-p/6491693>
- Changing a PC's volume from the phone:
  <https://community.spotify.com/t5/Android/Controlling-Spotify-Connect-s-volume-from-another-device-when/td-p/7328974>
- Device settings names (third-party guide): <https://www.slashgear.com/1374687/spotify-not-working-android-auto/>

Spotify's internal protocol, as implemented by librespot:

- `docs/dealer.md` (messages versus requests, queue uids, metadata):
  <https://github.com/librespot-org/librespot/blob/939dc5ee9d833e1980f9495241219d9d4868a061/docs/dealer.md>
- The command set (`core/src/dealer/protocol/request.rs`):
  <https://github.com/librespot-org/librespot/blob/dev/core/src/dealer/protocol/request.rs>
- A full device state write with track metadata and `spotify:image:` cover ids, in an issue log:
  <https://github.com/librespot-org/librespot/issues/977>

Android Media3, for Phase 3.1:

- Remote device volume handlers in `SimpleBasePlayer`: <https://github.com/androidx/media/issues/554>
- Remote `DeviceInfo` and how Media3 wires the session to a remote route: <https://github.com/androidx/media/issues/1056>
- `SimpleBasePlayer` state, `DeviceInfo` and when the notification appears: <https://github.com/google/exoplayer/issues/10471>

Allegra:

- [PLAN.md](./PLAN.md), [IMPROVEMENT-PLAN.md](./IMPROVEMENT-PLAN.md), [HANDOFF.md](./HANDOFF.md),
  [AUDIT-TRIAGE.md](./AUDIT-TRIAGE.md), [`docs/connect-contract.md`](../../docs/connect-contract.md),
  [`docs/api-contract.md`](../../docs/api-contract.md), [`docs/architecture.md`](../../docs/architecture.md),
  `apps/mobile/CLAUDE.md`.
