# Allegra fix backlog

| Baseline | Value |
| --- | --- |
| Audit date | 2026-11-11 (Asia/Calcutta) |
| HEAD | `9081dea8d35da50ea45b2b48e0ef236d4aaec917` |
| Branch | `fix/playback-skip-glitches` |
| Working tree | Dirty at capture. One tracked edit and eight pre-existing untracked paths. The scratch snapshot includes them. |
| Local `origin/main` comparison | 1 ahead, 0 behind. Local tracking ref `fe5df309`. |

Source citations refer to the captured checkout before the follow-up documentation refresh. Later Markdown edits can shift the live line numbers.

## Summary

Tickets describe the captured checkout. Deployment-dependent conditions are marked in each ticket.

| Severity | Count |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 10 |
| MEDIUM | 26 |
| LOW | 4 |

| Category | Count |
| --- | --- |
| Accessibility | 2 |
| Backend | 2 |
| CI/Release | 5 |
| DX | 1 |
| Data integrity | 5 |
| Desktop | 2 |
| Edge case | 1 |
| Frontend | 3 |
| Mobile | 1 |
| Performance | 2 |
| Security | 15 |
| UI/UX | 1 |

## Fix first

Priority weighs impact, preconditions, likelihood and effort.

1. **SEC-001** Redact the reusable Convex gateway secret in production request logs
2. **SEC-005** Update the Express parser and disable unneeded request inflation
3. **MOB-001** Keep pending playback history bound to the originating listener
4. **SEC-002** Bound OAuth client metadata reads through completion
5. **AND-001** The public APK build can fall back to a distributed debug signing key
6. **SEC-003** Reject direct Convex writes made with an erased user's still-live access token
7. **DESK-001** Desktop updater accepts an unsigned executable from the mutable release channel
8. **FE-001** Web global keyboard shortcuts bypass Connect
9. **FE-002** Failed guest merge is treated as finished and sign-out can discard its credential
10. **SEC-004** Require storage ownership before attaching or deleting a playlist cover

## Quick wins

Each narrow edit is estimated at under 30 minutes before verification.

- **SEC-001** Add missing gateway-header redaction.
- **SEC-005** Disable compressed-body parsing if all clients use plain JSON.
- **DX-001** Convert the pending queue test to imported Node assertions.

## CRITICAL

No finding met this threshold in the reviewed scope.

## HIGH

### [SEC-001] Redact the reusable Convex gateway secret in production request logs

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: yes)
- Category: Security
- Location: apps/api/src/config.ts:185; apps/api/src/app.ts:105-111; apps/api/src/lib/logger.ts:3-8; convex/spotifyCron.ts:36-49; apps/api/src/routes/spotify.ts:72-76; apps/api/src/db/convexGateway.ts:138-151
- Read first: §7; apps/api/src/lib/logger.ts; convex/spotifyCron.ts; convex/profiles.ts
- Evidence: Production enables pino-http and passes REDACTED_PATHS. This list covers authorization, cookie, x-api-key and set-cookie. The daily Spotify job uses x-convex-server-secret and the receiving route compares the reusable value. Default pino HTTP serializers include request headers. A local loopback fixture with fictional values showed ordinary authorization redacted and the gateway header preserved.
- Reproduction: 1. Run a local fixture using the production middleware options and a capture stream. 2. Send a fictional daily-job header. 3. Assert only the sentinel presence/absence and avoid printing the log payload.
- Impact: When daily sync runs, a reader of production HTTP logs can obtain a reusable server credential. Secret-gated listener functions accept the credential independently of listener JWTs. Preconditions are production request logging, a daily job execution and log access. CWE-532; HIGH under these preconditions. Production log contents are UNVERIFIED.
- Fix: Use an allowlisted request serializer (method, normalized route, request ID), without raw headers or URL query. Keep explicit redactions including x-convex-server-secret for any alternate request serializer. Coordinate secret rotation and existing log retention with the owner if exposure is confirmed.
- Do not: Do not merely redact Authorization. The scheduler uses a different header, and raw OAuth URLs can carry short-lived credentials.
- Side effects: API contract no; Convex schema/function no; shared sync no; mobile/desktop version no; cache bump no.
- Regression test: Add logger test capturing production request records, then assert no fake gateway, bearer, cookie or callback parameters appear.
- Verification: Run npm test in the root. Confirm sanitized scheduled request with fixture credentials in a controlled local test.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: [OWASP Logging Cheat Sheet, accessed 2026-11-11](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

### [SEC-005] Update the Express parser and disable unneeded request inflation

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: no, vendor advisory plus reachable code)
- Category: Security
- Location: package-lock.json:3342-3348,4390-4398; apps/api/src/app.ts:116-122
- Read first: §7, §12; apps/api/src/app.ts; upstream advisory
- Evidence: The installed body-parser is 2.3.0. Global JSON parsing and route-specific JSON parsing are installed before authorization and do not set inflate:false. The advisory covers default inflater handling and fixes 2.x in 2.4.0. Deployed proxy handling of compressed incoming bodies is UNVERIFIED.
- Reproduction: 1. Read the resolved dependency and parser options. 2. Add a benign encoded-JSON rejection test through createApp. 3. Confirm normal unencoded JSON requests still work.
- Impact: Upstream CVSS 7.5, network, no privileges, availability impact. If an ingress forwards compressed bodies, a malformed request can terminate the serving instance. No live availability claim.
- Fix: Resolve Express's body-parser to 2.4.0 or a later unaffected version and refresh the root lock. If the clients send plain request JSON, pass inflate:false to each exposed parser, including urlencoded if present. Preserve DJ and lyric limits.
- Do not: Do not treat the JSON byte ceiling as the fix. Do not bypass the normal Express parser or drop media/API tests.
- Side effects: API contract no for unencoded clients; Convex no; shared sync no; versions no; cache bump no.
- Regression test: Add mounted parser tests for encoded request rejection and representative normal requests on the default and larger limit routes.
- Verification: Run npm audit --package-lock-only and npm test. Confirm the installed resolution and the unauthenticated request handling locally.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: [Express body-parser advisory GHSA-27r3-jxmh-p828, accessed 2026-11-11](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828).

### [MOB-001] Keep pending playback history bound to the originating listener

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: yes, local service fixtures)
- Category: Data integrity
- Location: apps/mobile/src/database/db.ts:212-221; apps/mobile/src/database/syncQueries.ts:473-482; apps/mobile/src/services/sync/LibrarySync.ts:74-142,217-231,259-270,344-392; apps/mobile/src/services/account/AccountProvider.tsx:66-84
- Read first: §2, §4, §7; apps/mobile/CLAUDE.md; LibrarySync and SQLite migration code
- Evidence: The outbox rows do not have an account owner. Detach leaves pending play records. Attaching a new account schedules flush while its library choice is unresolved. The play loop still submits pending records using the new session and removes successful rows. Local fixture uses the actual service with a fictional offline A and newly attached B.
- Reproduction: 1. Queue an offline play for account A. 2. Detach A and attach B while keeping B's library decision unresolved. 3. Observe that B's fixture receives and clears A's record.
- Impact: Same-device account switching can send one listener's pending playback history to another account, affect taste and permanently lose the origin account's pending record.
- Fix: Add explicit account ownership to pending rows and filter each claim, retry and completion by it. Freeze the expected account and token generation per run, then invalidate pending work on account change. Define a safe migration for unowned legacy rows.
- Do not: Do not globally clear pending rows on every disconnect, and do not trust a mutable token ref during a flush owned by a previous account.
- Side effects: HTTP no; SQLite migration yes; Convex no; shared sync no; mobile version yes; desktop/cache no.
- Regression test: Use a LibrarySync test with two fake accounts and a pending A play. Verify B never sees it, A can retry it, and stale in-flight completion cannot delete B's rows.
- Verification: Run npm run mobile:check. Repeat on a test phone with offline recording and account switch when sign-in is authorized.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Repository source.

### [SEC-002] Bound OAuth client metadata reads through completion

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: yes, transport fixture)
- Category: Security
- Location: apps/api/src/oauth/router.ts:153-159; apps/api/src/oauth/clients.ts:19-20,105-136,160-162; apps/api/src/lib/fetchWithTimeout.ts:21-38
- Read first: §4, §7; apps/api/src/oauth/clients.ts; apps/api/src/lib/fetchWithTimeout.ts
- Evidence: The public authorization handler resolves the client before redirect validation. fetchMetadata rejects a large declared length, then calls response.text() and checks decoded bytes. fetchWithTimeout clears its timer as soon as headers arrive. DNS lookup occurs before that timeout. In a bounded injected-stream fixture, a body delivered after the deadline still completed with a live signal.
- Reproduction: 1. Use a fake fetch with immediate headers, no content length, and a delayed short JSON stream. 2. Observe completion after the configured fetch deadline. 3. Add a fake chunked response that crosses the metadata limit without allocating a large fixture.
- Impact: An unauthenticated requester can point at a public HTTPS endpoint they control. Slow or oversized responses retain memory and execution until completion or platform termination. Deployment-wide impact and ceilings are UNVERIFIED. CWE-400, network reachable without authentication.
- Fix: Start a shared deadline at metadata resolution. Bound DNS waiting, use one abort signal during fetch and read, cap actual decoded bytes while reading, and cancel on timeout, limit and early rejection. Return invalid_client through the current resolver behavior.
- Do not: Do not replace the current implementation with another unbounded text() read or apply a short full-response timeout to streamed audio.
- Side effects: API contract no; Convex no; shared sync no; versions no; cache bump no.
- Regression test: In oauth/clients.test.ts or an adjacent test, use injected DNS/fetch fixtures for absent/false length, delayed stream, oversized decoded bytes, redirect rejection and valid metadata.
- Verification: Run npm test. Confirm all rejected paths cancel the stream and return in bounded time.
- Effort: M (<1 day)
- Depends on / Blocks: Related SEC-006 address binding. Can land separately.
- Source: [MCP Authorization, accessed 2026-11-11](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

### [AND-001] The public APK build can fall back to a distributed debug signing key

- Severity: HIGH
- Certainty: LIKELY (reproduced: no). A local source-policy fixture reproduced the missing main-only guard. The public key distribution is confirmed. The published APK signer and release secret presence are unverified.
- Category: Security
- Location: .github/workflows/mobile-apk.yml:68-88, .github/workflows/mobile-apk.yml:228-248, apps/mobile/android/app/build.gradle:100-115, apps/mobile/android/app/src/main/java/com/lyricflow/app/workers/AppUpdateWorker.kt:49-58, apps/web/public/.well-known/assetlinks.json:1-10, docs/workflows.md:93-94.
- Read first: CODEBASE-KNOWLEDGE sections 7 and 11, Android signing and updater paths at Location.
- Evidence: The workflow uses the configured keystore if present. Otherwise it pulls the Expo SDK 54 bare template and copies its debug keystore. Android's release build selects the debug signing config. Main publication depends on the successful artifact, tests and launch probe. Those conditions do not assert a production signing identity. The app checks that an update matches the signer on the device. That is useful only when the first installed signer's key is private. Expo's SDK 54 source distributes the fallback keystore.
- Reproduction: Run a local workflow-policy test with a fictional empty signing-secret input and a synthetic main ref. Assert that the current signing branch proceeds into the fallback. Inspect only public certificate fingerprints with the Android SDK's APK verifier when an owner supplies the exact release artifact. No signing-key values are needed.
- Impact: High conditional supply-chain risk. If the public APK is built on the fallback, a known signing key cannot establish publisher identity. A same-package install signed with that identity can pass OS signer matching after a user accepts it. If previously installed devices use a private key, publishing the fallback instead denies them updates. The same signing mismatch can invalidate Android App Links. Attack preconditions are a fallback-signed install and an accepted replacement or compromised distribution path. Production signer exposure is unverified.
- Fix: Require a dedicated private release signer in the main publishing build, fail before assembling when unavailable, and verify the public expected signing certificate on the exact downloaded publication artifact before uploading it. Keep PR builds signed with an isolated debug identity. Verify the currently deployed signer before deciding how to migrate or retain installed clients. Update App Links and document migration if the signer changes.
- Do not: Switch certificates in the publish job without checking installed clients. Android enforces signing continuity. Do not disable the updater's signer validation to accommodate mismatched builds.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no. Release signing and potentially App Links change.
- Regression test: Add a workflow guard in tests/infra/infra-files.test.mjs proving the main path requires a configured signer and publishes only an artifact whose fingerprint was checked. Exercise missing/matching/wrong fingerprints against fictional test certificates.
- Verification: npm run infra:test. Inspect the exact public artifact certificate and verified link binding from an owner-approved release. Install over the prior owner-signed build on a disposable emulator or physical phone.
- Effort: M (<1 day) for the guard and artifact verification. Signer migration requires a separate owner decision.
- Depends on / Blocks: None. Any installed-signer migration depends on certificate verification.
- Source: [Android app signing](https://developer.android.com/studio/publish/app-signing) and [Expo SDK 54 template source](https://github.com/expo/expo/blob/sdk-54/templates/expo-template-bare-minimum/android/app/debug.keystore), accessed 2026-11-11.

### [SEC-003] Reject direct Convex writes made with an erased user's still-live access token

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Security
- Location: convex/account.ts:48-79,231-257,290-314; convex/connect.ts:202-206,640-679; convex/luvLink.ts:70-74,199-233; convex/library.ts:426-433; apps/api/src/auth/auth.ts:132-147; package-lock.json:3609-3611
- Read first: §4, §7; convex/_generated/ai/guidelines.md; convex/account.ts; convex/connect.ts; convex/luvLink.ts
- Evidence: Erase deletes auth records and existing listener rows. The pinned Convex Auth helper getAuthUserId returns the authenticated identity's subject prefix. The direct guards use that ID without checking the user/session row, and register/createRoom can insert fresh rows. Express has a separate existence check on account profile miss.
- Reproduction: 1. In convex-test create a listener and retain the original test identity. 2. Erase with the fixture server secret. 3. With the same fixture identity call register and createRoom. 4. A fixed implementation returns unauthenticated and creates no rows.
- Impact: A device retaining its own valid, pre-erasure token can write new server data before JWT expiry. This undermines erasure and may leave orphaned rooms/devices. No evidence of other-account data access. CWE-613, authenticated precondition.
- Fix: Implement a common account/session liveness check for direct listener functions. During erasure remove or fence the identity before scheduling paginated cleanup. Apply to actions through an internal auth query where needed. Retain ownership checks for already-existing rooms/devices.
- Do not: Do not require profiles to exist if fresh authenticated users can call before profile initialization. Do not gate only Express or refresh tokens.
- Side effects: HTTP API contract no; Convex functions yes, schema only if a tombstone is needed; shared sync no; mobile version only if generated bindings change; desktop no; cache bump no.
- Regression test: Extend convex/account.test.ts with existing and erased identities. Verify Connect register, LuvLink create/join, library revision and normal new-user boot.
- Verification: Run npm run convex:test alone. A development integration with an already-issued JWT would verify platform JWT behavior; local identity fixtures exercise app guards.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: [OWASP API2 Broken Authentication, accessed 2026-11-11](https://api-security.owasp.org/editions/2023/en/0xa2-broken-authentication/).

### [DESK-001] Desktop updater accepts an unsigned executable from the mutable release channel

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: no)
- Category: Security
- Location: `apps/desktop/src/update.rs:17-21,38-57,81-109`; `.github/workflows/desktop.yml:48-67,83-100`
- Read first: `apps/desktop/README.md:49-60`, updater source and knowledge §§7, 11
- Evidence: `update` reads `version.txt` and `allegra.exe` through separate requests to `desktop-latest`. Before swapping, `looks_like_app` requires 500,000 bytes and an `MZ` prefix. The workflow stages a Cargo-built EXE and version text. The updater verifies neither publisher nor an authenticated digest that binds the EXE to the checked version. The source explicitly acknowledges the trust decision.
- Reproduction: Trace both fetches in an offline fixture using canned manifests and dummy buffers. A reported greater version plus a sufficiently large MZ-prefixed buffer satisfies the current validation independently of its publisher or actual product. Live updates and arbitrary executable swaps were not attempted.
- Impact: If the release artifact or a release-publishing dependency is compromised, auto-update can install attacker-controlled bytes that execute with the listener's Windows privileges on the next launch. Interleaved legitimate release changes can also mismatch the reported version and payload. CVSS-style HIGH with a publishing or supply-chain precondition.
- Fix: Sign a versioned manifest with a separately protected key and bind version, channel, architecture, byte count and SHA-256 to immutable payload identity. Verify signature against an embedded trust root and stream-check length and digest before swap. If using Authenticode, require the expected publisher as well as a successful platform trust result. Build the migration so legacy installed copies can receive the trusted updater bootstrap.
- Do not: A checksum served as an unsigned sibling asset does not protect against replacement of both assets. A PE header or the presence of a signature alone does not establish trust.
- Side effects: API contract change: no. Convex/shared/cache: none. Desktop version bump: yes. Release manifest and signing configuration change; plan trust-root rotation.
- Regression test: In `apps/desktop/src/update.rs`, inject a byte source and assert a valid fixture is accepted, a wrong signer or digest is refused, and swapping never begins on mismatch. Add workflow tests for manifest/file agreement.
- Verification: `cargo test --locked` in `apps/desktop`, then run a non-production update from a local signed fixture and inspect the installed file after restart.
- Effort: L (>1 day)
- Depends on / Blocks: CI-001 coordinates pointer rollout; DESK-004 covers interrupted local replacement.
- Source: [Microsoft WinVerifyTrust](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust), accessed 2026-11-11.

### [FE-001] Web global keyboard shortcuts bypass Connect

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: yes, isolated actual callbacks with EventTarget; no live Connect session)
- Category: Frontend
- Location: apps/web/src/hooks/useAudioPlayer.ts:497–510; apps/web/src/App.tsx:254–297; apps/web/src/App.tsx:761–779; apps/web/src/hooks/useConnect.ts:338–359; packages/connect/src/connectSession.ts:416–424; packages/connect/src/connectSession.ts:700–729
- Read first: Knowledge §2 Web playback and Connect, §9 keyboard; docs/connect-contract.md:79; CLAUDE.md:77
- Evidence: The player hook adds `if (event.code === 'Space') { event.preventDefault(); void requestPlayback(!isPlayingRef.current); }`; the later App listener immediately returns for `event.defaultPrevented`. Right/Left in the older listener do not mark the event handled and directly call local `seek`, then the App listener calls `seekPlayer` on the shown device. The Connect session normally restores the remote owner's song paused into the local element, making the local transport call actionable, and a local play event attempts an ownership claim.
- Reproduction: Use a signed-in web controller while another online device owns playback. Leave focus on the page body and press Space, then Right. The scratch harness registered both actual extracted effects against EventTarget and observed `local-play(true)` alone for Space and both `local-seek(35)` and `remote-seek(36)` for Right with distinct local/remote playheads.
- Impact: The shortcut intended to pause the playing device starts local audio or competes for ownership. Arrow keys may change both players' positions. The older handler also ignores modifier keys and can consume Space on a link or on an unloaded page.
- Fix: Remove the older keydown effect from `useAudioPlayer`. Keep the App-level event handler, element target guard, and Connect-aware `togglePlayer` and `seekPlayer`. Consider stable dependencies when editing that effect.
- Do not: Do not add a second handler per device or let a component call the raw audio element. Keep one keyboard handler and the existing local play/pause funnel.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Extend `tests/e2e/connect.spec.ts` to assert that a controller Space pauses the owner without calling local play and Right moves only the remote playhead. Include Space on a focused button and modified arrows. A fake-port unit or browser mock can prove routing without live sign-in.
- Verification: Run root checks and the local mock regression, then verify two authenticated dev tabs and an Android owner with consented credentials when available.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: Source trace and isolated regression harness, 2026-11-11.

### [FE-002] Failed guest merge is treated as finished and sign-out can discard its credential

- Severity: HIGH
- Certainty: CONFIRMED (reproduced: yes, actual client functions with isolated request and storage fakes; no Google sign-in)
- Category: Data integrity
- Location: apps/web/app/ConvexSignInProvider.tsx:57–72; apps/web/src/lib/api.ts:717–748; apps/web/src/components/AuthDialog.tsx:120–125; apps/web/src/hooks/useAccount.ts:118–121; apps/api/src/routes/auth.ts:48–71
- Read first: Knowledge §2 guest and sign-in, §7 tokens; docs/architecture.md:106
- Evidence: The effect calls `setLinked(true)` before POST `/api/auth/link`. `linkGuestSession` returns `null` both without a guest token and after a failed request. The provider dispatches `allegra:account` and leaves its completion flag set. The sign-out button calls `account.startGuest()`, which removes the token and replaces it. The server merge only runs if it received the authenticated request and resolved the old token to a guest.
- Reproduction: Create a guest with saved tracks. Simulate a failed request before POST `/api/auth/link` reaches Express on the OAuth return. Restore the connection with the page still open. The scratch harness observed one failed POST, no retry on the next effect pass, and replacement of the original stored token by `startGuestSession()`.
- Impact: The account appears signed in but its guest likes and playlists are absent. Reload can recover while the old token survives. Signing out first can make that guest data unreachable to the listener even while its backend records still exist.
- Fix: Distinguish absent, merged and retryable failed results. Keep the old credential pending until acknowledged and bind an in-flight attempt to the current auth account and captured guest token. Retry with capped backoff or an explicit retry action. Preserve the pending credential across ordinary sign-out safely, with explicit account matching before sending it again.
- Do not: Do not reset the boolean on every failure and spin requests. Do not merge an unfinished credential automatically into a different account or reveal it in logs.
- Side effects: API contract change: no for transient failures. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Add a failure-then-success client regression in `apps/web/src/lib/guestLink.test.ts` using a mocked POST and storage. Check idempotent response-loss retry, sign-out before recovery, and an account change while the old POST is pending.
- Verification: Run root checks and local stub regression. Use a development account and controlled request failure to verify UI recovery when a login run is authorized.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Source trace and isolated regression harness, 2026-11-11.

### [SEC-004] Require storage ownership before attaching or deleting a playlist cover

- Severity: HIGH
- Certainty: LIKELY (reproduced: no; cross-account storage-key availability unverified)
- Category: Security
- Location: apps/api/src/routes/user.ts:52-93; convex/covers.ts:13-40; apps/api/src/user/actions.ts:390-399; packages/shared/library.ts:201-229,380-395; convex/account.ts:90-95
- Read first: §4, §7; convex/covers.ts; apps/api/src/routes/user.ts; packages/shared/library.ts
- Evidence: The API proves that the target playlist belongs to the caller. It accepts a caller-selected storage ID after type and size checks. Convex inspects and removes by shared secret plus ID. Library replacement/deletion emits removedCoverKeys and ListenerActions deletes by global key. Public shared covers may show a URL, but exposure of the underlying key to a different account is UNVERIFIED.
- Reproduction: 1. Seed two local accounts and a cover associated with A. 2. Give the fixture its known storage key explicitly. 3. Have B attach it to B's playlist and clear or delete that playlist. 4. Assert A still has its cover and B's attach is rejected.
- Impact: A listener who learns another listener's storage key can remove a victim's cover. Invalid foreign objects can reach the direct delete branch. This requires a known key, and the ticket does not assert that ordinary shared-playlist output reveals it. CWE-639.
- Fix: Create short-lived upload/claim records bound to uploader and storage ID. Claim atomically with the authorized playlist edit and release only the owned attachment. Authorize any cleanup and keep duplicate-file semantics explicit. Migrate existing references before enabling deletion.
- Do not: Do not assume a valid opaque ID proves ownership. Do not delete invalid media until the upload claim is verified.
- Side effects: HTTP API change possible if upload receipt becomes explicit; Convex schema/functions yes; shared sync only if public ops change; mobile bump if affected; desktop no; cache bump no.
- Regression test: Add Convex and mounted route tests for foreign, unknown, abandoned and duplicate keys, then clear/replace/erase with a valid owned key.
- Verification: Run npm test and npm run convex:test sequentially relative to mobile check. Verify the caller never removes another account's file.
- Effort: L (>1 day)
- Depends on / Blocks: None
- Source: [OWASP API1 Broken Object Level Authorization, accessed 2026-11-11](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/).

## MEDIUM

### [A11Y-001] Account modal leaves focus behind the dialog

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace of modal lifecycle and opener)
- Category: Accessibility
- Location: apps/web/src/App.tsx:1896–1914; apps/web/src/components/AuthDialog.tsx:66–87; apps/web/src/components/AuthDialog.tsx:135–151; apps/web/src/lib/scrollLock.ts:9–24; apps/web/src/components/LyricsSyncDialog.tsx:65–70; apps/web/src/components/LyricsSyncDialog.tsx:128–136
- Read first: Knowledge §9 accessibility, W3C modal dialog pattern
- Evidence: The header button opens `AuthDialog`. Its portalled panel advertises `aria-modal=true`, but the open effects reset local state, listen for Escape and lock body scrolling. No effect moves focus in, makes the background inert, cycles Tab or restores focus. `lockScroll` changes overflow only.
- Reproduction: Tab to the header account button and press Enter. Press Tab and Shift+Tab and watch `document.activeElement`. Close with Escape. Focus is permitted to stay in or move through the background before reaching the portalled controls.
- Impact: Keyboard and assistive-technology users can lose their place and encounter controls behind a visually modal sign-in or account panel.
- Fix: Set initial focus inside the panel, contain Tab while open and restore focus to the opener on close. Use `LyricsSyncDialog`'s focus lifecycle as a local example and verify that dynamic sign-in/profile views still leave a focusable element in the panel.
- Do not: Do not replace the native form controls with click-only elements or add `aria-modal` as the sole containment mechanism.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Add an account-dialog keyboard test to `tests/e2e/app.spec.ts` asserting initial focus, containment in both directions, and restoration on close.
- Verification: Verify at mobile and desktop widths with keyboard and screen reader, including a dialog opened from the library and an opener that unmounts.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: [W3C WAI-ARIA APG, Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), accessed 2026-11-11.

### [AND-002] Failed and staged APK downloads bypass the selected build check

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: yes). The retry predicate was executed locally with fictional inputs. Staged installation is traced from source.
- Category: Data integrity
- Location: apps/mobile/src/components/about/UpdatePanel.tsx:104-115, apps/mobile/src/components/about/UpdatePanel.tsx:149-188, apps/mobile/src/services/appUpdate.ts:64-74, apps/mobile/src/services/appUpdate.ts:130-145, apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/AppUpdaterModule.kt:18-45, apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/AppUpdaterModule.kt:53-65, apps/mobile/android/app/src/main/java/com/lyricflow/app/workers/AppUpdateWorker.kt:18-25, apps/mobile/android/app/src/main/java/com/lyricflow/app/workers/AppUpdateWorker.kt:49-59, apps/mobile/android/app/build.gradle:91-96.
- Read first: CODEBASE-KNOWLEDGE sections 4 and 11, mobile update decision and Android worker.
- Evidence: UpdatePanel computes canDownload from a failed native job or a newer release. A failure therefore enables Update even when standingOf reports older/current or a fresh check fails. Download can also fall back to the moving latest URL. Native work receives only the URL and keeps a single ready filename. The ready action takes precedence over current release metadata. Worker and installer check package/signature and file presence, respectively, with no selected-release identity. All current builds use versionCode 1, so equal-versionCode files bypass the OS's lower-code comparison.
- Reproduction: 1. In a component fixture, return a native error from a prior download. 2. Return an older release from checkNow. 3. Observe that Update is still offered and calls downloadUpdate with the older release URL. 4. In another fixture stage build B, advance the channel to C, and reopen the panel. Observe that Install still targets the single staged file without a build label.
- Impact: A listener can be offered an older or already-installed APK after a failed update, or install a stale staged APK after the channel changes. If accepted and signed compatibly, a downgrade can reintroduce fixed defects or mismatch a newer local schema. Preconditions include persistent native work state and a changing release channel or a separately installed build.
- Fix: Require an eligible latest-build identity for download and retry. Store that identity and a digest from trusted release metadata with work and the final file, and return it in native status. Revalidate eligibility and file identity before exposing the installer. Introduce a migration-compatible monotonic versionCode for public releases after confirming the release/version policy.
- Do not: Relabel the staged file with the latest release title, use mutable tag URL as immutable identity, or drop Android signer verification.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no. Native status payload and APK version policy change.
- Regression test: Extend apps/mobile/src/services/appUpdate.test.ts and add a fixture test for UpdatePanel covering failed job with older/current/unknown release and staged identity mismatch. Add worker instrumentation rejecting a mismatched APK even when its signer matches.
- Verification: npm run mobile:check. Install two or three synthetic, same-signer builds on a disposable emulator to check WorkManager, the ready panel and the OS installer path.
- Effort: M (<1 day).
- Depends on / Blocks: None. Coordinate release/version policy with AND-001.
- Source: [Android versionCode downgrade behavior](https://developer.android.com/studio/publish/versioning), accessed 2026-11-11.

### [AND-003] Android native playback can restart its exhausted retry budget on the same network

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no).
- Category: Mobile
- Location: apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:29-34, apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:126-148, apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:181-225, apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/ResumeOnline.kt:12-24, apps/mobile/src/playback/recovery.ts:33-52, apps/mobile/android/app/src/test/java/com/lyricflow/app/playback/ResumeOnlineTest.kt:7-31.
- Read first: CODEBASE-KNOWLEDGE sections 2 and 8, Android player and network recovery.
- Evidence: After four native retries, PlaybackService pauses and arms a new default-network callback. Android delivers the current default network immediately when that callback is registered. The code posts resumeIfOnlineAgain for every onAvailable. ResumeOnline only checks time, current item presence and whether playWhenReady is already true. resumeIfOnlineAgain unregisters the callback, resets retries to zero, prepares and plays. The next exhausted transport-error cycle can repeat on the same network. The JS auto-resume counter caps its own work only.
- Reproduction: On an emulator with a default network still present, stream a local fixture that accepts connections but repeatedly terminates audio reads without reaching player READY. Leave the app backgrounded. Observe four retries, then the initial network callback restarting playback and resetting the counter. Repeat with an actual offline-to-online transition to confirm the recovery that should remain.
- Impact: An unresponsive media origin can keep a background native player alternating between retry and paused states, making extra requests and consuming battery until the origin works or the user changes tracks. The observed source behavior requires repeated transport failures, not an HTTP status classified as an expired URL. No duration or battery measurement was taken.
- Fix: Arm recovery only after observed loss of usable connectivity. Store network identity/validation state and the current play intent/item with the recovery episode. Require a real usable-network transition and consume at most one native resume allowance per episode. Clear it on explicit stop or pause, track replacement, service teardown and timeout. Preserve four bounded retries and JS expired-link recovery.
- Do not: Use callback registration as a connectivity transition or globally turn off recovery in tunnels.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no.
- Regression test: Extend apps/mobile/android/app/src/test/java/com/lyricflow/app/playback/ResumeOnlineTest.kt with current-network-at-registration, unavailable-to-validated, intent change and repeated failure cases. Test actual service listener behavior with an injected clock, connectivity adapter and media failure fixture.
- Verification: Android JVM gate in .github/workflows/mobile-ci.yml:99-105, then a local emulator fixture and physical device with airplane-mode handoff.
- Effort: M (<1 day).
- Depends on / Blocks: None.
- Source: [Android default network callback](https://developer.android.com/about/versions/11/features/5g#register-a-network-callback), accessed 2026-11-11. Earlier outage-resume work and pending device checks in .planning/mobile-ui-review/VERIFICATION-MATRIX.md:107.

### [AND-004] A cleared Android queue can be restored from disk

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no).
- Category: Data integrity
- Location: apps/mobile/src/store/songsStore.ts:196-232, apps/mobile/src/store/playerStore.ts:297-315, apps/mobile/src/store/playerStore.ts:589-595, apps/mobile/src/store/playerStore.ts:869-883, apps/mobile/src/App.tsx:143-153, apps/mobile/src/services/NativeAudioPlayer.ts:209-212, apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/MainPlayerModule.kt:336-344, apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/MainPlayerModule.kt:379-388, apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueEngine.kt:41-42, apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueEngine.kt:219-235, apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueEngine.kt:399-467.
- Read first: CODEBASE-KNOWLEDGE sections 2 and 8, Android playback ownership and queue persistence.
- Evidence: Hiding or deleting the current local song resets the store and requests native clear. With no active engine the bridge returns false before removing the disk file. With a live engine clear deletes the file on the player thread, while an older snapshot already queued to the worker can later rename itself over the deleted path. Removing the final item through the separate queue-removal path leaves no new snapshot because saveNow returns for zero items. Startup sees the old file and restore decodes it. The JS queue mirror can construct a song from the restored native item's metadata without checking whether it remains in the library.
- Reproduction: 1. Seed a native queue with a local song and wait for its disk snapshot. 2. Stop the service while the screen retains that song, hide/delete the song, then relaunch. 3. Verify the stale song in restored Up next/mini-player. For the live-engine race, park a fake writer after serialization, call clear, release the writer, recreate the service and restore.
- Impact: A track the listener hid or deleted can reappear in the Android queue and player. A removed local file can become an unplayable stale item. The app can appear cleared until restart.
- Fix: Route snapshot writes and a clear/tombstone through one serialized persistence owner. Make clear successful with no service by clearing through that owner, and clear on the empty transition after removeById. Prevent pending older writes from resurrecting a tombstoned generation and recheck whether a cached restored local ref still exists in the library before exposing it.
- Do not: Add a delay before unlink, perform another independent delete on the JS side or start a second Android player to clear state.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no. Preserve compatibility with previous snapshot format if storing a tombstone.
- Regression test: Add a native queue-persistence JVM test with a controllable executor and temp directory. Assert that enqueued save then clear, clear with no engine and removal of the last item all remain empty after recreation. Cover hide/delete of a currently selected local song in apps/mobile/src/store/playerStore.native.test.ts.
- Verification: npm run mobile:check. Run the Android JVM gate and exercise clear/hide across service destruction and cold launch.
- Effort: M (<1 day).
- Depends on / Blocks: None.
- Source: Repository source at Location. Related persistence tests are apps/mobile/android/app/src/test/java/com/lyricflow/app/playback/QueueSnapshotTest.kt and apps/mobile/src/store/playerStore.native.test.ts:499-505.

### [AND-005] The Android media session exposes unrestricted controller commands

- Severity: MEDIUM
- Certainty: LIKELY (reproduced: no). Default Media3 policy is confirmed in official documentation. Which external caller categories connect on supported Android versions requires a local device test.
- Category: Security
- Location: apps/mobile/android/app/src/main/AndroidManifest.xml:69-78, apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:289-311, apps/mobile/android/app/src/main/java/com/lyricflow/app/services/QueueForwardingPlayer.kt:12-34.
- Read first: CODEBASE-KNOWLEDGE sections 2 and 7, Android media session trust boundary.
- Evidence: PlaybackService is exported. onGetSession always returns the session, which is built without an explicit controller callback. Media3 documents the default as accepting controllers and incoming commands. QueueForwardingPlayer delegates the underlying player's command set and adds skip operations, with no caller-specific filter. This differs from the JS bridge's queue-tag guard.
- Reproduction: In a disposable emulator with a fixture queue, connect a benign test controller from a separate test package. Inspect the available command set. Verify play/pause, metadata visibility and playlist editing permissions separately. Use synthetic track data and no external account.
- Impact: Local controller apps can potentially access media state or change playback/queue outside the app's intended controls. Local app presence and platform controller access are preconditions. No remote account takeover or private file access is established.
- Fix: Keep the service available to the system and add a MediaSession callback that limits command sets by controller role/trust. Preserve notification, lock screen, headset and supported Auto/Wear transport actions. Restrict raw playlist mutation for outside controllers unless a product requirement authorizes it. Reject unsupported media sources through the session callback.
- Do not: Make PlaybackService non-exported indiscriminately or remove lock screen and hardware transport commands.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no.
- Regression test: Add an Android instrumentation test for same-package and external-controller command allowlists. Assert trusted transport and queue operations are distinct and that queue edits are rejected for an untrusted controller.
- Verification: Exercise notification, headset and Auto/Wear if supported, plus a separate-package test controller on a disposable emulator.
- Effort: M (<1 day).
- Depends on / Blocks: Confirm which external controller types the product supports.
- Source: [MediaSession.Callback default behavior](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback), accessed 2026-11-11.

### [AND-006] The native Up next list lays out every row on the UI thread

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no).
- Category: Performance
- Location: apps/mobile/src/components/player/UpNextPanel.tsx:185-201, apps/mobile/src/components/player/UpNextPanel.tsx:316-326, apps/mobile/src/components/player/UpNextPanel.tsx:359-374, apps/mobile/src/components/player/nativeQueuePayload.ts:39-64, apps/mobile/src/playback/nativeQueue.ts:22-23, apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/NativeQueueListModule.kt:12-24, apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeQueueListView.kt:148-161, apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeQueueListView.kt:195-203, apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeQueueListView.kt:485-499.
- Read first: CODEBASE-KNOWLEDGE sections 8 and 9, native queue renderer and Expo prop commit.
- Evidence: UpNextPanel sends JSON for every shown row. On a changed payload, NativeQueueListView.commit parses the full JSON, rebuilds cover retention and creates two full text arrays using ellipsize on the View thread. Drawing itself clips and iterates only the visible row window. Therefore a 1,500-row change can perform 3,000 text-ellipsize calls before drawing, regardless of the visible count. The count is from source, with no frame or CPU measurement.
- Reproduction: Populate a synthetic 1,500-item queue, open Up next, toggle filters or reorder a row while capturing Android frame timing. Compare against the same device and artwork state on a short queue.
- Impact: Large queue updates can delay the next frame and visible feedback for queue reorders on slow devices. No claim is made about measured frame loss.
- Fix: Retain full row order and IDs for queue semantics. Compute/cache ellipsized labels per visible row and width/font/movable configuration, or move stable parsing and preparation off the UI thread with a generation guard. Invalidate cache on size/text changes and keep the current row, filtered indexes and drag interactions intact.
- Do not: Remove offscreen tracks from the real playback queue or fetch artwork for every row to hide delayed labels.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no.
- Regression test: Add native performance instrumentation counting text-layout calls for a large synthetic queue and compare against viewport size. Keep nativeQueuePayload.test.ts filter-index coverage and queue geometry cases.
- Verification: Profile the large queue on the same low-end phone before and after. Record changed-prop time, visible frame timing and large-text reflow.
- Effort: M (<1 day).
- Depends on / Blocks: None.
- Source: Repository source at Location.

### [AND-008] The APK workflow supplies a provider bearer credential to a public Expo bundle input

- Severity: MEDIUM
- Certainty: LIKELY (reproduced: no). Build and source wiring confirmed. Whether the secret is configured and present in a published bundle is unverified.
- Category: Security
- Location: .github/workflows/mobile-apk.yml:90-106, apps/mobile/src/services/GeniusService.ts:9-41, apps/mobile/src/screens/LyricsEditorScreen.tsx:38, apps/mobile/src/screens/LyricsEditorScreen.tsx:180-184.
- Read first: CODEBASE-KNOWLEDGE sections 7 and 11, provider and mobile release boundaries.
- Evidence: The release job exports EXPO_PUBLIC_GENIUS_ACCESS_TOKEN from a CI secret and GeniusService reads it with direct property access. Expo defines EXPO_PUBLIC_* as inlined public application inputs. LyricsEditorScreen imports the module for its scraper and converter. Source search found no production caller of searchGenius, the method that needs the token. Whether the final compiler retains the bearer input and whether the production secret is nonempty remain unverified.
- Reproduction: In an isolated release fixture, substitute a harmless unique marker and check whether it appears in the compiled bundle. Do not inspect real environment values or copy a real token into the test.
- Impact: If the release credential is configured and bundled, anyone with an APK copy can obtain a provider bearer token. Potential impact depends on the token's actual permissions, with provider quota and account attribution as preconditions.
- Fix: Remove the unused mobile searchGenius path and CI secret wiring after verifying callers, retaining the public lyrics-page scraper/converter if needed. If future features require bearer-authenticated search, keep it behind the API with a server-side secret and rate bounds.
- Do not: Treat obfuscation, a CI secret source or a renamed EXPO_PUBLIC variable as protection for a bearer token on a user device.
- Side effects: API contract change no for removing unused wiring. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no.
- Regression test: Extend the existing mobile secret-check gate to reject non-public provider credentials in release variables, then assert the marker is absent from a controlled release bundle.
- Verification: npm run mobile:check. Review any prior release using a marker or public evidence only. If real exposure is confirmed by the owner, rotate through the provider's process.
- Effort: S (<1h).
- Depends on / Blocks: None.
- Source: [Expo environment variable inlining](https://docs.expo.dev/guides/environment-variables/), accessed 2026-11-11.

### [BE-001] Preserve case-sensitive catalog IDs in the stream cache key

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Backend
- Location: apps/api/src/lib/streamResolver.ts:118-137; apps/api/src/lib/cache.ts:77-81; apps/api/src/services/lyrics.ts:255-256
- Read first: §2, §5, §8; apps/api/src/lib/streamResolver.ts
- Evidence: resolve uses cacheKey('stream', songId), and cacheKey lowercases all parts. The lyrics service calls out case-sensitive catalog IDs. The cached URL short-circuits provider resolution on a colliding ref.
- Reproduction: 1. In a fake provider create two case-distinct IDs with distinct assets. 2. Resolve first then second with a shared warm cache. 3. Confirm the second gets its own upstream URL.
- Impact: A pair of case-distinct catalog IDs sharing a warm cache entry can produce wrong audio with the right title. Actual provider collisions were not enumerated.
- Fix: Use a versioned stream key with an opaque, case-preserving provider-qualified ID. Canonicalize only provider aliases intentionally; reuse the existing resolver and refresh logic.
- Do not: Do not change case normalization globally because search and text caches rely on it.
- Side effects: API no; Convex no; shared sync no; versions no; stream cache-key bump yes.
- Regression test: Add a StreamResolver cache test for case distinctions and a Range retry using the same ref.
- Verification: Run npm test. Verify both fake audio responses and 206 preservation.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: Repository source.

### [CI-001] Replacing the latest release deletes the previous download before the new one is ready

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no)
- Category: CI/Release
- Location: `.github/workflows/desktop.yml:27-29,83-100`; `.github/workflows/mobile-apk.yml:33-35,255-277`; `.github/workflows/mobile-smoke.yml:122-137`; `apps/desktop/src/update.rs:17,38-44`; `apps/mobile/src/services/appUpdate.ts:6-24`
- Read first: Release workflows, app update clients, and knowledge §11
- Evidence: Both production jobs delete the mutable release (including its tag) and only then run create/upload. Delete failure is swallowed. Workflow-level concurrency can cancel a job during that gap. `smoke-latest` has the same ordering for diagnostics, with lower impact.
- Reproduction: Walk the two-command publish sequence against a fake release adapter that fails or cancels after delete. The old stable path is gone and the new release was not installed. No release command ran during audit.
- Impact: An upload/network failure or a superseded job can leave an installer download unavailable and existing clients unable to discover updates until another publish succeeds.
- Fix: Publish immutable versioned releases and validate all staged assets before moving a stable channel pointer. Keep previous verified artifacts and serialize promotion separately from cancellable builds. Preserve existing updater URLs through a migration period, and retain a recovery route to the prior version.
- Do not: Do not just remove the ignored error or use upload with clobber on the sole public asset. Neither provides an intact old release throughout a failure.
- Side effects: HTTP API contract change: no. Update discovery/release contract change: yes. Convex/shared/cache: none. Desktop/mobile version bumps if clients change.
- Regression test: Add a fake publisher regression under `tests/infra` proving failure, cancellation and an older run cannot remove the last good channel pointer.
- Verification: `npm run infra:test`; verify with isolated release fixtures and existing-client compatibility checks.
- Effort: L (>1 day)
- Depends on / Blocks: Coordinates DESK-001 manifest/channel design.
- Source: Repo-only; no previous planning finding identified.

### [CI-002] Release and build workflows load Actions through mutable tags

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no)
- Category: CI/Release
- Location: `.github/workflows/ci.yml:21-26`; `.github/workflows/desktop.yml:42-46,63-81`; `.github/workflows/mobile-apk.yml:50-66,114-118,162-178,206-225,239-250`; `.github/workflows/mobile-ci.yml:39-66,79-108`; `.github/workflows/mobile-smoke.yml:28-29,45-62,87-116`
- Read first: All five root workflow files and knowledge §§7, 11
- Evidence: Examples are `actions/download-artifact@v4`, `Swatinem/rust-cache@v2`, `gradle/actions/setup-gradle@v4` and `reactivecircus/android-emulator-runner@v2`. The app build jobs produce binaries and separate publish jobs consume those binaries. Publish jobs run Action steps with contents write. The smoke job grants contents write to every step.
- Reproduction: Review every `uses:` reference in the workflow snapshot. Mutable Action tags are confirmed. Repository/org enforcement outside checked-in source was unavailable.
- Impact: A moved or compromised upstream tag can execute different code with the invoking job's token and filesystem privileges. Artifact-producing jobs remain sensitive with read-only repository scope. CVSS-style MEDIUM conditional supply-chain exposure.
- Fix: Replace mutable remote Action refs with verified full commit SHAs from their own repositories and record the intended human-readable versions beside them. Split smoke publishing into a gated job with contents write and keep build/emulator steps read-only. Add an automated pin check with reviewed dependency-update workflow.
- Do not: Do not pin a SHA from an untrusted fork or assume contents read prevents artifact poisoning.
- Side effects: API contract change: no. Convex/shared/cache: none. No app version bump for CI-only pin updates unless the selected workflow path publishes a new app artifact.
- Regression test: Add a `tests/infra` check that rejects remote `uses:` refs without an approved full SHA and confirms publish-only write permissions.
- Verification: `npm run infra:test`; check each pinned workflow on a PR, no release publication required.
- Effort: M (<1 day)
- Depends on / Blocks: None.
- Source: [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions), accessed 2026-11-11.

### [CI-003] The release player gate can pass without opening Now Playing

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no)
- Category: CI/Release
- Location: `.github/scripts/mobile-launch-check.sh:148-175`; `.github/workflows/mobile-apk.yml:152-156,206-218,228-232`
- Read first: Launch gate, APK workflow and knowledge §§10, 11
- Evidence: The player leg issues a live catalog query and a lyrics deep link, then captures screenshots. Its passing branch checks only app PID, crash buffer and lost React diagnostics. Source comments already say nothing plays without a network. The reported success claims cover and lyric rendering even when the fixture did not reach those views.
- Reproduction: Run the launch gate in an isolated emulator with catalog network unavailable. Ensure the shell boots and PID stays alive. Observe that the player step has no condition proving a playable item, open player or active lyrics.
- Impact: Now Playing regressions can pass the release job if the catalog request fails silently. The launch, settings and restart legs still provide useful coverage.
- Fix: Seed a small deterministic playable local track and timed lyrics into the release-test build or an isolated fixture backend. Assert correct track loaded, cover surfaced and lyrics opened before starting each dwell. Distinguish missing fixture from app failure and require successful exercise for the release gate.
- Do not: Do not treat screenshots, a live PID or a `sleep` as proof that motion or playback ran.
- Side effects: API contract change: no. Convex/shared/cache: none. Android version bump follows existing workflow rules if production code changes.
- Regression test: Add a fake-ADB assertion test for present and missing cover/lyrics fixture evidence. In the emulator gate, intentionally prevent track readiness once and require failure.
- Verification: `npm run infra:test` for the assertion seam and isolated emulator launch-check run on the updated fixture.
- Effort: M (<1 day)
- Depends on / Blocks: None.
- Source: Previously documented gap in `.github/scripts/mobile-launch-check.sh:148-152`; still present.

### [CI-004] Desktop publishing does not enforce the required version increase

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no)
- Category: CI/Release
- Location: `.github/workflows/desktop.yml:54-67,83-100`; `apps/desktop/src/update.rs:38-42,59-75,124-128`; `apps/desktop/README.md:49-60`; `CLAUDE.md:178-183`
- Read first: Desktop version rule, workflow and knowledge §11
- Evidence: The workflow validates only that the staged version string is present. It can replace `desktop-latest` with a changed executable that has the same or older version. `is_newer` intentionally refuses that version on existing copies.
- Reproduction: Given a previously published `0.3.0` and a code-only desktop change whose staged version remains `0.3.0`, trace staging and publish guards. The release job reaches publication while installed `0.3.0` clients refuse the version.
- Impact: New manual downloads get the new EXE while installed users silently remain on the prior one, including users who need the fix.
- Fix: Validate monotonic version during PR checks and repeat it against the previous published version immediately before promotion. Treat exact same-version/same-artifact reruns as no-ops, and reject different same-version bytes. Use a higher version for a rollback build intended to reach installed copies.
- Do not: Do not relax the client version gate to accept lower or unrelated same-version bytes.
- Side effects: API contract change: no. Convex/shared/cache: none. Desktop version bump for the next shell release.
- Regression test: Add `tests/infra` fixtures for greater, same-version-identical, same-version-different, older and malformed version inputs.
- Verification: `npm run infra:test`; verify dry-run staging against canned latest-release metadata.
- Effort: S (<1h)
- Depends on / Blocks: Coordinate with CI-001 channel promotion.
- Source: Previously documented version rule in `apps/desktop/README.md:58-60`; the workflow gate remains missing.

### [DESK-002] Off-origin WebView pages can write native playback and jump-list state

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no)
- Category: Security
- Location: `apps/desktop/src/main.rs:267-280,431-465,504-508,530-544`; `apps/desktop/src/bridge.js:6-9,96-116`; `apps/desktop/src/link.rs:74-77,87-104`
- Read first: `apps/desktop/src/main.rs:172-189,324-365,431-465`, knowledge §§2, 7
- Evidence: The main Wry view handles new-window requests but has no main navigation predicate. Its IPC callback forwards only `req.body()` to the UI event loop. Wry 0.53.5 on Windows supplies the source URI from WebView2. `on_page` accepts `now`, `visit` and `ready` based on JSON command names. `now` fans out to taskbar, mini and Notch. `visit` persists a cleaned path with page-supplied text. Top-frame check in `bridge.js` is not a sender-origin check.
- Reproduction: Use an isolated debug build with two local fixture origins. Navigate the WebView to the second origin in the same window and send a harmless fixture `now` or `visit`. Source trace only. No existing public page or navigation was used to induce the condition.
- Impact: A same-window navigation to attacker-controlled content lets that document spoof OS playback state and persist misleading recent playlist labels. The traced handlers do not expose arbitrary file writes or command execution. CVSS-style MEDIUM, requiring that navigation or another untrusted sender enter the WebView.
- Fix: Parse the configured app origin once and enforce it on incoming main IPC source URIs. Constrain main-window navigation and open approved external HTTPS targets outside the bridged view, preserving supported OAuth flows through explicit unprivileged navigation/return behavior. Reset `page_ready` when a privileged document is replaced. Add command-specific shape and size validation before enqueuing.
- Do not: Do not use string prefix comparisons or a JavaScript-only location guard. These do not establish the native message sender's origin.
- Side effects: API contract change: no. Convex/shared/cache: none. Desktop version bump: yes.
- Regression test: Add origin parsing tests in `apps/desktop/src/main.rs` for same-host different port, lookalike host, local dev override, and external HTTPS. In a WebView fixture, assert off-origin `now` and `visit` are ignored.
- Verification: `cargo test --locked`; isolated Windows shell test with app/foreign fixtures and valid open, playlist, Media Session and Google OAuth return paths.
- Effort: M (<1 day)
- Depends on / Blocks: None.
- Source: [Microsoft WebView2 security guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security), [Wry 0.53.5 IPC API](https://docs.rs/wry/0.53.5/wry/struct.WebViewBuilder.html#method.with_ipc_handler), accessed 2026-11-11.

### [DESK-003] A full Notch queue can discard the requested song

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: yes)
- Category: Desktop
- Location: `apps/desktop/src/main.rs:101-115,125-143,343-348`; `apps/desktop/src/link.rs:118-140`; `apps/desktop/src/bridge.js:15-22,79-88`; `apps/web/src/App.tsx:1268-1285`
- Read first: `apps/desktop/README.md:63-65`, native catalog decoding and knowledge §§2, 4
- Evidence: Each native input accepts up to 50 supplied refs and inserts the chosen id if it was omitted. That can emit 51 refs. `catalogRequest` refuses any incoming `queue.length > 50` before the web consumer can normalize or fetch the song.
- Reproduction: Pass selected `saavn:picked` and 50 distinct other `saavn:` refs through the documented CLI, Notch enqueue or forwarding decoder. Native normalization inserts the pick. Offline Node VM ran current `bridge.js` against the normalized output: 50 invoked the registered catalog consumer and 51 was dropped. Native insertion is source-traced.
- Impact: The shell comes to the foreground but the requested song does not start and no error reaches the user.
- Fix: Normalize the selected ref and the upcoming queue in a single Rust helper used by `Cmd::decode`, `Cmd::from_args` and `link::parse_cmd`. Deduplicate first and reserve capacity for the selected ref before forwarding. Match the max 50 total contract in the JS bridge and web.
- Do not: Do not accept an unbounded list or remove the selected ref to satisfy the cap. Preserve the remaining order.
- Side effects: HTTP API contract change: no. Convex/shared/cache: none. Desktop version bump: yes.
- Regression test: Add Rust boundary fixtures under `apps/desktop/src/main.rs` and `link.rs` for 49/50 refs with and without the selected song. Add a bridge fixture proving the resulting 50-entry request reaches the consumer.
- Verification: `cargo test --locked`; issue a maximum-size catalog request to a debug shell connected to a local fake catalog.
- Effort: S (<1h)
- Depends on / Blocks: None.
- Source: Repo-only; no previous planning finding identified.

### [DESK-004] An interrupted executable replacement can leave no Allegra launcher

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no)
- Category: Desktop
- Location: `apps/desktop/src/update.rs:23-34,43-55,77-79`; `apps/desktop/src/main.rs:500-503,590-596`
- Read first: `apps/desktop/README.md:54-60`, updater source and knowledge §11
- Evidence: `update` renames the active executable to `allegra.old.exe`, then separately renames `allegra.new.exe` into place. The restore branch only runs if the process survives to receive the second rename error. Normal close can exit the process while the update runs in a background thread. Rollback errors and the release-mode update result are discarded.
- Reproduction: In a disposable scratch install, inject a process interruption after the first successful rename. The canonical path is missing, and the regular shortcut cannot invoke recovery. This interruption was traced, not exercised.
- Impact: A listener may be unable to launch until manually restoring the old executable or reinstalling. A failure after the first rename can look like the application disappeared.
- Fix: Use a Windows-supported atomic replacement or an installer/updater helper with a stable launcher and versioned payloads. Retain the previous verified payload until a successful launch, and provide a recoverable error with no user data or secret values.
- Do not: Do not assume the second rename executes or delete the old payload before verifying the next launch.
- Side effects: API contract change: no. Convex/shared/cache: none. Desktop version bump: yes.
- Regression test: Add filesystem-injected tests in `apps/desktop/src/update.rs` for first/second failure and simulated interruption, including reopen through the normal launcher.
- Verification: `cargo test --locked`; scratch Windows upgrade and forced-interruption check with fake artifacts.
- Effort: M (<1 day)
- Depends on / Blocks: Coordinate with DESK-001, which independently authenticates the replacement.
- Source: Repo-only; no previous planning finding identified.

### [FE-003] Web document policy blocks the DJ microphone recorder

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no in this review; Next header and W3C algorithm traced)
- Category: UI/UX
- Location: apps/web/next.config.ts:32–42; apps/web/src/App.tsx:1606; apps/web/src/components/DjPage.tsx:475–484; apps/web/src/components/dj/DjQuickPrompt.tsx:107–109; apps/web/src/hooks/useDjVoice.ts:186–202; apps/web/src/hooks/useDjVoice.ts:452–501; apps/web/src/hooks/useDjVoice.ts:589–599; apps/web/src/components/dj/DjSettingsSheet.tsx:164–168
- Read first: Knowledge §2 DJ, §7 headers, §9 web UI
- Evidence: Next `headers()` applies `microphone=()` for `/(.*)`. The DJ voice button runs `voice.listen()`. Local and cloud transcription branches invoke `captureUtterance`, which calls `navigator.mediaDevices.getUserMedia`. A document denied by the feature policy rejects this before ordinary user permission can enable it. The error is interpreted as a site setting the listener should change.
- Reproduction: On the web app's real HTML response, inspect Permissions-Policy or `document.featurePolicy?.allowsFeature('microphone')` in Chromium. Choose a ready local voice model, or configure a BYOK speech-to-text provider, then press the mic. There is no permission grant that overrides the document policy.
- Impact: Microphone capture cannot begin through the recorder path. The local wake-listen path uses the same capture helper. Text input remains usable. Browser SpeechRecognition behavior was not measured.
- Fix: Permit `microphone=(self)` in Next's document policy and preserve camera, geolocation, frame denial and the browser's per-site prompt. Verify route transitions from Home because the shell keeps the same document. Distinguish policy denial from user denial in help text if supported.
- Do not: Do not grant microphone access to arbitrary iframe origins or remove the explicit user action for starting capture.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Add a header regression to `tests/infra/infra-files.test.mjs` and a mock mic flow to `tests/e2e/player.spec.ts`. Assert a same-origin fake mic succeeds while camera remains disabled and the policy applies when navigation starts on Home.
- Verification: Check actual :5173 document headers and the mock capture without paid speech requests. Verify with the Codex in-app browser where microphone mocking is available.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: [W3C Media Capture and Streams, Permissions Policy Integration](https://www.w3.org/TR/mediacapture-streams/#permissions-policy-integration), accessed 2026-11-11.

### [FE-004] An older unresolved song pick can replace a newer pick

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: yes, actual `playSong` with controlled catalog promise)
- Category: Frontend
- Location: apps/web/src/App.tsx:1221–1265; apps/web/src/App.tsx:2001–2006; apps/web/src/hooks/useConnect.ts:81–95; apps/web/src/hooks/useAudioPlayer.ts:121–151; apps/web/src/lib/libraryRows.ts:33–45
- Read first: Knowledge §2 playback, §5 async cancellation
- Evidence: `playSong(A)` awaits catalog resolution when `A.streamUrl` is absent. A later `playSong(B)` that already has a URL reaches `audio.selectSong(B)` first. The first callback resumes with no latest-selection check before mutating radio, queue and player. The media generation increments at final selection, too late to detect an old request.
- Reproduction: Use a library metadata-only row A whose lookup is slow, then select a playable B before A resolves. The scratch harness using actual `playSong` and a deferred lookup observed selections in order B, A.
- Impact: The player starts B, then unexpectedly switches to A and its context. A stale failed lookup can also show an error after the new song starts.
- Fix: Capture an intent sequence before awaiting `playRemote` or catalog resolution. Check it after each async boundary and before reporting errors or committing local radio/queue state. Account for album-card lookup if it dispatches a later `playSong` after another user choice.
- Do not: Do not check only `currentSong.id`; the existing song may legitimately keep playing while a newer intent resolves. Avoid a debounce that delays deliberate picks.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Use a deferred promise in a new focused `apps/web/src/lib/playIntent.test.ts`. Assert that late success and late failure are both ignored, including a metadata-only library row followed by a directly playable result.
- Verification: Run root checks and a local network-delay browser scenario with mock catalog responses.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Source trace and isolated regression harness, 2026-11-11.

### [FE-005] Karaoke source swap can resume after a pause or report a broken source as ready

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: yes, actual callback with mocked HTML media events)
- Category: Frontend
- Location: apps/web/src/hooks/useAudioPlayer.ts:93–106; apps/web/src/hooks/useAudioPlayer.ts:284–318; apps/web/src/hooks/useLiveKaraoke.ts:263–282; apps/web/src/hooks/useLiveKaraoke.ts:555–563
- Read first: Knowledge §2 playback and Karaoke, §5 player ownership
- Evidence: `swapAudioSource` captures `wasPlaying` before awaiting metadata. A pause changes `playbackIntentRef` but does not invalidate this generation. After metadata the callback calls `requestPlayback(true)` when the old value was true. The same `onReady` handles `loadedmetadata` and `error`; either resolves the wait, and the function returns true. There is no deadline for a source that never emits either event.
- Reproduction: Start a swap with an active track. Issue pause before `loadedmetadata`, then deliver that event. In a separate swap deliver `error` with the same song and generation. The scratch harness observed a `true` playback request after the pause and a `true` return from the errored swap.
- Impact: A pause can be undone and broken rendered audio can be treated as switched successfully. A stalled swap can leave the caller waiting indefinitely.
- Fix: Resolve readiness with a boolean, bound it, and remove all listeners on success, error, timeout or superseding selection. Recheck the current intent on successful completion. Leave an explicit, tested path to restore the original source on error.
- Do not: Do not create a second `<audio>` element or replace the current user intent with a snapshot from before the await.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Extend `tests/e2e/karaoke.spec.ts` with controlled media events and assert pause survives, error returns failure and the original source remains playable, and a stalled swap times out.
- Verification: Run root checks and exercise rendered-to-original switching and rapid pause while loading with local fixtures.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Source trace and isolated regression harness, 2026-11-11.

### [FE-006] Missing catalog rows leave a completed playlist labeled loading forever

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, traced a stored item without snapshot and a successful partial catalog response)
- Category: Edge case
- Location: apps/web/src/hooks/usePlaylists.ts:177–213; apps/web/src/hooks/usePlaylists.ts:217–226; apps/web/src/lib/libraryRows.ts:33–45; apps/web/src/App.tsx:1121–1125; apps/web/src/App.tsx:2040; apps/web/src/components/CollectionPage.tsx:122; apps/web/src/components/CollectionPage.tsx:151–156
- Read first: Knowledge §2 library, §4 library contracts
- Evidence: A library item contributes its ID to `LibraryRecord.songIds`, even when no snapshot or catalog song exists. `createLibrarySong` returns null with neither. App filters missing rows and computes loading from `activePlaylistSongs.length < activePlaylist.songIds.length` after the request has settled. CollectionPage shows an indefinite loading label, or skeletons if every row is absent.
- Reproduction: Seed one valid stored track ref with no snapshot and make the batch catalog return success without that ID. Open the playlist after fetch and check the heading and list. Repeat with both an available and unavailable ref.
- Impact: A completed playlist looks busy forever. Missing items cannot be identified, and all-missing playlists have no terminal empty or unavailable state.
- Fix: Expose hydration completion separately from visible track count. Render unavailable rows or a settled message with an explicit retry. Keep the saved ref so a provider recovery or removal can reconcile it.
- Do not: Do not delete persisted items because a provider did not return them and do not fabricate a playable stream for a missing item.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Extend `apps/web/src/lib/library-loading.test.ts` with a successful partial fetch and an all-missing fetch, then assert the collection transitions out of loading in `tests/e2e/app.spec.ts`.
- Verification: Run root checks and a local mock playlist with mixed availability.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Source trace, 2026-11-11.

### [MOB-002] Explain when a mobile library edit loses to a newer change

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Data integrity
- Location: packages/shared/library.ts:143-160,305-338; docs/api-contract.md:443; apps/mobile/src/services/sync/LibrarySync.ts:317-342
- Read first: §2, §4; packages/shared/library.ts; docs/api-contract.md
- Evidence: LibraryWrite carries superseded indices, and alignOpTimes corrects large wall-clock offset while preserving age. Mobile acknowledges the batch and refreshes after a conflict without telling the listener that a local edit lost. The original slow-clock order bug and the remaining feedback gap are distinct.
- Reproduction: 1. Send a stale offline edit against a newer remote value. 2. Return its index in superseded. 3. Verify the UI gives recoverable, specific feedback and keeps the authoritative row.
- Impact: An edit can visibly revert after reconnect while the listener believes it synced. It requires a real ordering conflict. Retrying blindly would override another device's newer intent.
- Fix: Return a typed count/operation summary to the mobile sync state and display a concise conflict notice with explicit reapply only where safe. Preserve tombstone and revision rules.
- Do not: Do not substitute server time for every operation timestamp or retry superseded deletes automatically.
- Side effects: HTTP no; Convex no; shared sync no; mobile version yes; desktop/cache no.
- Regression test: Add mobile sync coverage for partial success, superseded edits, no duplicate notice on retry, and authoritative reconciliation.
- Verification: Run npm run mobile:check and a two-device offline/online regression when available.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Seed 10 and docs/api-contract.md:443.

### [SEC-006] Bind the checked address to the outbound metadata connection

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, connection trace)
- Category: Security
- Location: apps/api/src/oauth/router.ts:153-159; apps/api/src/oauth/clients.ts:119-125,145-179; apps/api/src/lib/fetchWithTimeout.ts:34-38
- Read first: §7; apps/api/src/oauth/clients.ts
- Evidence: Metadata checks all addresses using lookup, rejects non-public results, and sends fetch with redirect:error. The later default fetch has no binding to the validated results and can resolve independently.
- Reproduction: 1. Use an injected resolver and connector with changing DNS fixtures. 2. Assert that the actual connection uses an address from the checked public set. 3. Assert redirects are rejected.
- Impact: The initial DNS result and connection destination can differ. Practical internal reachability depends on egress policy and a successful HTTPS handshake. Neither private-service access nor deployed exploitability was verified. CWE-918, network with infrastructure preconditions.
- Fix: Use an outbound connector that pins a validated destination IP for each connection while preserving the hostname for TLS verification. Reject disallowed ranges before socket connect and leave redirects disabled. Share the bounded budget from SEC-002.
- Do not: Do not turn off certificate validation or replace the authority with a raw IP in ways that break SNI/cert checks.
- Side effects: API contract no; Convex no; shared sync no; versions no; cache bump no.
- Regression test: Add injected resolver/connector tests in OAuth client tests, including dual stack, mixed answer sets and forbidden redirect.
- Verification: Run npm test and check allowed public metadata resolution using a controlled endpoint.
- Effort: M (<1 day)
- Depends on / Blocks: Related SEC-002.
- Source: [OWASP SSRF Prevention Cheat Sheet, accessed 2026-11-11](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### [SEC-007] Derive OAuth issuer and audience from validated configured origins

- Severity: MEDIUM
- Certainty: LIKELY (reproduced: no; public proxy behavior unverified)
- Category: Security
- Location: apps/api/src/oauth/router.ts:23-41,96-129,153-191; apps/api/src/mcp/server.ts:41-53; vercel.json:6-22
- Read first: §4, §7; docs/mcp-contract.md; apps/api/src/config.ts
- Evidence: publicOrigin prefers the first X-Forwarded-Host and X-Forwarded-Proto values. Discovery and authorization build issuer/endpoints from that result, and MCP validates the audience derived from the incoming request. Vercel documents X-Forwarded-Host as identical to Host. It does not prove all deployment aliases and forwarding paths are canonical.
- Reproduction: 1. In a local createApp fixture send discovery with a different synthetic forwarded host. 2. Assert discovery and bearer challenges use the configured origin or reject the untrusted host. 3. Check intentional preview/local aliases separately.
- Impact: When a proxy passes an untrusted header or the service is mounted under another allowed host, generated OAuth discovery can point to the wrong origin. A production cache-poisoning or token-disclosure path is UNVERIFIED. CWE-346.
- Fix: Inject the canonical OAuth origin from config into discovery, authorize, token and MCP access verification. For multiple supported aliases allow only exact normalized configured origins and define issuer/resource behavior per alias. Preserve localhost test ports explicitly.
- Do not: Do not fix only discovery while token signing or audience checks still use unrelated request host data.
- Side effects: Protocol metadata value may change intentionally; Convex no; shared sync no; client versions no; cache invalidation for prior discovery values.
- Regression test: Extend mounted OAuth/MCP tests with synthetic Host, forwarded host/proto and allowed local/preview fixtures.
- Verification: Run npm test and validate metadata and token exchange using a local test host.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: [Vercel request headers, accessed 2026-11-11](https://vercel.com/docs/headers/request-headers#x-forwarded-host).

### [SEC-008] Fail closed on an explicitly unknown server runtime mode

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Security
- Location: api/index.ts:1-6; apps/api/src/config.ts:80-96,228-232; apps/api/src/app.ts:114-117; apps/api/src/auth/verifier.ts:20-34
- Read first: §7, §11; apps/api/src/config.ts; apps/api/src/auth/auth.ts
- Evidence: Unknown NODE_ENV values map to development. That mode enables a fixed development-only JWT secret and loopback origin defaults. createApp independently defaults its secret if options/env are absent. The standard production path explicitly requires a configured secret.
- Reproduction: 1. Call loadConfig in a test with NODE_ENV set to a typo and no secret. 2. Observe that it is treated as development. 3. Verify the production entry cannot accept that fallback.
- Impact: A misconfigured externally reachable runtime may accept predictable guest signatures. Preconditions include a nonstandard runtime value or bypassing the env factory and a relevant existing guest identity. No evidence of this configuration on Vercel. CWE-321.
- Fix: Reject unknown explicit environment modes. Permit no-secret development only in a named local/test path and require the verified secret in the deployed factory. Keep test fixtures passing a dummy value deliberately.
- Do not: Do not break the documented no-credential local mock or assume any public Vercel alias is development.
- Side effects: API contract no; Convex no; shared sync no; versions no; cache bump no.
- Regression test: Add loadConfig tests for missing/typo/development/test/production values and verify deployed factory startup failure on incomplete config.
- Verification: Run npm test and verify test/development creation still works.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: [OWASP API8 Security Misconfiguration, accessed 2026-11-11](https://api-security.owasp.org/editions/2023/en/0xa8-security-misconfiguration/).

### [SEC-009] Make provider-supplied audio URL validation apply to the actual destination

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Security
- Location: apps/api/src/routes/common.ts:64-69; apps/api/src/lib/publicUrl.ts:3-49; apps/api/src/lib/streamResolver.ts:108-109,118-148
- Read first: §2, §7; apps/api/src/lib/publicUrl.ts; apps/api/src/lib/streamResolver.ts
- Evidence: Route input is a bounded song ID, not an arbitrary URL. The provider supplies the URL. The helper checks HTTPS, credentials and selected literal ranges. The fetch has no redirect override or DNS binding. IPv6 ULA and CGNAT are outside the literal denylist.
- Reproduction: 1. Use a fake provider returning a syntactically public test URL and a mock redirect to a forbidden destination. 2. Assert a fixed resolver rejects the redirect without connecting. 3. Repeat with trusted CDN redirects and with a valid Range request.
- Impact: Compromised or malformed provider metadata can cause the API to attempt an unintended outbound connection. Direct caller control and production private routing are UNVERIFIED. CWE-918, upstream control required.
- Fix: For each allowed provider define an explicit CDN host and redirect policy. Revalidate each redirect, check all resolved addresses at socket use and preserve Range, 206 and response headers. Apply only to affected provider paths after tracing legitimate destinations.
- Do not: Do not reject arbitrary player song IDs or silently convert streamed 206 to 200 to work around redirect handling.
- Side effects: HTTP contract no; Convex no; shared sync no; client versions no; stream cache bump if validating cached URLs differently.
- Regression test: Add streamResolver/route cases with fake DNS/redirects and upstream 206. Verify abort/cancel on denial.
- Verification: Run npm test. Smoke streaming against controlled allowed sources.
- Effort: M (<1 day)
- Depends on / Blocks: Related SEC-006 outbound connector work.
- Source: [OWASP SSRF Prevention Cheat Sheet, accessed 2026-11-11](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### [SEC-010] Bound settings keys and values before persisting profile edits

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Backend
- Location: apps/api/src/routes/common.ts:89-100; apps/api/src/app.ts:118-122; apps/api/src/routes/user.ts:226-260; convex/profiles.ts:38-64
- Read first: §4, §7; docs/api-contract.md; apps/api/src/routes/common.ts
- Evidence: sanitizeSettings rejects special object keys and nonprimitive values, then accepts arbitrary remaining primitive keys. The JSON parser limits each request, but the field model and profile merge need an aggregate limit or closed schema.
- Reproduction: 1. Use a test listener to send two small patches with unrelated unsupported settings. 2. Read profile back and check accumulation. 3. Verify known preferences still round-trip and unknown values do not persist.
- Impact: Unsupported settings can permanently bloat a listener profile, increase profile read/write cost, and eventually make settings unusable. Prototype pollution was ruled out for these keys. CWE-20 and CWE-400, signed-in caller affecting their record.
- Fix: List supported shared setting keys and per-key types/ranges. Cap the aggregate serialized size after merge. Retain reads for historical keys until migration and do not clear them on unrelated updates.
- Do not: Do not remove the existing prototype-key guard or change how privacy consent updates are applied.
- Side effects: HTTP contract document accepted settings; Convex schema optional; shared sync only if common schema changes; mobile version only if client changes; desktop no; cache bump no.
- Regression test: Add two-patch aggregate tests, numeric/string boundaries, existing valid preferences and prototype-key regressions.
- Verification: Run npm test and ensure web/mobile settings continue to load with old cached objects.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Seed 6 and repository source.

### [SEC-011] Put a durable issuance quota in front of guest-profile writes

- Severity: MEDIUM
- Certainty: CONFIRMED (reproduced: no, source trace)
- Category: Security
- Location: apps/api/src/app.ts:171-186; apps/api/src/routes/auth.ts:30-41; apps/api/src/auth/auth.ts:82-101; convex/retention.ts:1-55
- Read first: §7, §8; apps/api/src/app.ts; docs/api-contract.md
- Evidence: Both public guest aliases create a profile. Their limiter is local to one Express instance, and durable profiles are eventually pruned. There is no shared application quota established by this traced path. Edge/WAF configuration is UNVERIFIED.
- Reproduction: 1. Use two local app instances sharing a fake store. 2. Issue bounded requests against both and observe independent counters. 3. Assert both share one quota after fixing.
- Impact: Traffic that spreads across instances can create durable rows faster than one instance's advertised limit. Impact is write usage and row churn before retention. CWE-770, public endpoint. Per-instance limits are a documented choice.
- Fix: Add a deployment-level shared quota or an atomic bounded guest issuance check on Convex when durable storage is used. Key on a privacy-preserving trusted client signal, cap aggregate load, and keep guest fallback usable.
- Do not: Do not move the same Map to another module and call it cross-instance. Preserve normal guest onboarding and avoid storing raw long-lived client IPs.
- Side effects: HTTP contract keep 429/Retry-After; Convex functions/schema depends on quota implementation; shared sync no; versions no; cache bump no.
- Regression test: Use two createApp instances with one fake durable quota. Assert both aliases consume the same bucket and a retry window recovers.
- Verification: Run npm test; verify configured edge policy separately if chosen.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: [OWASP API4 Unrestricted Resource Consumption, accessed 2026-11-11](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/).

## LOW

### [AND-007] The native navigation labels stop scaling at 130 percent

- Severity: LOW
- Certainty: CONFIRMED (reproduced: no).
- Category: Accessibility
- Location: apps/mobile/src/navigation/TabNavigator.tsx:161-178, apps/mobile/src/components/V6TabBar.tsx:40-45, apps/mobile/src/components/V6TabBar.tsx:100-102, apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeTabBarView.kt:362-390, apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeTabBarView.kt:497-498, apps/mobile/src/ui/AGENTS.md:5-10.
- Read first: CODEBASE-KNOWLEDGE section 9, native V6 shell and accessibility rules.
- Evidence: Android normally chooses NativeBar. The native V6 canvas computes label size as 12 times fontScale capped at 1.3 and draws the label at a fixed baseline in its 56 dp bar. System settings above 130 percent do not enlarge the labels further. Other native controls already use Android SP conversion, for example apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeQueueListView.kt:184-189.
- Reproduction: In the native Android build, compare Stream/Search/Library labels at 130 and 200 percent system text. They remain the same font size at both settings.
- Impact: Low-vision users who enlarge system text cannot enlarge Android's persistent navigation labels to the chosen setting. This is a visual text-size issue. The tab still has an accessible name.
- Fix: Use platform SP scaling and derive label baseline, bar height and child bounds together. Keep JS shell and native bar height in agreement. Permit a larger layout at high system font sizes and preserve the separate keyboard-focus and selected styles.
- Do not: Remove the cap alone while retaining hard-coded bounds and baseline if that clips labels or shrinks the touch target.
- Side effects: API contract change no. Convex change no. Shared sync no. Mobile version bump yes. Desktop version bump no. Cache-key bump no.
- Regression test: Extend apps/mobile/android/app/src/test/java/com/lyricflow/app/views/TabBarGeometryTest.kt with 100, 130 and 200 percent layout expectations, then add a large-text screenshot/interaction fixture.
- Verification: Test 200 percent on an Android 14+ phone and a small emulator viewport with font scaling. Verify keyboard focus, TalkBack labels and no overlap with the mini-player.
- Effort: M (<1 day).
- Depends on / Blocks: None.
- Source: Repository design rule at apps/mobile/src/ui/AGENTS.md:5-10.

### [CI-005] Standalone emulator smoke can report success after the emulator dies

- Severity: LOW
- Certainty: CONFIRMED (reproduced: no)
- Category: CI/Release
- Location: `.github/scripts/mobile-android-smoke.sh:45-55,456-464`; `.github/workflows/mobile-smoke.yml:87-112,114-137`
- Read first: Standalone mobile smoke workflow and knowledge §10
- Evidence: `step` calls `finish; exit 0` if ADB reports no live device. This can bypass the later probe failure exit. `always()` preserves diagnostics. This script is independent of the production APK launch gate.
- Reproduction: Use a fake ADB command that returns `device` through initial setup and then fails `get-state`. The `step` condition terminates successfully before the remaining checks run.
- Impact: A green standalone smoke result can represent an incomplete run after an emulator or host failure.
- Fix: Preserve `finish` and exit with a distinct nonzero infrastructure status. Have the workflow upload partial diagnostics on failure and surface the infrastructure classification in the summary.
- Do not: Do not turn ADB waits back into unbounded calls or discard artifacts on failure.
- Side effects: API contract change: no. Convex/shared/cache: none. No app version bump for this standalone smoke script alone.
- Regression test: Add a fake-ADB test exercising the emulator-loss branch and assert diagnostics are written and the script exits nonzero.
- Verification: Run the shell test with fake ADB, then verify an isolated emulator smoke run classifies a disconnected device as incomplete.
- Effort: S (<1h)
- Depends on / Blocks: None.
- Source: Repo-only; no previous planning finding identified.

### [DX-001] Use the Node test harness for the pending Connect queue rules

- Severity: LOW
- Certainty: CONFIRMED (reproduced: yes)
- Category: DX
- Location: packages/connect/package.json:7-8; packages/connect/src/queueRules.test.ts:1-55; packages/connect/src/index.ts:1-23
- Read first: §10; packages/connect/src/queueEdit.test.ts; pending playback handoff
- Evidence: The dirty queueRules test calls describe, it and expect without imports. The package runs node --test, not Jest. Both root typecheck and tests failed here in the initial snapshot.
- Reproduction: 1. Keep the dirty queue test in the snapshot. 2. Run npm run typecheck and npm test. 3. Verify the fixture uses imported Node test and strict assertions after the fix.
- Impact: This blocks the pending branch gate. It is a working-tree finding; the untracked test is absent from the audited HEAD commit.
- Fix: Convert the pending test to node:test and node:assert/strict following a neighboring Connect test. Preserve all shuffle/previous/duplicate scenarios. Coordinate with the owner of the concurrent playback edits.
- Do not: Do not add Jest globals or test dependencies to the Connect package to satisfy an untracked test.
- Side effects: API no; Convex no; shared sync no; mobile bump if merged package paths rebuild the APK; desktop/cache no.
- Regression test: Existing test cases are the regression. Verify the same cases execute with Node.
- Verification: Run root typecheck and npm test.
- Effort: S (<1h)
- Depends on / Blocks: None
- Source: Initial dirty snapshot and npm output.

### [PERF-001] Optional web routes enter the initial shell import graph

- Severity: LOW
- Certainty: CONFIRMED (reproduced: no, counted from static imports; transfer and render cost unmeasured)
- Category: Performance
- Location: apps/web/app/ClientShell.tsx:3–15; apps/web/src/App.tsx:19–59; apps/web/src/App.tsx:2018–2040
- Read first: Knowledge §1 web architecture, §8 performance model
- Evidence: Next loads `App` dynamically with `ssr:false`, but `App` statically imports `DjPage`, `ImportPage`, `BlendJoinPage`, `BlendPage`, `BlendsPage`, and `LuvLinkPage` before branching on the current path. They are synchronous dependencies of the shell module loaded on every route.
- Reproduction: Inspect the built web module graph and network waterfall for a cold Home visit. Compare the set of optional feature modules reachable from the shell with the exact before/after build.
- Impact: Opening Home needs an import graph containing rarely used route code. The precise transferred bytes, chunk count, and LCP/INP impact were not measured.
- Fix: Introduce lazy imports for optional page bodies, with an appropriate route fallback. Keep the persistent audio, route parser and cross-route providers in the layout-owned shell. Compare cold Home and direct feature-route loads before claiming a gain.
- Do not: Do not move the player into each page or infer milliseconds from import counts.
- Side effects: API contract change: no. Convex, shared sync, version bump and cache-key bump: none.
- Regression test: Extend `tests/performance/search-to-play.web.spec.ts` to record cold navigation chunk bytes for Home and an optional route, and confirm direct navigation plus playback continuity in `tests/e2e/app.spec.ts`.
- Verification: Verify comparable cold runs and test that the same `<audio>` element survives route changes.
- Effort: M (<1 day)
- Depends on / Blocks: None
- Source: Source import graph, 2026-11-11.

## Seed lead disposition

| Seed | Outcome |
| --- | --- |
| 1 | Request-derived OAuth origin confirmed (SEC-007). Vercel documents forwarded host as identical to Host. Public spoofing UNVERIFIED. apps/api/src/oauth/router.ts:23-41. |
| 2 | Confirmed unknown mode falls back to development. The production path requires configured secret (SEC-008). apps/api/src/config.ts:80-96,228-232. |
| 3 | Missing explicit HS256 list confirmed. Cross-kind acceptance was rejected because guest payload checks and the selected symmetric-key algorithm family differ from Convex RS256 and MCP access claims. apps/api/src/auth/verifier.ts:20-36,62-85,89-100. |
| 4 | Confirmed literal-only guard for provider stream URLs (SEC-009). OAuth DNS checks are stronger and separately unbound (SEC-006). apps/api/src/lib/publicUrl.ts:3-49, apps/api/src/oauth/clients.ts:145-178. |
| 5 | Confirmed DNS and fetch are separate. Metadata body reads and size checks occur after the headers deadline (SEC-002, SEC-006). apps/api/src/oauth/clients.ts:119-136. |
| 6 | Confirmed unrestricted primitive settings keys. Prototype-key case rejected (SEC-010). apps/api/src/routes/common.ts:89-100, apps/api/src/routes/user.ts:241-273. |
| 7 | Confirmed durable guest writes and per-instance limits. External edge policy UNVERIFIED (SEC-011). apps/api/src/app.ts:177-192,232-234, apps/api/src/auth/auth.ts:76-80. |
| 8 | CI can fall back to the Expo debug key. Android verifies package and signer continuity. Published signer UNVERIFIED (AND-001). .github/workflows/mobile-apk.yml:68-88, apps/mobile/android/app/build.gradle:95-115. |
| 9 | Confirmed mutable version/EXE fetch and magic/size check before replacement (DESK-001, DESK-004). apps/desktop/src/update.rs:38-57,82-105. |
| 10 | Connect empty-restore overwrite is guarded. Clock alignment and superseded replies exist. Mobile still silently discards superseded edits (MOB-002). packages/connect/src/connectSession.ts:416-424,700-735, packages/shared/library.ts:305-338, apps/mobile/src/services/sync/LibrarySync.ts:317-342. |
| 11 | Confirmed historical Render, password error, Dynamo and missing AWS reference drift. Architecture contradicts itself about songRelations. No active Express caller found for retained relation functions. playStats remains legacy schema. See knowledge §13. docs/api-contract.md:62-63,717-719, docs/architecture.md:35,198-199, convex/relations.ts:13-40. |

## Rejected candidates

- **Public stream takes an arbitrary URL.** HTTP(S) input is refused at songId, then catalog supplies the media URL. Provider-returned targets still need checks in SEC-009. apps/api/src/routes/common.ts:64-69, apps/api/src/lib/streamResolver.ts:118-147.
- **OAuth redirects to any unregistered URI.** Authorization matches the requested URI against the resolved client's exact list before redirecting. apps/api/src/oauth/router.ts:153-165.
- **Settings key prototype pollution.** The sanitizer explicitly skips prototype-related names. The persistence bounds issue remains. apps/api/src/routes/common.ts:89-100.
- **An empty web restore overwrites saved Connect state.** Current restore and report guards handle the previously reported case. packages/connect/src/connectSession.ts:416-424,700-735.
- **Every critical npm audit result is production RCE.** The scanner reports version ranges. Next ImageResponse requires a reachable route passing untrusted input to its SVG renderer. None was found in reviewed routes. Other optimizer and mobile build-time conditions remain open. apps/web/next.config.ts:6-47, apps/web/app/[[...slug]]/page.tsx:3-15.
- **An unrelated APK signer passes the updater.** Package/signature continuity is checked. Public fallback key trust remains a separate issue. See AND-001.

## Needs human decision

- Choose the supported OAuth alias policy before changing canonical issuer and resource values (SEC-007).
- Choose which layer owns the guest quota and what trusted, privacy-preserving signal it may use (SEC-011).
- Confirm the published APK signer and decide on migration if any public key was used (AND-001).
- Decide the required publisher identity for Windows updates and how to transition installed versions (DESK-001).
- Decide whether to retire the unmounted Canvas and mood routes from the public contract or finish their provider flow (knowledge §13).
- Confirm the product policy for unofficial music providers before changing availability behavior. docs/provider-integration.md:90-91.
