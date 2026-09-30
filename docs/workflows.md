# Workflows — develop, verify, ship

## Local development

```bash
npm install          # once, at the root: one lockfile covers every workspace
npm run dev          # API on :8080, web on :5173
```

`npm run dev` starts both. The web app calls same-origin `/api`, which Next rewrites to the API in
development — so there is no CORS setup and no `localhost` vs `127.0.0.1` trap.

Nothing needs credentials to run. With no Convex the app is guest-only and user data is in memory.
Karaoke runs on the listener's device, so it has no API or cloud configuration.

### Connect and account sync

Connect, account library sync, and cross-device recommendations require Convex Auth and the same
Convex deployment in the web, API, and phone environments. Set `NEXT_PUBLIC_CONVEX_URL` in
`apps/web/.env.local`, and `CONVEX_URL` plus `CONVEX_SERVER_SECRET` in `apps/api/.env`. Set the
mobile app's Convex URL to the same development deployment before building it. Deploy additive
Convex changes to the selected **development** deployment with `npx convex dev --once`; check the
deployment name printed by the CLI first. The production deployment is a separate owner-controlled
step.

The two-tab harness tests the complete web command path without a phone:

1. Start the API and web app, sign in to the same account in two tabs, and leave tab A on the normal
   URL. Open tab B at `http://localhost:5173/?connectDevice=b` (development only).
2. Start a song in either tab. Open **Playback devices** and transfer to the other tab.
3. Check pause/play, seek, next/previous, volume, shuffle, repeat, queueing a song while the other
   tab is active, and transfer back. If a fresh tab blocks autoplay, its picker must offer **Tap to
   play here** and continue at the transferred position.
4. Change a like and a playlist item in one tab; the other tab should refresh from the Convex
   library revision. The `<audio>` element remains the same DOM node across route changes.

For phone coverage, sign in on a dev Android build with the same Google account. Transfer in both
directions, then test web-to-phone song selection and phone-to-web library edits. Like a streamed song
without downloading it; toggle a like and edit a playlist while offline, reconnect, and confirm the
outbox catches up. Listen to a few tracks, then confirm **Quick picks for you** uses that account's
listening history. Confirm downloads remain available offline and are not removed by library sync.

| Want | Add to `apps/api/.env` |
|---|---|
| Durable user data + Google sign-in | `CONVEX_URL`, `CONVEX_SERVER_SECRET` (+ `NEXT_PUBLIC_CONVEX_URL` in `apps/web/.env.local`) — see [auth-convex-google.md](./auth-convex-google.md) |
| Recommendations, lyric translation | No key. Recommendations use catalog + listener taste; MyMemory translates lyrics. Set `LIBRETRANSLATE_API_URL` only for a self-hosted fallback. |

### The phone app (LuvLyrics, `apps/mobile`)

`apps/mobile` is Expo / React Native and is **not** a root workspace: it has its own lockfile and
pins React for React Native, so it installs separately.

```bash
npm ci --prefix apps/mobile     # once, and after its package-lock.json changes
npm run dev:mobile              # Metro for a dev build on a phone or emulator
npm run mobile:check            # the app's own gate: secrets, lint, typecheck, tests
```

- A first native build: `cd apps/mobile/android && ./gradlew assembleDebug` (JDK 17 in `JAVA_HOME`,
  `apps/mobile/android/local.properties` pointing at the Android SDK). Keep the checkout on a short
  path without spaces (for example `C:\dev\allegra`): Windows CMake builds of Skia and Reanimated fail
  on long paths.
- `apps/mobile/android/app/debug.keystore` is gitignored and signs every build. Android only installs
  an update over an app signed with the same key, so keep a copy of it outside the repo.
- Shared code comes from `packages/` through the `@shared/*` alias (tsconfig, `metro.config.js`,
  `jest.config.js`). Code in `packages/` imports no npm packages: Metro would otherwise resolve them
  from the root `node_modules` and bundle a second React.
- CI: `.github/workflows/mobile-ci.yml` (checks), `mobile-apk.yml` (publishes `apk-latest`, which
  the app's updater reads), `mobile-smoke.yml` (emulator walk-through).
- App rules live in [`apps/mobile/CLAUDE.md`](../apps/mobile/CLAUDE.md).

## The gate

```bash
npm run typecheck    # exit 0
npm run lint         # exit 0
npm test             # all green
```

All three before opening a PR. They run across every workspace from the root.

Frontend work is also checked at 360 / 768 / 1280 / 1920, and the hero transition is profiled on a
**real phone**, not a laptop.

## Verifying a change end to end

The two things worth proving by hand, because both fail invisibly:

**Range requests still return 206.** Collapse it to 200 and audio plays perfectly while seeking does
nothing.

```bash
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" http://localhost:5173/api/stream/<songId>
# expect: HTTP/1.1 206 Partial Content + content-range + accept-ranges
```

**Playback survives navigation.** The single `<audio>` element lives in the layout; if a change
remounts it, music stops on every route change. In the browser console, after pressing play:

```js
document.querySelector('audio').__probe = 1;
document.querySelector('a[href="/library"]').click();
// after navigating: the same element must still be there and still playing
document.querySelector('audio').__probe === 1 && !document.querySelector('audio').paused;
```

## Inspecting a Vercel build without deploying

`vercel build` produces the real deployment output locally. Use it whenever routing changes:

```bash
vercel build
node -e "require('./.vercel/output/config.json').routes.forEach((r,i)=>console.log(i, r.handle||r.src||''))"
```

The `/api` rewrite must appear **before** Next's `[[...slug]]` catch-all. If it does not, every API
call will 404 in production while the site still renders.

## Branching and commits

`main` is always deployable and always green. Work on `feat/`, `fix/`, `chore/`, `docs/` branches.
Small PRs, squash-merge, reviewed by a non-author.

Conventional commits: `feat(api):`, `fix(web):`, `chore(infra):`. Short imperative subject; a body
only when the *why* needs explaining.

## Shipping

```bash
vercel deploy            # preview
vercel deploy --prod     # production — only when asked
npx convex deploy        # Convex functions and schema
node scripts/sync-vercel-env.mjs   # push apps/api/.env to Vercel (prints names only)
```

Smoke the production alias afterwards:

```bash
curl -s https://allegravibe.vercel.app/api/health
curl -sI -H "Range: bytes=0-1023" https://allegravibe.vercel.app/api/stream/<songId>
```

Preview deployments sit behind Vercel's SSO protection, so a public `curl` against one returns a
login redirect rather than your app. Verify against the production alias.

## Scope

Anything that ships a control which does nothing is out. The Premium page is a labelled UI demo with
no payments. Karaoke is real: it separates locally in a browser worker, with a mid-side fallback
when the model cannot run on the current device.
