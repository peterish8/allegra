#!/usr/bin/env bash
# Puts 500 short generated songs on a device and imports them into the installed app's library through
# Settings → Add songs from this phone, for low-end-baseline.sh. The scan names each song after its file
# ("perf_001".."perf_500"). Needs ffmpeg.
#
#   seed-library.sh <serial> <work-dir>
set -u
SERIAL="${1:?serial}"
OUT="${2:?work dir}"
PKG=com.lyricflow.app
ADB_BIN="${ADB:-adb}"
adb() { MSYS_NO_PATHCONV=1 "$ADB_BIN" -s "$SERIAL" "$@"; }
link() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null 2>&1; }
mkdir -p "$OUT/seed"

# shellcheck source=../../../../.github/scripts/player-assertions.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../../.github/scripts/player-assertions.sh"

text_bounds() {
  grep -o "text=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$OUT/ui.xml" 2>/dev/null \
    | head -n 1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9][0-9]*' | tr '\n' ' '
}

# Scrolls until a view with text $1 is on screen, then taps it.
tap_text() {
  for _ in $(seq 1 12); do
    ui_dump && b=$(text_bounds "$1") && [ -n "$b" ] && { tap_bounds "$b"; return 0; }
    adb shell input swipe 540 1700 540 900 300
    sleep 0.8
  done
  echo "not found: $1"; return 1
}

if [ "$(adb shell ls /sdcard/Music/perf 2>/dev/null | wc -l)" -lt 500 ]; then
  ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=40" -ac 1 -ar 22050 -b:a 32k "$OUT/base.mp3"
  for i in $(seq -w 1 500); do
    ffmpeg -loglevel error -y -i "$OUT/base.mp3" -c copy -metadata title="Perf Song $i" \
      -metadata artist="Perf Artist $((10#$i % 37))" -metadata album="Perf Album $((10#$i % 53))" "$OUT/seed/perf_$i.mp3"
  done
  adb shell mkdir -p /sdcard/Music/perf
  adb push "$OUT/seed/." /sdcard/Music/perf/ >/dev/null
  adb shell content call --uri content://media --method scan_volume --arg external_primary >/dev/null
fi

# expo-media-library asks for photos and videos as well as audio.
for p in READ_MEDIA_AUDIO READ_MEDIA_IMAGES READ_MEDIA_VIDEO; do adb shell pm grant "$PKG" "android.permission.$p" 2>/dev/null; done
link "lyricflow://open/settings"
sleep 3
tap_text 'Library and data' && sleep 1
tap_text 'Add songs from this phone' && sleep 4
tap_text 'Import [0-9]*' && sleep 90
echo "seeded: open Library and check for perf_NNN rows (the import adds them one by one)"
