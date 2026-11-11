# Starter prompt for Allegra Quick Picks

Copy everything below the line.

---

Resume the Allegra Quick Picks recommendation work in `C:/dev/allegra-lightfm` on `codex/lightfm-benchmark` when I ask you to continue. Build a local side-by-side preview of current Quick Picks and the LightFM-assisted ranking, then use the handoff to plan the live feedback and opt-in pilot. Work directly without subagents.

Start cold and read these files in order.

1. `C:/dev/allegra-lightfm/.planning/recommendations/HANDOFF-2026-11-11-lightfm-quick-picks.md`
2. `C:/dev/allegra-lightfm/AGENTS.md` and `C:/dev/allegra-lightfm/CLAUDE.md`
3. `C:/dev/allegra-lightfm/.planning/recommendations/PLAN.md`
4. `C:/dev/allegra-lightfm/tools/recommendations/README.md` and `C:/dev/allegra-lightfm/output/recommendations/enriched/benchmark.json`
5. `C:/dev/allegra-lightfm/docs/api-contract.md` and the platform rules for any files you change.

I approved LightFM, live reranking and the real-catalog benchmark. The offline model uses public JioSaavn playlist memberships. Use an explicitly selected playlist profile or test fixture for the preview. Keep the work local through the preview review point. Ask before production listener data, a scheduled job, a rollout, a push or a merge. The separate `C:/dev/allegra` checkout has unrelated edits.

1. Verify the branch, local artifacts and Python-to-TypeScript score parity. Keep the captured baseline cases and reports available.
2. Implement one local API and web slice. Compare the two rankings with the same playable candidates, language filter and exclusions. Verify fallback for unavailable model inputs, preserve the contract used by both recommendation URLs and MCP, and show both lists in the browser.
3. Run the relevant route tests, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd test`. If Android changes later, read its rules and run `npm.cmd run mobile:check`. Use the repo's version and release rules when an approved change is ready to publish.
4. Report the preview link, what you saw in the browser and what is still pending. Use the handoff's defaults for routine choices. Bring any unresolved choice to me once if it materially changes the experiment.
5. After preview review, work through live feedback, the opt-in listener pilot and the hosting decision in the handoff. Report results against the existing Quick Picks and catalog feature ranker before proposing activation.
