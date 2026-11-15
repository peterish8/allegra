# P1-4 Supply chain and CI: Dependabot, pinned Actions, CodeQL

Draft id: P2-10 (promoted: cheap, independent, closes backlog CI-002). Branches: `chore/ci-pin-actions`,
`chore/ci-dependabot`, `chore/ci-codeql`. Version bumps: the pin PR edits `mobile-apk.yml` (an APK path) and
`desktop.yml`, so it bumps `apps/mobile/app.json` `expo.version` (patch) and `apps/desktop/Cargo.toml` `version` (patch).

## 1. Goal and user-visible outcome

Every third-party GitHub Action runs at a reviewed commit, dependency updates arrive as small grouped pull requests on
a schedule with a cooling-off delay, and every pull request gets a CodeQL scan for the TypeScript/JavaScript code, the
workflow files and the Rust desktop shell. Listeners see nothing; the owner sees fewer surprise breakages and a security
tab that is actually populated.

Non-goals: Renovate (one bot only); auto-merge; Kotlin CodeQL on every PR (too slow; weekly optional job); changing
how the APK or desktop builds are signed or published; SBOM generation.

## 2. Evidence

| Fact | Where |
| --- | --- |
| Five workflows, no Dependabot/Renovate/CodeQL config | `.github/workflows/{ci,desktop,mobile-apk,mobile-ci,mobile-smoke}.yml`; no `.github/dependabot.yml` |
| Mutable tags everywhere: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-java@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `gradle/actions/setup-gradle@v4`, `reactivecircus/android-emulator-runner@v2`, `Swatinem/rust-cache@v2` | `rg "uses:" .github/workflows` (2026-11-13) |
| Backlog CI-002 asks for full-SHA pins, publish-only write permissions, and an infra test rejecting unpinned `uses:` | `audit/FIX-BACKLOG.md:431-446` |
| One root lockfile for npm workspaces; `apps/mobile` has its own lockfile; desktop has its own `Cargo.lock` | `CLAUDE.md` Repo section; `tests/infra/infra-files.test.mjs:43` |
| Changes under `packages/**`, `convex/_generated/**` or `.github/workflows/mobile-apk.yml` rebuild the APK, which requires an `expo.version` bump | `.github/workflows/mobile-apk.yml:10-27`, `CLAUDE.md` Commits |
| Media3 must equal the version expo-video/expo-audio are built for | `apps/mobile/android/app/build.gradle:211-218` |
| Infra tests live in `tests/infra/*.test.mjs` and run in `npm test` | `package.json` `infra:test` |

Behavioural reference: Echo ships `renovate.json` (recommended preset, ignore unstable, separate major/minor) and a
CodeQL workflow building Kotlin with autobuild (`Echo-Music/renovate.json`, `Echo-Music/.github/workflows/codeql.yml`).
Config files are not copyrightable logic in any meaningful sense, but write Allegra's own anyway.

External facts (accessed 2026-11-13):
- Dependabot ecosystems: `npm` (v7-v12, also yarn), `cargo`, `gradle`, `github-actions`; `directories` for several
  manifest folders; `groups` with `patterns`, `exclude-patterns`, `dependency-type`, `update-types` (minor, patch, major),
  `applies-to` (version-updates / security-updates), `group-by: dependency-name`; `cooldown` with `default-days`
  (Dependabot default 3), `semver-major-days`, `semver-minor-days`, `semver-patch-days`, `include`, `exclude`.
  https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference
- CodeQL build modes: `none` is used by default for C/C++, C#, Java and Rust; Kotlin needs a build; `java-kotlin` with
  `build-mode: none` analyses Java only and warns about Kotlin.
  https://docs.github.com/en/code-security/code-scanning/creating-an-advanced-setup-for-code-scanning/codeql-code-scanning-for-compiled-languages
- UNVERIFIED: repository visibility. Code scanning on a private repository needs GitHub Advanced Security / Code Security.
  Verification step: `gh repo view peterish8/allegra --json visibility`. If private and unlicensed, ship only the
  Dependabot and pin PRs.
- UNVERIFIED: the current commit SHAs and latest major tags of each Action. Never write a SHA from memory; resolve them in
  step 1 with `gh api`.

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| Dependabot, not Renovate | Native to GitHub, no app install, updates SHA-pinned Actions with version comments |
| Weekly schedule (Monday 03:00 Asia/Kolkata), `open-pull-requests-limit: 5`, cooldown 7 days (majors 14) | Small review load; a cooling-off week avoids freshly published compromised versions |
| One group per ecosystem for minor+patch; majors ungrouped | Majors need a human; minors batch |
| Separate entries: root npm (`/`), mobile npm (`/apps/mobile`), Gradle (`/apps/mobile/android`), Cargo (`/apps/desktop`), Actions (`/`) | Matches the three lockfiles; the root entry only ever touches the root `package-lock.json` (one-lockfile rule) |
| Mobile npm: ignore `expo`, `expo-*`, `@expo/*`, `react`, `react-native`, `react-native-*` majors and minors | Expo SDK pins these together; upgrades go through `npx expo install --fix` (`upgrading-expo` workflow), not one-package bumps |
| Gradle: ignore `androidx.media3:*` entirely | Must match the expo-video/expo-audio Media3 version (`build.gradle:211-214`, `media3Version.test.ts`) |
| Labels: `dependencies` plus `needs-version-bump` on the mobile npm, Gradle and Cargo entries | A human adds the `expo.version` / `Cargo.toml` bump commit before merging (bot cannot follow the repo rule) |
| Pin every remote `uses:` to a full 40-char SHA with a `# vX.Y.Z` comment; infra test enforces | CI-002 |
| CodeQL: `javascript-typescript` (none), `actions` (none), `rust` (none) on PRs and weekly; `java-kotlin` weekly only, manual build | Fast PR feedback; Kotlin needs a Gradle build that takes minutes |
| CodeQL job permissions: `contents: read`, `security-events: write`, `actions: read` only | Least privilege |

Rejected: Renovate (second bot, more config surface); grouping majors (unreviewable); Dependabot auto-merge (repo
requires review by a non-author, `CLAUDE.md` Branching); Snyk/SaaS scanners (new third party, cost).

## 4. Exact change list

### 4.1 `.github/dependabot.yml` (create)

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly, day: monday, time: "03:00", timezone: "Asia/Kolkata" }
    open-pull-requests-limit: 5
    cooldown: { default-days: 7, semver-major-days: 14 }
    labels: [dependencies]
    groups:
      root-minor-patch:
        update-types: [minor, patch]
  - package-ecosystem: npm
    directory: "/apps/mobile"
    schedule: { interval: weekly, day: monday, time: "03:00", timezone: "Asia/Kolkata" }
    open-pull-requests-limit: 3
    cooldown: { default-days: 7, semver-major-days: 14 }
    labels: [dependencies, needs-version-bump]
    ignore:
      - dependency-name: "expo"
      - dependency-name: "expo-*"
      - dependency-name: "@expo/*"
      - dependency-name: "react"
      - dependency-name: "react-native"
      - dependency-name: "react-native-*"
    groups:
      mobile-minor-patch:
        update-types: [minor, patch]
  - package-ecosystem: gradle
    directory: "/apps/mobile/android"
    schedule: { interval: weekly, day: monday, time: "03:00", timezone: "Asia/Kolkata" }
    open-pull-requests-limit: 2
    cooldown: { default-days: 14 }
    labels: [dependencies, needs-version-bump]
    ignore:
      - dependency-name: "androidx.media3:*"
  - package-ecosystem: cargo
    directory: "/apps/desktop"
    schedule: { interval: weekly, day: monday, time: "03:00", timezone: "Asia/Kolkata" }
    open-pull-requests-limit: 2
    cooldown: { default-days: 7, semver-major-days: 14 }
    labels: [dependencies, needs-version-bump]
    groups:
      desktop-minor-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly, day: monday, time: "03:00", timezone: "Asia/Kolkata" }
    open-pull-requests-limit: 3
    cooldown: { default-days: 7 }
    labels: [dependencies]
    groups:
      actions:
        patterns: ["*"]
```

The two labels must exist (`gh label create dependencies`, `gh label create needs-version-bump`) or Dependabot skips them.
If the Gradle updater cannot parse `apps/mobile/android` (React Native's Gradle plugin needs `node_modules`), remove that
entry rather than adding install steps; note it in `docs/workflows.md`.

### 4.2 Pin Actions (all five workflows)

For each distinct `owner/repo@tag`, resolve the SHA of the latest release in the same major:

```bash
gh api repos/actions/checkout/releases/latest --jq .tag_name          # e.g. v4.x.y; stay on the major already used unless the PR is a deliberate upgrade
gh api repos/actions/checkout/git/ref/tags/<tag> --jq '.object.sha,.object.type'
# if type is "tag" (annotated), dereference:
gh api repos/actions/checkout/git/tags/<sha> --jq .object.sha
```

Replace `uses: actions/checkout@v4` with `uses: actions/checkout@<40-char-sha> # <tag>`. Do this for: `actions/checkout`,
`actions/setup-node`, `actions/setup-java`, `actions/upload-artifact`, `actions/download-artifact`,
`gradle/actions/setup-gradle`, `reactivecircus/android-emulator-runner`, `Swatinem/rust-cache` (and
`github/codeql-action/*` in 4.4). Same SHA everywhere for the same action. Do not change `with:` inputs.

Least privilege (CI-002 part two): in `mobile-smoke.yml`, move the step that publishes to the `smoke-latest` release into
its own job with `permissions: contents: write` and `needs:` the test job; give the test job `contents: read`. Keep the
existing `publish` jobs' `needs` exactly as they are (`launch-check` gate must stay, `apps/mobile/CLAUDE.md`).

### 4.3 `tests/infra/workflow-pins.test.mjs` (create; add it to `infra:test` in `package.json`)

```js
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const SHA = /^[0-9a-f]{40}$/;

test('every remote action is pinned to a full commit SHA with a version comment', async () => {
  const dir = new URL('../../.github/workflows/', import.meta.url);
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.yml')) continue;
    const text = await readFile(new URL(name, dir), 'utf8');
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(\s*#\s*(\S+))?/);
      if (!match || match[1].startsWith('./')) continue;
      const ref = match[1].split('@')[1] ?? '';
      assert.match(ref, SHA, `${name}:${index + 1} uses ${match[1]} (pin to a SHA)`);
      assert.ok(match[3], `${name}:${index + 1} needs a "# vX.Y.Z" comment`);
    }
  }
});
```

### 4.4 `.github/workflows/codeql.yml` (create)

```yaml
name: CodeQL
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "17 2 * * 1"
permissions:
  contents: read
concurrency:
  group: codeql-${{ github.ref }}
  cancel-in-progress: true
jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      actions: read
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript, actions, rust]
    steps:
      - uses: actions/checkout@<sha> # <tag>
      - uses: github/codeql-action/init@<sha> # <tag>
        with:
          languages: ${{ matrix.language }}
          build-mode: none
          config-file: ./.github/codeql/codeql-config.yml
      - uses: github/codeql-action/analyze@<sha> # <tag>
        with:
          category: "/language:${{ matrix.language }}"
```

`.github/codeql/codeql-config.yml` (create):

```yaml
paths-ignore:
  - "**/node_modules/**"
  - ".planning/**"
  - "audit/**"
  - "convex/_generated/**"
  - "apps/mobile/android/app/build/**"
  - ".claude/**"
```

Optional weekly Kotlin job (separate PR, `codeql-kotlin.yml`, `schedule` + `workflow_dispatch` only): Java 17, Node 22,
`npm ci --prefix apps/mobile`, `init` with `languages: java-kotlin`, `build-mode: manual`, then
`cd apps/mobile/android && ./gradlew :app:compileDebugKotlin --no-daemon`, then `analyze`. Reuse the setup steps from
`mobile-ci.yml:79-105` verbatim (Java/Gradle versions must match).

### 4.5 Docs

`docs/workflows.md`: a "Dependency updates" section: Dependabot schedule, the `needs-version-bump` label meaning
("add the `expo.version` or `Cargo.toml` bump commit before merging"), Media3 ignore reason, and how to read CodeQL alerts.

## 5. Implementation order

1. `chore/ci-pin-actions`: resolve SHAs (4.2), edit five workflows, add `workflow-pins.test.mjs`, bump `expo.version`
   (patch) and `apps/desktop/Cargo.toml` `version` (patch) because both workflows rebuild. Verify `npm run infra:test`, then
   watch every workflow on the PR go green (APK `launch-check` included).
2. `chore/ci-dependabot`: `dependabot.yml`, labels, docs. Verify: after merge, GitHub, Insights, Dependency graph,
   Dependabot shows each entry "Last checked" without errors; `gh api repos/:owner/:repo/dependabot/alerts` reachable.
3. `chore/ci-codeql`: visibility check first; `codeql.yml`, config. Verify the PR shows three CodeQL checks and the
   Security tab lists results. Triage: fix true positives in follow-up PRs; dismiss false positives with a reason.

## 6. Edge cases and failure modes

| Situation | Required behaviour |
| --- | --- |
| Dependabot opens a mobile PR | Labelled `needs-version-bump`; reviewer adds the bump commit; never merged without it |
| Dependabot root npm PR changes a package the API bundles | Normal CI (`npm ci`, typecheck, lint, test, build) must pass; Vercel preview checked for `/api/health` |
| A grouped PR fails | Split by closing it; Dependabot reopens singles when `@dependabot recreate` is used |
| An action's SHA belongs to a fork | Reject; only SHAs from the upstream repository (`gh api repos/<owner>/<repo>/commits/<sha>` must succeed) |
| CodeQL flags `convex/_generated` | Ignored by config |
| Private repo without GHAS | CodeQL upload fails; do not merge 4.4, keep 4.1-4.3 |
| Node `onnxruntime-node` postinstall | Dependabot runs its own install; the env var `ONNXRUNTIME_NODE_INSTALL: skip` lives in CI only; if Dependabot's update job fails on it, add `ignore` for `onnxruntime-node` minor/patch and update it by hand |

## 7. Test plan

- `tests/infra/workflow-pins.test.mjs`: `every remote action is pinned to a full commit SHA with a version comment`
  (fails today, passes after 4.2). Self-check: temporarily change one SHA to `v4`, the test must fail.
- Existing `tests/infra/infra-files.test.mjs` must pass (one lockfile, CI gates, mobile workflows at root).
- `npm run typecheck && npm run lint && npm test`.
- CI evidence: links to the green runs for every workflow on the pin PR.

## 8. Security, privacy and cost

Reduces risk (mutable tags, unreviewed updates). No secrets added. CodeQL is free for public repositories. Dependabot
PRs run CI minutes (weekly, capped by `open-pull-requests-limit`). The cooldown delays security fixes by up to 7 days;
security updates (`applies-to: security-updates`) are not delayed by version-update cooldown (UNVERIFIED; if they are,
add a `security-updates` group without cooldown).

## 9. Rollout and rollback

Each PR is independent. Rollback: delete `dependabot.yml` / `codeql.yml`; revert pins (the infra test goes too).
Evidence: green workflow runs, Dependabot status page, first CodeQL results.

## 10. Acceptance checklist

- [ ] No `uses:` with a tag or branch remains (infra test green).
- [ ] Every pin has a `# vX.Y.Z` comment and comes from the upstream repository.
- [ ] `publish` jobs still `needs: launch-check`; smoke publishing has its own write-scoped job.
- [ ] Dependabot entries match the three lockfiles; no new lockfile appears anywhere.
- [ ] Media3 and Expo SDK packages are ignored as specified.
- [ ] Pin PR bumps `expo.version` and the desktop `Cargo.toml` version.
- [ ] CodeQL only if the visibility/licence check passed.

Common mistakes: pinning a tag object SHA instead of the commit SHA (dereference annotated tags); letting Dependabot
bump Media3; forgetting that editing `mobile-apk.yml` rebuilds the APK (bump); adding `npm install` steps that create a
per-app lockfile.

## 11. Open questions (defaults)

1. Dependabot or Renovate? Default: Dependabot.
2. Kotlin CodeQL? Default: weekly optional job after the first three PRs.
3. Cooldown length? Default 7 days, majors 14.
4. Timezone for the schedule? Default Asia/Kolkata (the catalog and its listeners are India-focused); any timezone works.
