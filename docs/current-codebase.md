# Allegra codebase map

Updated 2026-11-11 against main at `fe5df309`. LuvLyrics source on that revision declares version 1.45.1. Verify release and device status separately.

## Start here

1. Read the root [agent rules](../CLAUDE.md), then use the row for your task below.
2. Load the matching [codebase knowledge](../audit/CODEBASE-KNOWLEDGE.md) section and its cited source entry points. The core brief is enough to choose the owning layer.
3. Check the live diff before changing a cited area. The [fix backlog](../audit/FIX-BACKLOG.md) records findings against the initial audit snapshot. Concurrent playback work can change their status.

| Change | Read first | Entry points |
| --- | --- | --- |
| Web routes, shell or controls | [Architecture](architecture.md), [web design](../DESIGN.md), audit §§2, 5, 9 | [Root layout](../apps/web/app/layout.tsx) → [ClientShell](../apps/web/app/ClientShell.tsx) → [App](../apps/web/src/App.tsx). App routes local and remote transport. [useAudioPlayer](../apps/web/src/hooks/useAudioPlayer.ts) owns the browser audio lifecycle. |
| Express API and providers | [API contract](api-contract.md), [provider integration](provider-integration.md), audit §§4, 7 | [Vercel API export](../api/index.ts) → [Express app](../apps/api/src/app.ts) → [service wiring](../apps/api/src/services.ts). Catalog supplies the stream destination. Preserve Range and 206 in the [stream resolver](../apps/api/src/lib/streamResolver.ts). |
| Auth, accounts and library | [Google setup](auth-convex-google.md), [API contract](api-contract.md), audit §§2, 4, 7 | [Convex Auth](../convex/auth.ts), [Express auth](../apps/api/src/auth/auth.ts), [schema](../convex/schema.ts), [shared library operations](../packages/shared/library.ts), [mobile outbox](../apps/mobile/src/services/sync/LibrarySync.ts). Convex Auth owns users. Listener data lives in profiles and dedicated tables. |
| Connect and LuvLink | [Connect contract](connect-contract.md), [LuvLink contract](luvlink-contract.md), audit §§2, 4 | [Connect session](../packages/connect/src/connectSession.ts), [routing](../packages/connect/src/routing.ts), [Connect functions](../convex/connect.ts), [LuvLink functions](../convex/luvLink.ts). Connect is account-scoped. LuvLink is room-scoped. Audio stays on the playing device. |
| Android player, library or design | [Mobile rules](../apps/mobile/CLAUDE.md), [mobile design](../apps/mobile/DESIGN.md), audit §§2, 9–11 | [RootNavigator](../apps/mobile/src/navigation/RootNavigator.tsx), [PlayerContext](../apps/mobile/src/contexts/PlayerContext.tsx), [NativeAudioPlayer](../apps/mobile/src/services/NativeAudioPlayer.ts), [Kotlin playback](../apps/mobile/android/app/src/main/java/com/lyricflow/app/playback). |
| Windows shell | [Desktop README](../apps/desktop/README.md), audit §§2, 11 | [Main and mini WebViews](../apps/desktop/src/main.rs), [page bridge](../apps/desktop/src/bridge.js), [updater](../apps/desktop/src/update.rs). |
| Deploy, updates or verification | [Workflows](workflows.md), audit §§10–12 | [Vercel routing](../vercel.json), [Vercel build](../scripts/vercel-build.mjs), [root CI](../.github/workflows/ci.yml), [APK workflow](../.github/workflows/mobile-apk.yml), [Windows workflow](../.github/workflows/desktop.yml). |

## Recent changes in source

| Revision | What is present | Where to work |
| --- | --- | --- |
| Mobile 1.43–1.44 | Stream, Luvs and Library shell with Create and profile actions, a revised mini player, playlist detail and sharing, LuvLyrics visual codes and scanner. A code resolves through the existing link parser and share/import flow. | [Mobile design](../apps/mobile/DESIGN.md), [ShareSheet](../apps/mobile/src/components/share/ShareSheet.tsx), [ScanCodeScreen](../apps/mobile/src/screens/ScanCodeScreen.tsx), [shared code codec](../packages/shared/luvCode.ts), [deep links](../apps/mobile/src/hooks/useDeepLinks.ts). |
| Mobile 1.45.0 | Listening Stats in the profile menu. The phone's listening log feeds top songs and artists, repeat activity, time-of-day and tempo views. | [ListeningStatsScreen](../apps/mobile/src/screens/ListeningStatsScreen.tsx), [useListeningStats](../apps/mobile/src/hooks/useListeningStats.ts), [stats calculations](../apps/mobile/src/services/stats/listeningStats.ts). |
| Mobile 1.45.1 and scanner coverage | The code scanner handles darker images and the stats calculation combines qualifying paused segments. The scanner frame-budget check is on main at `fe5df309`. | [Image decoding](../apps/mobile/src/services/share/scanImage.ts), [code codec tests](../packages/shared/luvCode.test.ts), [listening stats tests](../apps/mobile/src/services/stats/listeningStats.test.ts). |

The [audit](../audit/CODEBASE-KNOWLEDGE.md) also covers a separate local 1.45.2 playback snapshot on the fix/playback-skip-glitches branch at 9081dea8. Its source references follow that snapshot.

## Boundaries that matter

- The browser keeps one layout-owned audio element. Android's Kotlin Media3 service and queue engine own Android audio and its confirmed state. JavaScript mirrors native state and routes intent. Keep web, Android native and Expo fallback behavior distinct.
- Root workspaces use the root npm lockfile. Mobile has its own lockfile and native tests. Run the root gate, then `npm run mobile:check` after Convex tests finish. Desktop has its own Cargo lockfile.
- Changes to shared implementation modules copied into the API require `npm run sync:shared` and the infra parity test. `apps/api/src/types.ts` is a separate declaration seam. Review its shape alongside `packages/shared/types.ts`.
- Vercel production waits for the website build and Convex push to succeed. Mobile and Windows release workflows use separate channels. Check the matching version field and actual release gate.
- Local tests prove their exercised paths. Credentials, actual deployed routes, release signing, browser playback, Android installation and physical-device performance require their own evidence. Use the [audit baseline](../audit/CODEBASE-KNOWLEDGE.md) for the recorded check results.
