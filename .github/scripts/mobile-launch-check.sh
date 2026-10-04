#!/usr/bin/env bash
# The release gate (mobile-apk.yml): the APK must open. Nothing reaches apk-latest — the in-app updater's source —
# unless this passes on an emulator. 1.0.3 closed on every launch (MainApplication could not be constructed); a
# build like that leaves the listener with no app and no way to update it from the app.
#
#   mobile-launch-check.sh <apk> <out-dir>
#
# Checks, each on a cold start:
#   1. the process starts and stays up, with no crash for the app in the crash buffer
#   2. React draws and answers: a lyricflow:// link navigates (the app's own [diag:link] line says where it landed)
#   3. the screen layer never died (no "UiRecovery … React instance lost")
#   4. About opens from Stream and shows its Updates panel — the way out of a bad build must always work
#   6. Now Playing with animations on: the cover, then lyrics switched on, so UI-thread motion actually runs
#   5. all of it again after a force stop (the second start restores the saved queue and state)
# Exit code is the number of failed checks; results go to <out-dir>/launch.txt with logcat beside it.
set -u
APK="$1"
OUT="${2:-launch}"
PKG=com.lyricflow.app
mkdir -p "$OUT"
: > "$OUT/launch.txt"
FAILS=0

ADB_BIN=$(command -v adb)
adb() { timeout 60 "$ADB_BIN" "$@"; }
say() { echo "$1" | tee -a "$OUT/launch.txt"; }
ok() { say "ok: $1"; }
fail() { say "FAIL: $1"; FAILS=$((FAILS + 1)); }
link() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null 2>&1; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; [ -s "$OUT/$1.png" ] || rm -f "$OUT/$1.png"; }

ui_dump() {
  for _ in 1 2 3 4; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    if adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 && grep -q "<hierarchy" "$OUT/ui.xml" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
# Centre of the first view whose content-desc or text matches the regex $1, from the last dump.
centre_of() {
  grep -o -E "(content-desc|text)=\"($1)\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "$OUT/ui.xml" 2>/dev/null | head -n 1 \
    | grep -o -E 'bounds="[^"]*"' | grep -o -E '[0-9]+' | tr '\n' ' ' \
    | awk 'NF==4 { printf "%d %d", ($1+$3)/2, ($2+$4)/2 }'
}
crashes() { adb logcat -d -b crash 2>/dev/null | grep -c "Process: $PKG"; }
lost_ui() { adb logcat -d 2>/dev/null | grep -c "UiRecovery.*React instance lost"; }

check_start() {
  local ctx="$1" pid i landed xy found
  adb shell am force-stop "$PKG"
  adb logcat -c
  adb logcat -b crash -c 2>/dev/null || true
  adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1

  # 1. Up and still up 30 s later (a launch crash takes well under a second; a crash loop restarts the process).
  sleep 8
  pid=$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')
  sleep 22
  if [ -z "$pid" ] || [ "$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')" != "$pid" ]; then
    fail "$ctx: the app did not start, or died and restarted (pid '${pid}' -> '$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')')"
  else
    ok "$ctx: the app is running (pid $pid)"
  fi
  if [ "$(crashes)" -gt 0 ]; then
    fail "$ctx: the app crashed"
    adb logcat -d -b crash 2>/dev/null | grep -A 14 "Process: $PKG" | head -n 30 >> "$OUT/launch.txt"
  fi
  shot "$ctx-start"

  # 2. JavaScript is alive and the navigator answers.
  link "lyricflow://diagnose"
  sleep 2
  link "lyricflow://open/settings"
  landed=""
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    landed=$(adb logcat -d 2>/dev/null | grep -o "\[diag:link\] open/settings -> [A-Za-z]*" | tail -n 1)
    [ -n "$landed" ] && break
  done
  case "$landed" in
    *"-> Settings") ok "$ctx: a link navigates ($landed)" ;;
    *) fail "$ctx: a link did not navigate (${landed:-no answer from the app})" ;;
  esac
  shot "$ctx-settings"

  # 4. About, from Stream, with its Updates panel.
  link "lyricflow://open/stream"
  sleep 4
  xy=""
  ui_dump && xy=$(centre_of 'About LuvLyrics[^"]*')
  if [ -z "$xy" ]; then
    fail "$ctx: no About button on Stream"
    shot "$ctx-no-about"
  else
    adb shell input tap $xy
    sleep 3
    found=""
    for i in 1 2 3; do
      ui_dump && found=$(grep -o -E '(content-desc|text)="(Updates|Check for updates|Check again|Checking for updates|Update)"' "$OUT/ui.xml" | head -n 1)
      [ -n "$found" ] && break
      # The panel sits lower in the sheet: scroll it into view.
      adb shell input swipe "$SWIPE_X" "$SWIPE_FROM" "$SWIPE_X" "$SWIPE_TO" 300
      sleep 2
    done
    if [ -n "$found" ]; then ok "$ctx: About shows its Updates panel ($found)"; else fail "$ctx: About opened without its Updates panel"; fi
    shot "$ctx-about"
    adb shell input keyevent KEYCODE_BACK
    sleep 1
  fi

  # 3. The screen layer never died along the way.
  if [ "$(lost_ui)" -gt 0 ]; then
    fail "$ctx: the screen died (React instance lost)"
    adb logcat -d 2>/dev/null | grep -A 8 "UiRecovery.*React instance lost" | head -n 20 >> "$OUT/launch.txt"
  else
    ok "$ctx: the screen layer stayed up"
  fi
  if [ "$(crashes)" -gt 0 ]; then fail "$ctx: the app crashed after starting"; fi
  adb logcat -d -v time > "$OUT/logcat-$ctx.txt" 2>/dev/null
}

adb shell input keyevent KEYCODE_WAKEUP
adb install -r "$APK" >/dev/null || { fail "install: the APK did not install"; exit "$FAILS"; }
# A system permission dialog must not sit over the app while it is checked.
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
# Scroll gestures in screen pixels, whatever the emulator's size.
read -r SCREEN_W SCREEN_H <<<"$(adb shell wm size | grep -o -E '[0-9]+x[0-9]+' | tail -n 1 | tr 'x' ' ')"
SWIPE_X=$(( ${SCREEN_W:-1080} / 2 )); SWIPE_FROM=$(( ${SCREEN_H:-2400} * 4 / 5 )); SWIPE_TO=$(( ${SCREEN_H:-2400} * 3 / 10 ))
# A still background, so the accessibility tree settles for uiautomator (the shader never stops moving).
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 15
link "lyricflow://style?canvas=0&appBackground=glass"
sleep 2

check_start first

# 6. Now Playing as on a phone: animations on (the emulator's "off" reads as Reduce Motion, which skips the
#    UI-thread motion — the lyric glide that killed the screen in 1.0.2–1.0.4 never ran in CI). A streamed song opens
#    on the cover for 20 s (backdrop, glow, canvas), then lyrics are switched on in the open player, the way the
#    lyrics button does it, for 30 s. Without a network nothing plays and this proves nothing, but it never fails a
#    good build either.
adb shell settings put global animator_duration_scale 1
adb logcat -c
link "lyricflow://play?q=Blinding%20Lights%20The%20Weeknd"
sleep 20
shot player-cover
link "lyricflow://player?lyrics=1"
sleep 30
shot player-lyrics
if [ "$(lost_ui)" -gt 0 ]; then
  fail "player: the screen died in Now Playing (React instance lost)"
  adb logcat -d 2>/dev/null | grep -A 8 "UiRecovery.*React instance lost" | head -n 20 >> "$OUT/launch.txt"
elif [ -z "$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ] || [ "$(crashes)" -gt 0 ]; then
  fail "player: the app crashed in Now Playing"
else
  ok "player: 20 s on the cover and 30 s of gliding lyrics, screen alive"
fi
adb logcat -d -v time > "$OUT/logcat-player.txt" 2>/dev/null
adb shell settings put global animator_duration_scale 0

check_start second

say "== $FAILS failed checks"
exit "$FAILS"
