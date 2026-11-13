# Mobile integration and LightFM delivery plan

Date: 2026-11-13. Owner authorized integration, polish, version bumps and merges after passing checks. Work proceeds one vertical slice at a time. This document is a delivery plan, not implementation proof.

## Product contract

- LightFM powers recommendations in Luvs, the Quick Picks list, the recommendation grid, Made for You, Smart Queue and mood chips. Provider search can resolve playable catalog candidates, but must not silently replace model ranking with a separate recommendation algorithm.
- Keep **Quick Picks** for the list. Name the recommendation grid **Daily Discovery**, so two recommendation surfaces do not share a title. Preserve **Jump back in** as actual listening history. The earlier `More picks for you` rename in PR 85 addressed duplicate catalog shelf names; the new model-powered grid supersedes that recommendation shelf.
- **Made for You** consists of personalized daily playlists stored for each user. Generate once per account/day, return that persisted result across restarts, reloads and devices, and display its date. Do not rebuild it on every render or mutate its order during playback.
- Luvs is a card stack, with explicit preference meanings and an info button. Right: More like this. Left: Not interested. Double tap: Like, using the existing library-like operation. Up: Next, with no explicit dislike. Down: Song actions. Love is a separate labeled action with a stronger preference signal. Canceled gestures and opening details do not train the model. All actions have accessible button equivalents; preference actions have undo.
- Native transport controls should respond as directly as the existing Dynamic Island controls, while retaining the authoritative native player, remote routing and confirmed playback state.

## Architecture decisions and research

Theo's [T3 Stack](https://create.t3.gg/en/introduction/) emphasizes modularity and full-stack TypeScript safety; its components are optional. Apply those principles to the existing Expo/React Native, Next.js, Express and Convex architecture. Keep one recommendation contract, strict types, runtime validation, explicit error states and narrow modules. Do not introduce a second authentication/database stack or a parallel tRPC API solely to adopt a stack name.

LightFM's [official implementation](https://github.com/lyst/lightfm/blob/master/lightfm/lightfm.py) distinguishes logistic loss with positive/negative interactions from pairwise positive-feedback losses. Benchmark signed logistic feedback against the current WARP baseline; do not feed a negative dislike weight into WARP and assume it models explicit negatives correctly. See [official model docs](https://making.lyst.com/lightfm/docs/lightfm.html).

## Verified starting state

| Area | Evidence and gap |
| --- | --- |
| Main | Web PR 83 merged at `e2699dc6`. PR 85 merged into the player parent branch, not yet main. |
| Mobile release stack | PR 86 head `a2f5c085`, version 1.52.1. Code/Kotlin/APK build passed at last check; emulator gate pending. Merge 86 into 84, then validate and merge 84 to main. |
| Discovery worktree | `C:/dev/allegra-discovery-polish`, HEAD `6f149b8f`, 18 modified and 22 untracked source/test files. Preserve exact snapshot before porting. |
| Discovery checks | Existing dirty source typechecks. Six focused suites / 15 tests pass for live picks, storage, search sessions, category results and mood recommendations. No native build/runtime proof for NativeTransport yet. |
| LightFM | Training/export/preview code already in repo. Old separate worktree no longer exists. Model artifacts are present in root `output/recommendations`, including the enriched 3.5 MB export. Current production recommendations are still catalog-based; preview is development-only. |
| Model quality | Historical three-seed nDCG@10: current 0.115 versus blend 0.117, paired interval includes zero. Public playlist profiles are not authenticated listener profiles. This does not establish a production quality win. |
| Raw QA logs | 31 reviewed files, 83,539,538 bytes, summarized then deleted locally. See [QA evidence summary](mobile-ui-review/QA-LOG-SUMMARY-2026-11-13.md). Logs were ignored/untracked; repository history is unchanged. |

## Slice 0: preserve and classify unfinished work

1. Archive the discovery worktree's 40 changed/new source files, exact HEAD, binary diff and status. Keep originals intact. Do not copy dependencies, credentials or build caches.
2. Compare local-only patches with main, not just commit ancestry: squash merges can make already-shipped work appear missing. `161d505c` update watcher is patch-equivalent to main; do not replay it. Inspect the combined mini-menu merge before replaying `f732071b`; PRs 81 and 85 already carry menu behavior. Keep `wip/backup-2026-11-12` as recovery, not a merge candidate.
3. Inspect `cb0f55c1` playback-edge-case patch and `78100d4a` erased-account write guard against current source. Port only remaining behavior, with relevant tests and contract checks. Read Convex generated guidelines before changing its functions.
4. Preserve the handoffs and implicit-state-machine inventory. Convert unresolved, source-verified findings into scoped acceptance work; do not perform a blanket player state-machine rewrite.

Acceptance: every unpublished/untracked item is mapped to an integration slice, an already-shipped equivalent, or retained recovery evidence. Nothing is discarded because its branch is old.

## Slice 1: finish the existing safe release

1. Wait for PR 86 emulator gate; investigate failures rather than bypassing them.
2. Squash 86 into the player parent, keeping version 1.52.1 and the Media3 alignment from 85.
3. Refresh PR 84 title/body around the combined final behavior, integrate current main if necessary, and run the required checks on the actual combined revision.
4. Merge 84 only after checks pass. Verify main's version and release workflow SHA separately from published APK availability. Keep physical-device/canvas codec claims separate from emulator launch proof.

## Slice 2: native transport, end to end

Files: NativeTransportModule/View, NativePlaybackControl, ExpoModulesPackageList, PlaybackButton and affected MiniPlayer/PillPlayer/NowPlayingControls consumers.

- Trace PlayerBridge, Dynamic Island transport, service resume behavior and Connect/LuvLink ownership before porting. Use a single native intent path; one tap must not issue both a native command and a JS fallback command.
- Synchronize the displayed icon/status from confirmed native state, including buffering, ended, stopped, retry and service recreation. Native module absence or unsupported/remote ownership uses the existing JS owner safely.
- Audit current remote detection: a remote Connect session must never toggle local playback just because the local native view exists. Room ownership also retains its established routing.
- Gesture cancellation, drag-to-dismiss, multi-touch, long holds, TalkBack activation and Reduce Motion must work without accidental toggles. Keep touch targets and style tokens.
- Measure touch-up to command dispatch, native state event and first UI draw using a monotonic clock. Target immediate press feedback within a frame and command dispatch within 50 ms on the tested device; report measured percentiles and hardware. Actual stream startup remains separately measured. Test while JS is busy, with rapid alternating taps and after background/foreground/service recovery.

Acceptance: native unit tests and APK compilation pass; emulator demonstrates responsive, correctly routed controls; no loss of remote behavior, paused intent, queue owner or canvas crash fix. A phone measurement is recorded separately when available.

## Slice 3: one recommendation and feedback contract

Entry points: API recommendationContext/recommendations/lightfm; mobile Luvs feed/lanes/taste, account API, Quick Picks store and queue top-up; shared SongRef and listen verdicts.

- Update `docs/api-contract.md` first, then implement shared validated request/response and feedback types. Keep existing response compatibility or migrate all web/mobile/MCP consumers together.
- Recommendation requests identify surface, supported mood, limit and exclusions; server derives account identity. Responses identify model version, profile revision, batch ID and scored items. Product UI shows helpful dates/states rather than implementation metadata.
- Events use a stable id, account scope, canonical recording identity, impression/batch ID, source surface and action. Distinguish exposure, playback time, completion, neutral next, More like this, Like, Love, Not interested and undo. Deduplicate retries; canceled/undone gestures must not survive as training labels. Do not infer a dislike from a network/playback failure.
- Reuse a bounded offline outbox. Sign-out/account erasure invalidates pending work and cached state; delayed account A results must never appear in account B. Preserve library Like semantics independently of a preference event.
- Calibrate relative signal weights with replay evaluation. Love is stronger than Like, which is stronger than More like this; exposure/neutral Next is not an explicit positive. Not interested excludes that recording immediately and becomes an explicit negative training example. Undo compensates local exclusions and the durable event.

Acceptance: retry/undo, account isolation, malformed input, erased accounts, out-of-order responses and canonical identity mismatches have behavioral tests. Existing library sync and auth tests remain green.

## Slice 4: real LightFM serving and learning loop

- Verify existing exported factors with TypeScript/Python parity and artifact checksum. Do not use synthetic parity fixtures or a public playlist ID as a real listener's fitted vector.
- Build eligible listener interaction/feature rows using the existing privacy and pilot contract. Fit account features with real Like/Love/negative/listen feedback. New listeners use model-supported onboarding/language/mood features and a model-trained cold-start profile; all scored recommendations still come from LightFM.
- Train on Linux outside Vercel request handlers. Persist immutable versioned artifacts and metadata; production API loads a validated deployment artifact through a bounded cache. No in-process training timer/background lock in the serverless API.
- Implement authenticated scoring with stable provider-qualified recording mapping. Candidate retrieval may come from the catalog; final recommendation ranking comes from LightFM. Apply language, availability, duplicate, artist-diversity and explicit-dislike constraints consistently across surfaces.
- Feedback affects the next serving request through an explicit profile update/re-fit path using LightFM features/parameters. Establish and report the actual freshness SLA. Shared-model retraining is periodic and distinct from per-user serving updates; a UI preference change alone is not proof the model learned.
- Missing/corrupt/unavailable model: reuse a still-valid previously model-scored batch or show a recoverable unavailable/onboarding state. Do not silently fall back to catalog heuristic recommendations under the LightFM label.
- Keep replay/held-out evaluation: nDCG@10, coverage, diversity, cold-start behavior, languages, negative-feedback effectiveness and daily stability. Preserve the old baseline for evaluation and rollback, not as an undisclosed runtime ranker. Do not claim a model-quality improvement until measurements support it.

Acceptance: same account/model/profile revision is deterministic; a committed feedback update changes the subsequent eligible ranking in a meaningful fixture; negative/undo behavior works; artifact failures never crash playback. Production artifact availability and deployed API are separately verified.

## Slice 5: Quick Picks, Daily Discovery and daily Made for You

- Port useful live picks/storage code into the integrated branch, replacing the heuristic rank and history-search fallback with the shared LightFM API. Keep stable cached UI, bounded loading and clear retry states.
- Quick Picks list and Daily Discovery grid share model/profile semantics and action menus. Avoid repeating the same recordings across adjacent surfaces without a deliberate reason. A layout change must not regenerate a batch.
- Daily Made for You uses persisted identity `(account, local-day-key)` and playlist slots under that daily record. Store model version and timezone alongside it; unique/idempotent creation must survive simultaneous devices and retries. Changing the model midday does not silently generate a second daily batch.
- Use the account's stable IANA timezone/day policy; define travel/timezone-change behavior so clock or timezone toggles do not create unlimited daily batches. Reconcile on first read after the boundary, with transactional claim/finalization and retry recovery. Do not rely on serverless timers or process memory.
- Save daily playlist IDs and order once; use the same snapshots across web/mobile. User edits, explicit queued songs and currently playing tracks remain stable. Display generation date and the next update expectation. Failed generation retains the prior dated snapshot with a truthful state.
- Smart Queue takes the same model-scored results, excludes current/queued/recent/disliked songs, and appends through the current native queue owner. Stale async results must not overwrite manual queue edits or a changed session.
- Mood chips, including Relaxing and Sad, pass a validated model-supported mood context. Train/use mood item features or reliable annotations; a missing annotation is unknown. Do not replace model scoring with a text-search mix. Unsupported moods get a clear state.

Acceptance: two accounts get isolated daily playlists; same account on two devices sees the same daily IDs/order; repeat refresh cannot regenerate them; day rollover creates one new record; offline/failed generation retains a dated previous result. Model provenance is verified for list, grid, mood, Luvs and Smart Queue.

## Slice 6: Luvs card stack and feedback UX

- Replace lane/depth navigation with a bounded card stack using the shared model feed. Keep a small prefetched next window and release decorative video resources when cards leave; preserve active audio ownership.
- Use one gesture arbitration policy: horizontal preferences, vertical next/actions, double tap Like, single tap its documented existing cover action. Crossing direction thresholds locks the axis; reversal before commit cancels. Buttons perform the identical actions for accessibility.
- Add concise Info copy for every gesture and explicit Like/Love/More like this distinctions, how Not interested affects recommendations, undo and feedback use. Keep first-use hints dismissible and discoverable through Info.
- Persist preference events only after confirmed gesture commit. Animate success after local durable acceptance; background upload/retraining does not block the gesture. Failed sync remains retryable and visible where useful.
- Test small/large screens, 200% text, Reduce Motion, rapid swipes, app backgrounding, missing canvas/decoder errors, network loss, exhausted feed and card disposal. No double audio start or duplicate feedback on rerender.

Acceptance: each gesture creates exactly its intended event; cancel/undo has no lasting incorrect label; new ranked results reflect the serving profile; cards/buttons remain usable with TalkBack. Inspect the actual APK and record visual evidence.

## Slice 7: remaining discovery and retained documents

Port search session persistence, category results, catalog albums, generated playlist queries, saved picks, discovery collections, mood entry points, route types and the shared CollectionCard styling only after the shared serving contract exists. Preserve title/cover identity, library counts, accessibility and native controls from the integrated release. Remove duplicate paths with no consumer.

Retain and link the two update/download handoffs, two player/Create handoffs and the implicit-state inventory as dated evidence; update their status with shipped-equivalent references. Do not commit raw logs or giant generated model/audio files merely to clean `git status`.

## Merge and release gates

Each slice gets a small branch/PR with exact source provenance and a version bump for any main change that builds an APK. After 1.52.1, choose the next version against live main: patch for fixes, minor for the new native/discovery/Luvs features. Do not hard-code a stale release sequence.

Before a slice merges: root typecheck/lint/test, then mobile check after Convex tests finish; Kotlin tests and APK build for native work; shared sync/parity for changed shared implementations; Convex guidelines/development regeneration where applicable. Run relevant behavioral and emulator checks. Separate CI, emulator, real-device, deployed API and release-publication evidence. Never merge failing checks or claim phone proof from CI.

Final acceptance: all authorized useful work is represented in merged source or explicitly retained recovery/docs; no unexplained dirty source remains; all five recommendation consumers use the same LightFM system; daily playlists are genuinely per-user and stable; native transport is measured and responsive; main version and published release revision agree.

## Execution ledger

- Done: live worktree inventory; explicit scope confirmation; primary-source T3/LightFM research; QA log summarization/removal; focused discovery baseline checks.
- In progress: preserve exact discovery snapshot and complete existing mobile stack once its emulator gate passes.
- Pending: slices 2–7 implementation, integration/runtime acceptance, fresh version bumps, remaining merges and release verification.
