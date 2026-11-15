# Owner checklist (the orchestrator appends; the owner clears)

## PRs waiting for the owner (HOLD)

(none yet)

## Device checks no CI or emulator can prove (batch these into one phone session)

- [ ] TalkBack reads the new controls: (list added by each mobile card)
- [ ] 200% system font on a physical phone: Library, Settings, Playlists toggle, mini player
- [ ] Low-end frame rate readout (Settings, About, M31 readout) after the mini-player and player cards
- [ ] HEVC canvas video still plays (emulator cannot decode it)
- [ ] Real-phone scrub of the mini player and the playlist cover flip

- [ ] 1.60.1 (merged, #92): on a phone that had the Play Protect / Google Pay problem, install over the old app without uninstalling and record: any Play Protect dialog (expect no "App blocked"; "scan recommended" may still show), "LuvLyrics island" gone from Accessibility and LuvLyrics gone from Notification access, then open Google Pay to its home screen and note exactly what it shows (no payment or bank data). Then check playback, lock-screen controls, voice search, scanner and cover picking. A fresh browser install on a second phone: record every dialog. Log in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`. If Play Protect still blocks, appeal at https://support.google.com/googleplay/android-developer/contact/protectappeals. Never tell listeners to turn Play Protect off.
- [ ] 1.60.2 (#97): a phone on 1.60.0 or 1.60.1 still has the old update check and needs one manual install; after that About → Updates should find updates (it no longer uses GitHub's rate-limited API).

## Owner decisions needed

- **Release APK is signed with the public "Android Debug" certificate** (SHA-256 `fac61745…033b9c`). Anyone can sign an APK with it, which weakens the in-app updater's signer check and may count against the app in Play Protect. Moving to a private key means existing installs cannot upgrade in place and `apps/web/public/.well-known/assetlinks.json` must change with it; it needs a planned migration. Not done. Check `vars.ANDROID_RELEASE_CERT_SHA256` and the signing secrets first.
- 1.60.1 removed the floating island over other apps and "Play here" (needed to stop the Play Protect block).

## Decisions made on the owner's behalf (defaults applied)

(each worker's "Decisions I made for the owner" is copied here)
