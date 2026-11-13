# LuvLyrics Android permissions audit (2026-11-13)

Why: listeners reported that Google Play Protect blocked installing the LuvLyrics APK, and that Google Pay refused
payments until LuvLyrics was uninstalled (an accessibility warning). This document records what the shipped APK
asked for, why, what this change removes, what it costs, and what still needs a real phone to prove.

## Short answer

The shipped APK declared two services that Google treats as financial-fraud risk when an app is sideloaded:

1. **An accessibility service** (`island.IslandService`, `BIND_ACCESSIBILITY_SERVICE`). It drew the system-wide
   "island" around the camera over other apps. It read no screen content (`canRetrieveWindowContent=false`, no event
   types, `onAccessibilityEvent` and `onInterrupt` did nothing), but the declaration alone is the trigger.
2. **A notification listener** (`island.OutsideListener`, `BIND_NOTIFICATION_LISTENER_SERVICE`). It existed only so
   Android would hand over the list of other apps' media sessions for the island's "Play here". Its callbacks did
   nothing.

Google's developer guidance for Play Protect (last updated 2026-08-18) says that an app installed from a browser,
messaging app or file manager that declares `RECEIVE_SMS`, `READ_SMS`, a notification listener or an accessibility
service is considered high-risk and **Play Protect automatically blocks the installation**
([source](https://developers.google.com/android/play-protect/warning-dev-guidance#app-blocked)). LuvLyrics is
distributed exactly that way (GitHub release `apk-latest`).

Google Pay India's help says payments are paused when "unknown or unauthorised app(s) with active accessibility
permissions" are on the phone, and the fix is to switch that app's accessibility off or uninstall it
([source](https://support.google.com/pay/india/answer/17165523?hl=en-GB)). Google Pay follows the NPCI Mobile
Application Security Framework 2025 and also blocks when it finds apps it considers unsafe
([source](https://support.google.com/pay/india/answer/16886058?hl=en)). A listener who had turned the LuvLyrics island
on had a non-Play app with an active accessibility service, which matches the Google Pay rule.

This change removes both services, the island feature they powered, and the broad photo, video and overlay access
that libraries merged in. **Nothing here is proven fixed on a phone yet**: the Play Protect and Google Pay checks
below are pending until someone runs them on a real affected device.

## Shipped artifact (before)

Audited from the published release, not from source.

| Field | Value |
|---|---|
| Release | `apk-latest`, "LuvLyrics 1.60.0 — latest build", published 2026-11-13T07:08:06Z |
| Built from | `bf78a9a941054bd84c87a85a7e9aed7184c93f7c` |
| APK SHA-256 | `7698ff664cb0447d3ec492dd5144c55e3baf997d74c00e44a34c7ddbe3e837af` |
| Package / version | `com.lyricflow.app`, versionName 1.60.0, versionCode 1060000 |
| SDK | min 24, target 36, compile 36 |
| Debuggable | no (`aapt dump badging` shows no `application-debuggable`) |
| Signer | `CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |

Commands: `aapt dump badging`, `aapt dump xmltree … AndroidManifest.xml`, `apksigner verify --print-certs`
(build-tools 36.0.0).

## Permissions and services: before → after

"Source" is `android/app/src/main/AndroidManifest.xml`. "Merged" is what the shipped APK contained. Runtime
permissions are asked only when the listener uses the feature; Android shows the system dialog then.

| Permission / service | Source | Merged APK | Real feature | Sensitivity, data access | After this change | When the listener sees it |
|---|---|---|---|---|---|---|
| `IslandService` (`BIND_ACCESSIBILITY_SERVICE`) | yes | yes | System-wide island over other apps | Highest. The declaration lets an enabled service read screens and act for the user. Ours read nothing. Triggers the Play Protect block and the Google Pay pause | **Removed** (service, class, config XML, settings link) | Was: Settings → Accessibility, after "Allow restricted settings" |
| `OutsideListener` (`BIND_NOTIFICATION_LISTENER_SERVICE`) | yes | yes | Island "Play here": take over a song another app plays | Highest. An enabled listener can read every notification, including OTPs. Ours read none. Triggers the Play Protect block | **Removed** | Was: Settings → Notification access |
| `SYSTEM_ALERT_WINDOW` | yes | yes | Nothing in release code draws over other apps | High (overlay) | **Removed**, stripped with `tools:node="remove"` (React Native debug builds keep it from `src/debug`) | Never asked |
| `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED` | yes | yes | Playlist cover / scan-from-image pickers | Medium: the whole photo and video library | **Removed and stripped.** Pickers use Android's photo picker (`launchImageLibraryAsync`), which needs no permission on Android 13+ | Never asked now |
| `RECORD_AUDIO` | yes | yes | Voice search (hold the mic) | Medium. Audio goes to Android's speech recognizer (on-device first on Android 12+). The app does not record or upload it | Kept | First mic press (`useVoiceCommands`) |
| `CAMERA` | yes | yes | Scan a LuvLyrics code | Medium. Stills decoded on the phone, nothing uploaded | Kept | When the scanner opens |
| `READ_MEDIA_AUDIO` | yes | yes | Settings → import songs on this phone | Medium: audio files only | Kept; the request now names audio only (`requestPermissionsAsync(false, ['audio'])`) | On that tap |
| `READ_EXTERNAL_STORAGE` | yes | yes (max SDK 32) | Same, Android 12 and older | Medium | Kept (Android 12 and older only) | On that tap |
| `WRITE_EXTERNAL_STORAGE` | yes | yes (no max) | expo-media-library only grants reads on Android ≤ 12 when write is granted too | Medium | Kept, now **capped at Android 12** (`maxSdkVersion="32"`) | With the import request on old phones |
| `REQUEST_INSTALL_PACKAGES` | yes | yes | About → Update app (`AppUpdaterModule`, `RescueActivity`) | High: can open the installer. It cannot install silently: Android asks "install unknown apps" once and confirms every install | Kept | First update; Android's own pages |
| `WRITE_SETTINGS` | yes | yes | Player ••• → Set as ringtone | Medium: system settings | Kept | Android's "Modify system settings" page, on that tap |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK` | yes | yes | Background playback, media notification | Normal | Kept | Never asked |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `MODIFY_AUDIO_SETTINGS`, `VIBRATE` | yes | yes | Streaming, network recovery, volume, haptics | Normal | Kept | Never asked |
| `RECEIVE_BOOT_COMPLETED` | no | yes | WorkManager (downloads, updater) | Normal | Kept (library) | Never asked |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | no | yes | expo-secure-store | Normal | Kept (library) | Never asked |
| `PlaybackService` (exported, MediaSessionService) | yes | yes | Media notification, lock screen, Bluetooth, Android Auto | Required by Media3 | Kept | — |

Not present before or after: SMS, contacts, call log, phone state, location, `QUERY_ALL_PACKAGES`, device admin.
A music app needs none of them.

## What the listener loses

- **The system-wide island around the camera** (the floating pill over other apps, with its player, lyrics strip,
  playlists, search, size and style settings). Android only lets an accessibility service draw above the status
  bar, so there is no least-privilege way to keep it. An always-on overlay (`SYSTEM_ALERT_WINDOW`) would still be
  sensitive and was rejected.
- **"Play here" / "Continue here"**: picking up a song another app is playing. It needed the notification listener.
- Settings → Island disappears (it hides itself when the native module is gone).

What stays the same: the in-app player, its glow, lyrics, queue, widgets, the system media notification, lock-screen
and Bluetooth controls (MediaSession), voice search, the code scanner, local import, updates and ringtone. TalkBack
users are unaffected: they use Android's own accessibility services, not ours.

The ordinary media notification and lock-screen controls already cover "control music from anywhere". Several
phones (HyperOS, ColorOS, OriginOS, MagicOS) also show the MediaSession in their own camera-area island without any
extra permission.

## Phones updating from 1.60.0 or older

- The new APK no longer declares either service, so Android unbinds them during the update. Android only reports
  installed services as enabled, so Google Pay should stop seeing LuvLyrics as an accessibility app without an
  uninstall. That is expected behavior, not yet observed (see the checklist).
- `MainApplication` deletes the old `dynamic_island` preferences on start, so no stale switch survives.
- The JavaScript side calls every island function as optional and gets `null`/`false` when the module is missing,
  so nothing crashes and no settings link points at a page that no longer exists.

## Things this change does not fix (owner decisions)

1. **The release APK is signed with the public Android Debug certificate.** That key ships with every Android SDK,
   so anyone can sign an APK with it. Play Protect's classifiers may weigh that, and it also weakens the in-app
   updater's signer check. Moving to a private release key changes the app's identity: existing installs cannot
   upgrade in place (Android requires the same signer), and `assetlinks.json` must change with it. It needs a
   planned migration, not a silent change. Never re-sign just to dodge detection.
2. **Play Protect's "App scan recommended" / "unknown app" prompts can still appear** for any sideloaded app Play
   Protect has not seen before. Google says appeals do not remove the "send app for a security check" prompt.

## Five different things listeners can see (do not mix them up)

| What | Who shows it | Can we remove it? |
|---|---|---|
| Browser "This type of file can harm your device" | Chrome / the browser | No. Every APK download gets it |
| "Allow installing from this source" | Android (unknown-apps permission) | No. Required for any sideload |
| Play Protect "App scan recommended" / "unknown app" | Play Protect | Not guaranteed. Scanning sends the APK to Google |
| Play Protect "App blocked to protect your device" | Play Protect enhanced fraud protection | **Yes. Caused by the declared accessibility and notification-listener services, removed here** |
| "Restricted setting" when enabling accessibility | Android 13+ for sideloaded apps | Gone with the service. Never tell users to bypass it |
| Google Pay "payments blocked" / "device may not be secure" | Google Pay (NPCI framework) | **Accessibility trigger removed here.** Other device states are outside our control |

No developer can guarantee zero warnings or a silent install for a sideloaded APK.

## If Play Protect still blocks a clean build

1. Confirm the installed APK is the new one: About → version, and the CI `apk-permissions` artifact shows no
   accessibility or notification-listener service.
2. Check it against the Mobile Unwanted Software principles and the Potentially Harmful Applications definitions.
3. File an appeal: <https://support.google.com/googleplay/android-developer/contact/protectappeals> (linked from
   the [developer guidance](https://developers.google.com/android/play-protect/warning-dev-guidance#appeal-play-protect-warning)).
   Include the package name, the APK's SHA-256 and this audit's permission table.

Never ask listeners to turn Play Protect off, allow restricted settings, or ignore a warning. Google Pay's own
guidance tells people not to bypass Play Protect warnings, and we should not either.

## Honest permission copy for listeners

- Microphone: "LuvLyrics uses the microphone only while you hold the mic button, so Android can turn what you say
  into a search."
- Camera: "LuvLyrics uses the camera only on the scan screen, to read LuvLyrics codes. Photos stay on your phone."
- Music and audio: "LuvLyrics reads the audio files on this phone only when you tap Import, so they can play here."
- Install apps: "LuvLyrics asks Android to install updates you choose in About → Updates. Android asks you each time."
- Modify system settings: "Needed only to set a song as your ringtone."

## Physical-phone checklist (pending, not done)

Use a phone that showed the problem. Do not make real payments, open bank details or read financial data. Stop at
Google Pay's status screen.

1. Before updating, record: LuvLyrics version, whether Settings → Accessibility → Downloaded apps lists
   "LuvLyrics island" and whether it is on, and whether Google Pay shows a block screen when opened.
2. Install the new APK **over** the old one from About → Updates or the downloaded file. Do not uninstall.
3. Play Protect: note any dialog during install (text and screenshot). Expected: no "App blocked to protect your
   device". A "scan recommended" prompt may still appear.
4. Settings → Accessibility → Downloaded apps: "LuvLyrics island" should be gone. Settings → Notifications →
   Device & app notifications (notification access): no LuvLyrics entry.
5. `adb shell settings get secure enabled_accessibility_services` and
   `adb shell dumpsys accessibility | grep -i lyricflow` (if a cable is available): no bound LuvLyrics service.
6. Open Google Pay and stop at the home screen. Expected: no "payments blocked" or "device may not be secure"
   screen. Record exactly what it shows.
7. In LuvLyrics: play a song, lock the screen, use the notification controls, open Settings (no Island section),
   try voice search, the scanner and a cover pick.
8. Fresh install on a second phone from the browser: record every dialog in order.

Record results in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` with date, phone model and Android version.

## Guards added

- `apps/mobile/src/androidPermissions.test.ts`: the source manifest declares exactly the audited permissions,
  strips the broad ones, ships no accessibility or notification-listener service or class, app.json matches, the
  upgrade cleanup exists and the media scan asks for audio only.
- `.github/scripts/apk-permission-check.sh` in `mobile-apk.yml`: fails the build if the **merged** APK asks for
  any blocked permission, declares either service bind, or is debuggable; uploads `apk-permissions.txt`. Run
  against the shipped 1.60.0 it reports six failures (both services, the overlay and the three photo/video
  permissions).

## Sources

- Play Protect developer guidance: https://developers.google.com/android/play-protect/warning-dev-guidance
- Play Protect help: https://support.google.com/googleplay/answer/2812853?hl=en
- Google Pay India, payments blocked: https://support.google.com/pay/india/answer/17165523?hl=en-GB
- Google Pay India, security alerts and NPCI framework: https://support.google.com/pay/india/answer/16886058?hl=en
- Enhanced fraud protection rollout (Malaysia): https://blog.google/intl/en-my/company-news/technology/google-launches-enhanced-protection-in-google/
