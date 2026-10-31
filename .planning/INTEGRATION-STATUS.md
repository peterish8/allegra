# Integration status and agent context

Updated 2026-10-30 from checkout `t3/audit-docs-graft-refresh` at `b76990442a56`.
This is a documentation baseline, not a release report. Product changes in adjacent worktrees are
not included until integrated and verified here. No application source or generated Convex files
were changed during this pass.

## Integration recheck after coding work lands

Use the current working tree and exact commits as evidence. Keep a row `IN_PROGRESS` until its
listed checks have been run; implementation notes, another worktree's green tests, and old handoffs
do not establish integration.

| Area | Existing evidence and known stale claims | Final integration check |
|---|---|---|
| LuvLink | [`luvlink-contract.md`](../docs/luvlink-contract.md) describes the Convex transport and legacy Echo compatibility contract. [`luvlink/CHECKLIST.md`](./luvlink/CHECKLIST.md) is the detailed ongoing checklist. [`luvlink/HANDOFF.md`](./luvlink/HANDOFF.md) is an Oct 6 snapshot and its branch, test counts, APK and deployment notes are historical. | Reconcile every checklist row with integrated source; re-run named root/mobile/Convex checks. Verify cold/warm links, auth return, legacy invite compatibility, browser UX, emulator and physical-device/background behavior. Leave audible drift and two-device claims unverified without those measurements. |
| Spotify and Blend | [`blend/STATE.md`](./blend/STATE.md) says the implementation merged in October, but its remaining table is explicitly historical. [`blend/HANDOFF-2026-10-05.md`](./blend/HANDOFF-2026-10-05.md) records branches, PRs, APK and configuration as-of Oct 5 only. The Spotify portions of [`api-contract.md`](../docs/api-contract.md) describe interfaces, not current provider availability or production configuration. | Confirm integrated Git history and routes/UI; run Spotify tests against current API shapes and configuration. Verify OAuth, playlist import/resume and Blend behavior in the intended environment. A passing mock/unit suite is not Spotify account or production proof. |
| Android Kotlin/native migration | [`performance-kotlin/MASTER-PLAN.md`](./performance-kotlin/MASTER-PLAN.md) is a plan, not a full migration claim. [`performance-kotlin/VERIFICATION.md`](./performance-kotlin/VERIFICATION.md) records a bounded Oct 4 verification; it explicitly leaves native visual acceptance, physical-device performance and wider migration work open. | Inspect the integrated native ownership and changed Kotlin files; run applicable Kotlin/native tests and build. Record release-device visual and performance evidence separately. Do not present a plan, TypeScript suite, emulator startup or JS smoke as completed Kotlin migration or measured app-wide speedup. |

## Memory and codebase-context setup

Use separate layers for separate jobs; keep the default context short.

1. **Stable rules:** keep root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md) for repo-wide setup, invariants and commands. Add a nested `AGENTS.md` only when a subtree needs distinct rules. Codex documents layered, repository-scoped `AGENTS.md` guidance ([official guide](https://developers.openai.com/codex/agent-configuration/agents-md)). Keep this root file's ordered orientation as the source of truth; update it only when commands or architecture actually change.
2. **Navigable durable facts:** keep one short status/decision page per active initiative, with date, exact branch/commit, evidence tier, open checks and links to detail. This page is the cross-session integration index; area-specific plans remain authoritative for their work. Refresh statuses only from the current integrated checkout.
3. **Structural code retrieval:** Graft 0.18.0 is already installed here. Its CLI supports `ask --source`, exhaustive `grep`, `skeleton`, `callers`, `map`, `build`, and `check`; its skill directs agents to query it before source exploration. Use Graft for symbol/call structure, and docs for project decisions. `graft/` is ignored by `.gitignore` and `git ls-files graft` is empty, so its index is local generated state, not a version-controlled handoff. `graft check` reported `STALE` with 238 changed source nodes in this checkout. I did not rebuild it while adjacent implementation work is active; refresh from the final integrated checkout, then run `graft check`. No `graft/` artifacts belong in the commit.
4. **Research:** use Firecrawl search for external, time-sensitive facts and scrape only needed pages. Include primary sources and URLs in the relevant planning note. Do not make crawls, paid provider calls or monitors part of agent startup. External research is not project memory.
5. **Codebase Memory MCP (installed on this machine):** Version `0.12.1` is installed under `%LOCALAPPDATA%\Programs\codebase-memory-mcp`. Its official installer configured user-level Codex and Claude Code MCP entries, skills, agents, and non-blocking search/session hooks. Both clients have since reported the server connected. This worktree is indexed as `allegra-t3-e4d29597` in full mode. Other checkout roots/worktrees need their own `index_repository` registration; do not assume this graph covers sibling worktrees. The setup uses the local MCP/index model ([project](https://github.com/DeusData/codebase-memory-mcp), [docs](https://deusdata.github.io/codebase-memory-mcp/)); do not add a second hosted semantic-memory service without a demonstrated gap.

For every handoff, write only durable facts: what changed, exact commit/worktree, commands actually run, outcomes, and remaining acceptance. Label claims `source`, `automated`, `browser`, `emulator`, `physical device`, or `release` so downstream agents do not promote weaker evidence into stronger claims. Never store credentials, tokens, private invite links or copied user data in these files.

## Tooling evidence and limitations

- `graft --version`: `0.18.0`.
- `graft check`: `STALE`; 238 source nodes changed. The checked-out graph snapshot is therefore not reliable as a current integrated map.
- `git ls-files graft`: empty; graph files are ignored local state.
- Codebase Memory MCP `0.12.1`: Codex and Claude Code user-level integrations installed; the supplied Codex and Claude MCP listings both show the server connected.
- Codebase Memory project `allegra-t3-e4d29597`: `ready`, 18,402 nodes, 76,696 edges, 65,011,712-byte index, indexed 2026-10-30. Full mode included docs. Status reported 10 `parse_partial` files (5 shown in summary, 5 omitted), 0 unusable files, and 66 intentionally unindexed files/assets. Check exact paths with `index_status --diagnostics full` before relying on absence from the graph.
- Index auto-watch is currently `false` because this MCP session does not identify the checkout as its active project. After restarting a client in the checkout, check `index_status` again; otherwise refresh explicitly with `index_repository` after material edits.
- No Graft rebuild, build/test gate, browser check, emulator/device check, provider sign-in, deployment, push or release was performed for this documentation pass.
- The Firecrawl search surfaced the Graft project description and the official Codex `AGENTS.md` guide. Graft command semantics above were confirmed from this machine's installed `graft --help` and `C:\Users\nithy\.agents\skills\graft\SKILL.md`; external pages are references, not runtime evidence.
