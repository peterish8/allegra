# 03-04 Summary: privacy text and policy version

## Changes

- `apps/web/src/components/LegalPage.tsx`: the guest paragraph names "your most-played songs";
  "What we keep" adds "The up to {TALLY_MAX_SONGS} songs you play most on Allegra, and roughly how
  much you play each. A song you stop playing fades and drops off."; "How long" adds "Your
  most-played list keeps at most {TALLY_MAX_SONGS} songs. Older listening counts for less over time,
  and a song you stop playing drops off."; "Stop the learning" now says it erases "including your
  most-played list". The number comes from `TALLY_MAX_SONGS` in `packages/shared/blendDecay.ts`
  (renders as 200), so the page and the cap cannot drift; the plan's literal grep for "200 songs"
  therefore matches the rendered page, not the source.
- `packages/shared/legal.ts`: `POLICY_VERSION = '2026-10-05'` (was `2026-10-02`); `npm run sync:shared`
  regenerated `apps/api/src/shared/legal.ts`. Import and Blend disclosures added later in this
  milestone use the same date, since none of it has shipped yet.

## Who reads POLICY_VERSION, and what a mismatch does (unchanged)

| Reader | Behaviour on a new version |
|---|---|
| `apps/api/src/routes/account.ts` `POST /api/me/consent` | Accepts only the current version (400 otherwise); records it with server time. Export reports it. |
| `apps/web/src/lib/consent.ts` | A pending tick from the sign-in dialog is honoured only if it was for the current version. |
| `apps/web/src/components/ProfileSheet.tsx` | If the stored consent is for an older version, the account panel shows the age/terms checkbox and "Record my agreement" instead of "Agreed to policy … on …". No blocking prompt or banner. |
| `apps/web/src/lib/api.ts` `recordConsent` | Always sends the current version. |
| `apps/mobile/src/services/account/AccountProvider.tsx` + `allegraApi.ts` | Consent is asked in the sign-in sheet and sent once after sign-in; an existing session with an older version is **not** re-prompted. |
| Convex | Stores whatever the API recorded; no version check. |

So existing listeners see nothing forced: web shows the re-agree control in the account panel;
mobile shows nothing until the next sign-in.

## Verification

- Full gate after phases 03–04: `npm run typecheck`, `npm run lint`, `npm test` — exit 0 (API 242,
  web 98, connect 81, shared 73, infra 20, redirect 4, Convex Vitest 46).

## Checkpoint (open)

The plan's human-verify checkpoint (the owner reading :5173/privacy and approving the
existing-listener behaviour above on web and phone) has not happened. Recorded as an owner action
in STATE.md.
