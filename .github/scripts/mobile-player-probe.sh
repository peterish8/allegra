#!/usr/bin/env bash
# Drives the player on a connected emulator or phone and asserts the controls stay there and keep working
# (player-assertions.sh), for the blank-screen report: Now Playing left open, lyrics toggled after playback
# starts, repeated open/close/pause/skip, media keys with the screen off, and the queue coming back.
#
#   mobile-player-probe.sh <apk|-> <out-dir> [full|quick]
#
# `-` skips the install (the app is already on the device). Exit code is the number of failed checks.
# It never needs the app's own code to cooperate beyond lyricflow:// links (src/hooks/useDeepLinks.ts).
set -u
APK="${1:--}"
OUT="${2:-probe}"
MODE="${3:-full}"
PKG=com.lyricflow.app
mkdir -p "$OUT"
: > "$OUT/controls.txt"

ADB_BIN=$(command -v adb)
adb() { timeout 60 "$ADB_BIN" "$@"; }
step() { echo "== $(date +%H:%M:%S) $1" | tee -a "$OUT/controls.txt"; }
link() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null 2>&1; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; [ -s "$OUT/$1.png" ] || rm -f "$OUT/$1.png"; }

# shellcheck source=player-assertions.sh
source "$(dirname "${BASH_SOURCE[0]}")/player-assertions.sh"

QUICK=0; [ "$MODE" = quick ] && QUICK=1
PLAYER_CRASHES=0

if [ "$APK" != "-" ]; then
  adb install -r "$APK" >/dev/null
fi
adb logcat -c
"$ADB_BIN" logcat -v time > "$OUT/logcat-live.txt" 2>/dev/null &
LOGCAT_PID=$!
trap 'kill $LOGCAT_PID 2>/dev/null' EXIT

adb shell input keyevent KEYCODE_WAKEUP
adb shell am force-stop "$PKG"
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 25
link "lyricflow://diagnose"
sleep 2
# A song with no canvas video (the report is about those; a looping video also keeps uiautomator from ever
# reading the screen). The style link switches the video off too on builds that know `canvas=`.
PROBE_QUERY="${PROBE_QUERY:-Ucha%20Lamba%20Kad%20Anand%20Raaj%20Anand}"
link "lyricflow://style?canvas=0"
sleep 1

# -- A. A streamed song, Now Playing left open on the cover ---------------------------------------------------
step "A. streamed song, Now Playing on the cover"
link "lyricflow://play?q=$PROBE_QUERY"
sleep 12
assert_controls "A cover, just opened"
if [ "$QUICK" = 1 ]; then soak_player 30 5 "A cover"; else soak_player 60 5 "A cover"; fi
assert_responsive "A cover"
shot A-cover

# -- B. Lyrics switched on after playback started, then off ---------------------------------------------------
step "B. lyrics toggled after playback started"
# The emulator runs with animations off, which the app reads as Reduce Motion: lyrics then jump instead of gliding,
# and the glide's UI-thread code never ran in CI. It threw on real phones (glideStep's GLIDE_SMOOTH_S) and killed the
# screen. Animations are on for this section, so the glide runs here as it does on a phone.
adb shell settings put global animator_duration_scale 1
adb shell settings put global transition_animation_scale 1
adb shell settings put global window_animation_scale 1
link "lyricflow://player?lyrics=1"
sleep 4
assert_controls "B lyrics just opened"
soak_player 30 5 "B lyrics"
assert_responsive "B lyrics"
shot B-lyrics
ui_dump && b=$(desc_bounds 'Hide lyrics') && [ -n "$b" ] && tap_bounds "$b"
sleep 3
assert_controls "B lyrics hidden again"
soak_player 15 5 "B back on the cover"
# The glide ran for 30 s of lyrics above: the screen must still be the app's own (not dead, not restarted).
assert_alive "B"
adb shell settings put global animator_duration_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global window_animation_scale 0

# -- C. Repeated open / close / pause / skip -------------------------------------------------------------------
step "C. repeated open, close, pause and skip"
for round in 1 2 3 4 5; do
  adb shell input keyevent KEYCODE_BACK
  sleep 2
  ui_dump && b=$(desc_bounds 'Now playing:.*') && [ -n "$b" ] && tap_bounds "$b"
  sleep 3
  assert_controls "C round $round, reopened"
  ui_dump && b=$(desc_bounds 'Next') && [ -n "$b" ] && tap_bounds "$b"
  sleep 3
  assert_controls "C round $round, after Next"
done
assert_responsive "C after the rounds"
assert_alive "C"

# -- D. Media keys with the screen off -------------------------------------------------------------------------
step "D. next and previous from the media session with the screen off"
screen_off
assert_key_changes_song "D screen off" KEYCODE_MEDIA_NEXT
sleep 2
assert_key_changes_song "D screen off" KEYCODE_MEDIA_PREVIOUS
screen_on
sleep 3
assert_controls "D screen back on"
assert_alive "D"

# -- E. The queue comes back after the app is killed, and the screen follows the engine -------------------------
step "E. queue restored after the app is killed; the screen follows the engine in the foreground"
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell input keyevent KEYCODE_MEDIA_NEXT
sleep 4
adb shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 6
ui_dump
shown=$(pill_title)
engine=$(session_title)
_record "E foreground return: the screen shows '$shown', the media session says '$engine'"
case "$engine" in *"$shown"*) [ -n "$shown" ] && _record "ok: E the screen followed the engine" || _record "FAIL: E no song on screen after returning" ;; *) _record "FAIL: E the screen shows a different song than the engine plays" ;; esac

adb shell am force-stop "$PKG"
sleep 3
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 20
ui_dump
restored=$(pill_title)
if [ -n "$restored" ]; then
  _record "ok: E after a kill and a relaunch the player shows '$restored'"
  ui_dump && b=$(desc_bounds 'Now playing:.*') && [ -n "$b" ] && tap_bounds "$b"
  sleep 3
  before="$restored"
  ui_dump && b=$(desc_bounds 'Next') && [ -n "$b" ] && tap_bounds "$b"
  sleep 4
  ui_dump
  after=$(pill_title)
  _record "E next after the restore: '$before' -> '$after'"
  [ -n "$after" ] && [ "$after" != "$before" ] && _record "ok: E the restored queue has more than the one song" || _record "FAIL: E the restored queue did not move to another song"
else
  _record "FAIL: E nothing was restored: no song after a kill and a relaunch"
fi
assert_controls "E after the restore"
assert_alive "E"

step "done: $PLAYER_FAILS failed checks"
adb logcat -d -v time > "$OUT/logcat.txt" 2>/dev/null
grep -F "[diag:" "$OUT/logcat.txt" > "$OUT/diag.txt" || true
exit "$PLAYER_FAILS"
