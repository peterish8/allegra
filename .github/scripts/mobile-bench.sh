#!/usr/bin/env bash
# Startup and frame-time benchmark for one LuvLyrics APK on a running emulator (mobile-bench.yml).
#
#   mobile-bench.sh <apk> <label> <out-dir> [runs]
#
# The APK must be built with the LLBench marker (mobile-bench.yml patches StartupModule.markHealthy to log
# "ready <ms since process start>" when React has drawn its first screen).
#
# For each ART state the APK is measured in:
#   fresh     straight after install: what a listener gets on the first opens after an update
#   dexopted  after one launch, a pause and `cmd package compile -m speed-profile`: what they get once the phone's
#             idle maintenance has run (this is where a Baseline Profile counts)
# it records, per cold start: `am start -W` TotalTime (first frame) and time to React ready. Then the Settings page
# is flung up and down with animations on and `dumpsys gfxinfo` gives janky % and frame-time percentiles.
#
# Rows go to <out-dir>/bench.tsv: label state metric run value. Emulator numbers compare builds; they are not a
# phone's numbers (docs/perf-low-end.md).
set -u
APK="$1"
LABEL="$2"
OUT="$3"
RUNS="${4:-12}"
PKG=com.lyricflow.app
mkdir -p "$OUT"
TSV="$OUT/bench.tsv"
[ -s "$TSV" ] || printf 'label\tstate\tmetric\trun\tvalue\n' > "$TSV"

ADB_BIN=$(command -v adb)
adb() { timeout 90 "$ADB_BIN" "$@"; }
row() { printf '%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$1" "$2" "$3" "$4" | tee -a "$TSV"; }

cold_start() {
  local state="$1" run="$2" total ready i
  adb shell am force-stop "$PKG"
  sleep 2
  adb logcat -c
  total=$(adb shell am start -W -n "$PKG/.MainActivity" 2>/dev/null | tr -d '\r' | awk -F': ' '/^TotalTime/ { print $2 }')
  ready=""
  for i in $(seq 1 40); do
    ready=$(adb logcat -d -s LLBench:I 2>/dev/null | grep -o 'ready [0-9]*' | head -n 1 | awk '{ print $2 }')
    [ -n "$ready" ] && break
    sleep 0.5
  done
  [ -n "$total" ] && row "$state" first_frame_ms "$run" "$total"
  [ -n "$ready" ] && row "$state" react_ready_ms "$run" "$ready"
  # Let the start settle (deferred boot jobs) so the next force-stop does not cut a write.
  sleep 4
}

frames() {
  local state="$1" run="$2" file size w h x y1 y2 i
  adb shell am force-stop "$PKG"
  adb shell am start -W -a android.intent.action.VIEW -d "lyricflow://open/settings" "$PKG" >/dev/null 2>&1
  sleep 8
  size=$(adb shell wm size | tr -d '\r' | grep -o '[0-9]*x[0-9]*' | tail -n 1)
  w=${size%x*}; h=${size#*x}
  x=$((w / 2)); y1=$((h * 3 / 4)); y2=$((h / 4))
  adb shell dumpsys gfxinfo "$PKG" reset >/dev/null
  for i in 1 2 3 4 5 6; do adb shell input swipe "$x" "$y1" "$x" "$y2" 150; sleep 0.6; done
  for i in 1 2 3 4 5 6; do adb shell input swipe "$x" "$y2" "$x" "$y1" 150; sleep 0.6; done
  file="$OUT/$LABEL-$state-r$run.gfxinfo.txt"
  adb shell dumpsys gfxinfo "$PKG" > "$file"
  row "$state" frames "$run" "$(grep -m1 'Total frames rendered' "$file" | grep -o '[0-9]*$')"
  row "$state" janky_pct "$run" "$(grep -m1 '^Janky frames:' "$file" | grep -o '([0-9.]*%)' | tr -d '()%')"
  row "$state" frame_p50_ms "$run" "$(grep -m1 '^50th percentile' "$file" | grep -o '[0-9]*ms' | tr -d 'ms')"
  row "$state" frame_p90_ms "$run" "$(grep -m1 '^90th percentile' "$file" | grep -o '[0-9]*ms' | tr -d 'ms')"
  row "$state" frame_p99_ms "$run" "$(grep -m1 '^99th percentile' "$file" | grep -o '[0-9]*ms' | tr -d 'ms')"
}

adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$APK" >/dev/null
# Animations on: CI emulators start with them off, which the app reads as Reduce Motion.
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell settings put global animator_duration_scale 1

# The first open after install does one-time work (database, migrations): not counted.
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 15
adb shell dumpsys package dexopt 2>/dev/null | grep -A3 "\[$PKG\]" > "$OUT/$LABEL-dexopt-fresh.txt" || true

for run in $(seq 1 "$RUNS"); do cold_start fresh "$run"; done
for run in 1 2 3; do frames fresh "$run"; done

# What background dexopt produces: profileinstaller wrote the shipped profile on the first open (if the APK has one).
adb shell am force-stop "$PKG"
adb shell cmd package compile -f -m speed-profile "$PKG" >/dev/null
adb shell dumpsys package dexopt 2>/dev/null | grep -A3 "\[$PKG\]" > "$OUT/$LABEL-dexopt-compiled.txt" || true

for run in $(seq 1 "$RUNS"); do cold_start dexopted "$run"; done
for run in 1 2 3; do frames dexopted "$run"; done

adb shell am force-stop "$PKG"
