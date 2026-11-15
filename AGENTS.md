# AGENTS.md

Agent-facing guide for the Allegra repo. The hard rules are in [`CLAUDE.md`](CLAUDE.md) — **read that
too; everything in it applies here.**

## Orientation, in order

1. [Current codebase map](docs/current-codebase.md) — task routing, owners, and recent source changes.
2. [CLAUDE.md](CLAUDE.md) — project invariants and required checks.
3. [Codebase knowledge](audit/CODEBASE-KNOWLEDGE.md) — use the core brief and relevant reference section.
4. [Docs index](docs/README.md) — load the contract or platform guide for the task.
5. [Fix backlog](audit/FIX-BACKLOG.md) — dated findings. Verify the current path before fixing an item.

Historical plans and handoffs record earlier decisions and evidence. Use the current codebase map
and Git to establish what is in this checkout.

## Run it (don't go searching)

```bash
npm install                     # once, at the root only
npm run dev                     # API on :8080 (tsx watch) + web on :5173 (next dev) — Ctrl+C stops both
npm run dev --prefix apps/api   # API alone
npm run dev --prefix apps/web   # web alone
npm run mock                    # fake API on :9090 (MOCK_PORT), no upstream providers
npm run typecheck && npm run lint && npm test   # the gate, from the root
```

- Open the app at **http://localhost:5173**. `/api/*` is rewritten to `127.0.0.1:8080`. The health
  check is http://localhost:8080/api/health.
- **If a port is already in use, the server is probably already running.** Check `/api/health` first.
  Both servers hot-reload on code changes; restart only after editing `.env`.
- Env files: `apps/api/.env` (template `apps/api/.env.example`) and `apps/web/.env.local`
  (`NEXT_PUBLIC_*` only). None are required to run.
- Test media or other browser behaviour on :5173. The API's strict CSP makes cross-origin
  `<video>`/`<audio>` fail on any :8080 page.
- Single test file: `cd apps/api && node --import tsx --test src/path/to/file.test.ts`.

## How to work here

**One thing at a time.** Take the next item, finish it, show the diff, stop. Do not scaffold a whole
layer at once.

**Vertical slices, never horizontal layers.** Build search→play end to end, then add depth. Not "all
the endpoints" followed by "all the UI".

**Verify before claiming done.** Run typecheck, lint and tests. If something fails, say so with the
output. Never report a task complete on the strength of the code looking right. If a change is visible
in a browser, look at it in a browser.

**Prefer deleting.** A control that does nothing, a config with no consumer, a second way to do the
same thing — remove it rather than documenting around it.

## Things that will waste your day

- **The `/api` rewrite must precede Next's catch-all** in `vercel.json`. If it does not, the site
  renders perfectly and every API call 404s. `vercel build` shows the real route order locally.
- **The API is serverless.** Instances freeze after responding and share no memory. Background timers,
  polling loops and in-process locks silently do nothing in production. Reconcile on read instead.
- **One lockfile for the root workspaces.** Vercel resolves web/API dependencies at the root.
  LuvLyrics is outside the root workspaces and keeps its own npm lockfile. Windows uses Cargo.lock.
- **Range requests.** `206` must survive. It is the one bug that looks like success.
- **`NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are public.** Use those prefixes only for values intended
  to be readable in the corresponding app bundle.
- **Convex Auth owns the `users` table.** Listener data lives in `profiles`.

## Phone update copy

Write LuvLyrics release notes for listeners in everyday English. Say what changed or what someone can now do,
in a short, specific sentence. Avoid commit prefixes, PR numbers, internal component names, build/CI terms,
and engineering jargon. Describe the visible result of a fix and omit work listeners cannot see. Keep
`apps/mobile/update-history.json` ordered newest first with up to four versions; `scripts/mobile-release-notes.mjs`
publishes those notes beside the APK. Use the same plain-language rule for update errors and download status
messages shown in the phone.

## Testing style

Tests state a behaviour, not a method name: *"Karaoke falls back locally when the device cannot run
the separator"*. Each seam has a fake, which is why the suite needs no network or cloud account.
Prove security properties with real primitives — the token tests sign with generated RSA keys rather
than asserting on a mock.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
