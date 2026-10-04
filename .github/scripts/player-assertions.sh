#!/usr/bin/env bash
# What a listener needs from the open player, asserted — not "the audio kept playing", not "a screenshot was
# saved". A blank screen with sound still playing was reported on a phone, and neither of those notices it.
#
# Sourced by mobile-android-smoke.sh (CI) and mobile-player-probe.sh (a local emulator or a phone). The caller
# provides: adb (a function or the binary), $OUT (a directory), $PKG, and optionally link(), shot() and step().
# Every check appends "ok: ..." or "FAIL: ..." to $OUT/controls.txt and counts the failures in $PLAYER_FAILS.
#
# The transport labels are the app's own accessibility labels (components/NowPlayingControls.tsx): Previous,
# Play / Pause, Next, and "Song position" for the scrubber.

PLAYER_FAILS=0
PKG="${PKG:-com.lyricflow.app}"

_record() {
  echo "$1" | tee -a "$OUT/controls.txt"
  case "$1" in FAIL*) PLAYER_FAILS=$((PLAYER_FAILS + 1)) ;; esac
}

_slug() { echo "$1" | tr -c 'A-Za-z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//'; }

_snap() {
  if type shot >/dev/null 2>&1; then shot "$1"; else adb exec-out screencap -p > "$OUT/$1.png"; fi
}

# Reads the screen's accessibility tree into $OUT/ui.xml. Continuous animation can keep uiautomator from ever
# seeing an idle UI, so it is retried; if it never reads, that is reported by the caller, not hidden.
ui_dump() {
  for _ in 1 2 3; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    if adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 && grep -q "<hierarchy" "$OUT/ui.xml" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# "left top right bottom" of the first view whose accessibility label matches the regex $1, from the last dump.
desc_bounds() {
  grep -o "content-desc=\"\($1\)\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$OUT/ui.xml" 2>/dev/null \
    | head -n 1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9][0-9]*' | tr '\n' ' '
}

tap_bounds() {
  set -- $1
  [ $# -eq 4 ] || return 1
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

# Play or Pause: what the transport button says right now (the state it would switch to), from the last dump.
transport_label() {
  grep -o 'content-desc="\(Play\|Pause\)"' "$OUT/ui.xml" 2>/dev/null | head -n 1 | sed 's/content-desc="//; s/"//'
}

# The playing song as the media session (notification, lock screen, Bluetooth) sees it.
session_title() {
  adb shell dumpsys media_session 2>/dev/null | grep -A 40 "package=$PKG" | grep -m 1 "description=" | sed 's/^ *//'
}

session_state() {
  adb shell dumpsys media_session 2>/dev/null | grep -A 12 "package=$PKG" | grep -m 1 -o "state=[A-Z_]*" | head -n 1
}

# The song in the mini player's label ("Now playing: <title>. Open player"), from the last dump.
pill_title() {
  grep -o 'content-desc="Now playing: [^"]*"' "$OUT/ui.xml" 2>/dev/null | head -n 1 | sed 's/content-desc="Now playing: //; s/\. Open player"//'
}

# The visible transport controls are there. Fails with the screen's tree and a picture kept beside the log.
assert_controls() {
  local ctx="$1" tag missing="" nodes
  tag=$(_slug "$ctx")
  if ! ui_dump; then
    _record "FAIL: $ctx: the screen could not be read at all"
    _snap "fail-$tag"
    return 1
  fi
  for d in Previous Next; do
    grep -q "content-desc=\"$d\"" "$OUT/ui.xml" || missing="$missing$d "
  done
  grep -Eq 'content-desc="(Play|Pause)"' "$OUT/ui.xml" || missing="${missing}Play/Pause "
  nodes=$(grep -c "package=\"$PKG\"" "$OUT/ui.xml")
  if [ -n "$missing" ]; then
    _record "FAIL: $ctx: controls missing: ${missing}(app nodes on screen: $nodes)"
    cp "$OUT/ui.xml" "$OUT/fail-$tag.xml"
    _snap "fail-$tag"
    return 1
  fi
  _record "ok: $ctx: controls present (app nodes: $nodes, transport says: $(transport_label))"
}

# The controls do something: a real tap on Play / Pause flips the button, and the tap back restores it. This is
# what a frozen or blank screen cannot do while the audio plays on.
assert_responsive() {
  local ctx="$1" tag before after b i
  tag=$(_slug "$ctx")
  ui_dump || { _record "FAIL: $ctx: the screen could not be read to tap it"; return 1; }
  before=$(transport_label)
  b=$(desc_bounds 'Play\|Pause')
  if [ -z "$before" ] || [ -z "$b" ]; then
    _record "FAIL: $ctx: no Play/Pause control to tap"
    _snap "fail-$tag"
    return 1
  fi
  tap_bounds "$b"
  after="$before"
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    ui_dump && after=$(transport_label)
    [ "$after" != "$before" ] && break
  done
  if [ "$after" = "$before" ]; then
    _record "FAIL: $ctx: tapping $before did nothing (the button still says $before)"
    _snap "fail-$tag"
    return 1
  fi
  _record "ok: $ctx: tapping $before switched the transport to $after (media session ${after:+$(session_state)})"
  # Put it back, so the next check starts from the same place.
  b=$(desc_bounds 'Play\|Pause')
  [ -n "$b" ] && tap_bounds "$b"
  sleep 2
}

# The controls stay up for `$1` seconds, checked every `$2`. This is the 3-4 s / 10-15 s blank-screen window.
soak_player() {
  local total="$1" every="$2" ctx="$3" t=0
  while [ "$t" -lt "$total" ]; do
    sleep "$every"
    t=$((t + every))
    assert_controls "$ctx after ${t}s"
  done
}

# A media key reaches the app's session the way a headset, the notification or the lock screen does, with
# whatever the screen is doing. The song the session reports must change.
assert_key_changes_song() {
  local ctx="$1" key="$2" before after i
  before=$(session_title)
  adb shell input keyevent "$key"
  after="$before"
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    after=$(session_title)
    [ "$after" != "$before" ] && break
  done
  if [ "$after" = "$before" ] || [ -z "$after" ]; then
    _record "FAIL: $ctx: $key did not change the song (session says: ${after:-nothing})"
    return 1
  fi
  _record "ok: $ctx: $key changed the song ($before -> $after)"
}

screen_off() { adb shell input keyevent KEYCODE_SLEEP; sleep 2; }
screen_on() { adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard >/dev/null 2>&1; sleep 2; }

# The app process is alive and has not crashed since the last check.
assert_alive() {
  local ctx="$1" n
  if ! adb shell pidof "$PKG" >/dev/null 2>&1; then
    _record "FAIL: $ctx: the app is not running"
    return 1
  fi
  n=$(adb logcat -d -b crash 2>/dev/null | grep -c "Process: $PKG")
  if [ "${n:-0}" -gt "${PLAYER_CRASHES:-0}" ]; then
    PLAYER_CRASHES=$n
    _record "FAIL: $ctx: the app crashed"
    adb logcat -d -b crash 2>/dev/null | grep -A 8 "Process: $PKG" | tail -n 9 >> "$OUT/controls.txt"
    return 1
  fi
  _record "ok: $ctx: the app is running"
}
