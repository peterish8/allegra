#!/usr/bin/env bash
# Fails when a built APK asks for access LuvLyrics must not have (src/androidPermissions.test.ts checks the source
# manifest; this checks what the manifest merger and every library actually produced).
#
# Play Protect blocks an internet-sideloaded app that declares an accessibility service, a notification listener or
# SMS access (https://developers.google.com/android/play-protect/warning-dev-guidance#app-blocked), and Google Pay
# pauses payments while a non-Play app holds an enabled accessibility service.
#
# Usage: apk-permission-check.sh <apk> [report-file]
set -euo pipefail

APK="${1:?usage: apk-permission-check.sh <apk> [report-file]}"
REPORT="${2:-}"

AAPT="$(ls -d "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1)"
if [ -z "$AAPT" ]; then
  echo "aapt not found under the Android SDK" >&2
  exit 2
fi

badging="$("$AAPT" dump badging "$APK")"
tree="$("$AAPT" dump xmltree "$APK" AndroidManifest.xml)"
permissions="$(printf '%s\n' "$badging" | sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" | sort -u)"

if [ -n "$REPORT" ]; then
  {
    printf '%s\n' "$badging" | grep -E "^package:|sdkVersion|targetSdkVersion|application-debuggable" || true
    echo "--- permissions"
    printf '%s\n' "$permissions"
  } > "$REPORT"
fi

fail=0
for p in \
  android.permission.BIND_ACCESSIBILITY_SERVICE \
  android.permission.BIND_NOTIFICATION_LISTENER_SERVICE \
  android.permission.RECEIVE_SMS \
  android.permission.READ_SMS \
  android.permission.SEND_SMS \
  android.permission.READ_CONTACTS \
  android.permission.READ_CALL_LOG \
  android.permission.QUERY_ALL_PACKAGES \
  android.permission.SYSTEM_ALERT_WINDOW \
  android.permission.READ_MEDIA_IMAGES \
  android.permission.READ_MEDIA_VIDEO \
  android.permission.READ_MEDIA_VISUAL_USER_SELECTED; do
  if printf '%s\n' "$permissions" | grep -qx "$p"; then
    echo "::error::APK asks for $p"
    fail=1
  fi
done

# A service guarded by these binds is the declaration Play Protect and payment apps look for, whatever it is called.
for bind in BIND_ACCESSIBILITY_SERVICE BIND_NOTIFICATION_LISTENER_SERVICE; do
  if printf '%s\n' "$tree" | grep -q "android.permission.$bind"; then
    echo "::error::APK declares a service guarded by $bind"
    fail=1
  fi
done

if printf '%s\n' "$badging" | grep -q "application-debuggable"; then
  echo "::error::APK is debuggable"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "APK permissions: least privilege holds ($(printf '%s\n' "$permissions" | wc -l) permissions)"
exit "$fail"
