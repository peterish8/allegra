#!/usr/bin/env bash
# The low-end performance run (docs/perf-low-end.md). Drives the installed app on one device with lyricflow://
# links and adb input, and records frame stats per scenario plus tap-to-audible from the PerfMarks log lines.
#
#   low-end-baseline.sh <serial> <out-dir> [label] [runs]
#
# EMULATE_M31=1 sets the emulator's screen to the Galaxy M31's 1080x2340 at 420 dpi for the run, so the app draws
# the same number of pixels. The library needs songs titled "Perf Song NNN" (seed-library.sh puts 500 on a device).
# Output: <out-dir>/<scenario>.gfxinfo.txt (framestats) and rows appended to <out-dir>/summary.tsv.
set -u
SERIAL="${1:?serial}"
OUT="${2:?out dir}"
LABEL="${3:-run}"
RUNS="${4:-1}"
PKG=com.lyricflow.app
ADB_BIN="${ADB:-adb}"
STREAMED_QUERY="${STREAMED_QUERY:-Ucha%20Lamba%20Kad%20Anand%20Raaj%20Anand}"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.tsv"
[ -s "$SUMMARY" ] || printf 'label\trun\tscenario\tframes\tjanky_pct\tp50_ms\tp90_ms\tp99_ms\n' > "$SUMMARY"
TAPS="$OUT/tap-to-audible.tsv"
[ -s "$TAPS" ] || printf 'label\trun\tscenario\ttry\tms\n' > "$TAPS"

adb() { MSYS_NO_PATHCONV=1 "$ADB_BIN" -s "$SERIAL" "$@"; }
link() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null 2>&1; }

# shellcheck source=../../../../.github/scripts/player-assertions.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../../.github/scripts/player-assertions.sh"

# "left top right bottom" of the view whose text matches $1 (the $2th match, default the first), from the last dump.
text_bounds() {
  grep -o "text=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$OUT/ui.xml" 2>/dev/null \
    | sed -n "${2:-1}p" | grep -o 'bounds="[^"]*"' | grep -o '[0-9][0-9]*' | tr '\n' ' '
}

class_bounds() {
  grep -o "class=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$OUT/ui.xml" 2>/dev/null \
    | head -n 1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9][0-9]*' | tr '\n' ' '
}

gfx_reset() { adb shell dumpsys gfxinfo "$PKG" reset >/dev/null; }

gfx_save() {
  local name="$1" file="$OUT/$LABEL-r$RUN-$1.gfxinfo.txt"
  adb shell dumpsys gfxinfo "$PKG" framestats > "$file"
  local frames janky p50 p90 p99
  frames=$(grep -m1 'Total frames rendered' "$file" | grep -o '[0-9]*$')
  janky=$(grep -m1 '^Janky frames:' "$file" | grep -o '([0-9.]*%)' | tr -d '()%')
  p50=$(grep -m1 '^50th percentile' "$file" | grep -o '[0-9]*ms' | tr -d 'ms')
  p90=$(grep -m1 '^90th percentile' "$file" | grep -o '[0-9]*ms' | tr -d 'ms')
  p99=$(grep -m1 '^99th percentile' "$file" | grep -o '[0-9]*ms' | tr -d 'ms')
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$LABEL" "$RUN" "$name" "$frames" "$janky" "$p50" "$p90" "$p99" | tee -a "$SUMMARY"
}

fling() {
  local n="$1" i
  for ((i = 0; i < n; i++)); do adb shell input swipe 540 1750 540 650 140; sleep 0.4; done
  for ((i = 0; i < n; i++)); do adb shell input swipe 540 650 540 1750 140; sleep 0.4; done
}

# Milliseconds from the last finger lift to the next "playing" mark, or empty when audio never started.
tap_to_audible() {
  adb logcat -d -s LLPerf:D | awk '
    /tapUp/ { tap = $NF }
    /playing/ && tap != "" { print $NF - tap; exit }'
}

pause_music() { adb shell input keyevent KEYCODE_MEDIA_PAUSE; sleep 1.5; }

setup() {
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell setprop log.tag.LLPerf DEBUG
  adb shell settings put global animator_duration_scale 1
  adb shell settings put global transition_animation_scale 1
  adb shell settings put global window_animation_scale 1
  if [ "${EMULATE_M31:-0}" = 1 ]; then
    adb shell wm size 1080x2340
    adb shell wm density 420
  fi
  adb shell am force-stop "$PKG"
  adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
  sleep 20
  link "lyricflow://style?canvas=0"
  sleep 1
}

teardown() {
  pause_music
  if [ "${EMULATE_M31:-0}" = 1 ]; then
    adb shell wm size reset
    adb shell wm density reset
  fi
}
trap teardown EXIT

# Taps the $1th library row on screen.
play_library_row() {
  ui_dump && b=$(text_bounds 'Perf Song [0-9]*' "$1") && [ -n "$b" ] && tap_bounds "$b"
}

setup
for ((RUN = 1; RUN <= RUNS; RUN++)); do
  echo "== $LABEL run $RUN"

  link "lyricflow://open/library"
  sleep 4
  adb logcat -c
  play_library_row 1 || echo "no library row found (seed the library first)"
  sleep 5
  ms=$(tap_to_audible); printf '%s\t%s\tlibrary\t1\t%s\n' "$LABEL" "$RUN" "$ms" | tee -a "$TAPS"
  link "lyricflow://open/library"
  sleep 2
  gfx_reset; fling 8; gfx_save library-scroll

  link "lyricflow://open/stream"
  sleep 10
  gfx_reset; fling 6; gfx_save stream-scroll

  link "lyricflow://open/library"
  sleep 2
  ui_dump; pill=$(desc_bounds 'Now playing: [^"]*Open player')
  gfx_reset
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    tap_bounds "$pill"; sleep 1.6
    adb shell input keyevent KEYCODE_BACK; sleep 1.4
  done
  gfx_save player-open-close

  for try in 1 2 3 4 5; do
    link "lyricflow://open/library"
    sleep 1.5
    pause_music
    adb logcat -c
    play_library_row $((try + 1))
    sleep 5
    ms=$(tap_to_audible); printf '%s\t%s\tlibrary\t%s\t%s\n' "$LABEL" "$RUN" "$try" "$ms" | tee -a "$TAPS"
  done

  for try in 1 2 3; do
    link "lyricflow://open/search"
    sleep 2
    pause_music
    ui_dump && b=$(class_bounds 'android.widget.EditText') && tap_bounds "$b"
    sleep 0.5
    adb shell input text "Perf%sSong%s04$try"
    sleep 3
    adb logcat -c
    ui_dump && b=$(text_bounds "Perf Song 04$try") && tap_bounds "$b"
    sleep 5
    ms=$(tap_to_audible); printf '%s\t%s\tsearch\t%s\t%s\n' "$LABEL" "$RUN" "$try" "$ms" | tee -a "$TAPS"
    adb shell input keyevent KEYCODE_BACK
  done

  link "lyricflow://play?q=$STREAMED_QUERY&lyrics=1"
  sleep 15
  gfx_reset; sleep 20; gfx_save lyrics-on
  adb shell input keyevent KEYCODE_BACK
done
