"""Save the latest explicit, bounded Allegra Android trace dump from logcat."""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

MAX_RECORDS = 250
BEGIN = "[ALLEGRA_PERF_TRACE_BEGIN]"
RECORD = "[ALLEGRA_PERF_TRACE_RECORD]"
END = "[ALLEGRA_PERF_TRACE_END]"
ADB_PATH = "adb"
ALLOWED_KEYS = {
    "attemptId",
    "generation",
    "platform",
    "event",
    "elapsedMs",
    "scenario",
    "resultCount",
    "durationMs",
    "cache",
    "outcome",
}
ALLOWED_EVENTS = {
    "query.changed",
    "search.dispatched",
    "catalog.completed",
    "artists.completed",
    "results.committed",
    "results.presented",
    "result.selected",
    "playback.commanded",
    "media.ready",
    "media.play",
    "media.playing",
    "media.waiting",
    "media.error",
    "playback.observed",
    "attempt.finished",
}
ALLOWED_OUTCOMES = {
    "success",
    "empty",
    "search-failure",
    "aborted",
    "superseded",
    "timeout",
    "playback-failure",
    "remote-routed",
}


class CaptureError(RuntimeError):
    pass


def adb(args: list[str], timeout: int = 20) -> str:
    try:
        result = subprocess.run(
            [ADB_PATH, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CaptureError(f"ADB command failed ({type(error).__name__}).") from None
    if result.returncode != 0:
        raise CaptureError(f"ADB command failed with exit code {result.returncode}.")
    return result.stdout


def choose_serial(requested: str | None) -> str:
    online: list[str] = []
    for line in adb(["devices"]).splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 2 and fields[1] == "device":
            online.append(fields[0])
    if requested:
        if requested not in online:
            raise CaptureError("The requested ADB serial is not online.")
        return requested
    if len(online) != 1:
        raise CaptureError("Specify --serial when zero or multiple ADB devices are online.")
    return online[0]


def active_pid(serial: str, package: str, requested_pid: str | None) -> str:
    pids = adb(["-s", serial, "shell", "pidof", package]).split()
    if not pids or any(not pid.isdecimal() for pid in pids):
        raise CaptureError("The requested app process is not running.")
    if requested_pid:
        if requested_pid not in pids:
            raise CaptureError("The requested PID does not belong to the app package.")
        return requested_pid
    if len(pids) != 1:
        raise CaptureError("Specify --pid when the package has multiple processes.")
    return pids[0]


def validate_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not set(value).issubset(ALLOWED_KEYS):
        raise CaptureError("A trace record contains an unsupported field.")
    required = {"attemptId", "generation", "platform", "event", "elapsedMs"}
    if not required.issubset(value):
        raise CaptureError("A trace record is missing a required field.")
    if (
        value["platform"] != "android"
        or not isinstance(value["event"], str)
        or value["event"] not in ALLOWED_EVENTS
    ):
        raise CaptureError("The captured record is not an Android trace event.")
    if (
        not isinstance(value["attemptId"], str)
        or not value["attemptId"].startswith("android-")
        or not value["attemptId"][8:].isdecimal()
        or isinstance(value["generation"], bool)
        or not isinstance(value["generation"], int)
        or value["generation"] < 0
    ):
        raise CaptureError("A trace attempt identity is invalid.")
    for key in ("elapsedMs", "durationMs"):
        if key in value and (
            isinstance(value[key], bool)
            or not isinstance(value[key], (int, float))
            or not math.isfinite(value[key])
            or value[key] < 0
        ):
            raise CaptureError("A trace time value is invalid.")
    if "resultCount" in value and (
        isinstance(value["resultCount"], bool)
        or not isinstance(value["resultCount"], int)
        or value["resultCount"] < 0
    ):
        raise CaptureError("A trace result count is invalid.")
    if "scenario" in value and (
        not isinstance(value["scenario"], str)
        or value["scenario"] not in {"online", "local"}
    ):
        raise CaptureError("A trace scenario is invalid.")
    if "cache" in value and (
        not isinstance(value["cache"], str)
        or value["cache"] not in {"cold", "warm", "unknown"}
    ):
        raise CaptureError("A trace cache value is invalid.")
    if "outcome" in value and (
        not isinstance(value["outcome"], str)
        or value["outcome"] not in ALLOWED_OUTCOMES
    ):
        raise CaptureError("A trace outcome is invalid.")
    return value


def latest_snapshot(log_text: str) -> list[dict[str, Any]]:
    expected_count: int | None = None
    current: list[dict[str, Any]] | None = None
    latest: list[dict[str, Any]] | None = None

    for line in log_text.splitlines():
        begin_at = line.find(BEGIN)
        if begin_at >= 0:
            count_text = line[begin_at + len(BEGIN):].strip()
            try:
                expected_count = int(count_text)
            except ValueError:
                raise CaptureError("The trace dump count is invalid.") from None
            if expected_count < 0 or expected_count > MAX_RECORDS:
                raise CaptureError("The dump exceeds the shared trace buffer cap.")
            current = []
            continue

        record_at = line.find(RECORD)
        if record_at >= 0 and current is not None:
            payload = line[record_at + len(RECORD):].strip()
            try:
                current.append(validate_record(json.loads(payload)))
            except (json.JSONDecodeError, CaptureError) as error:
                raise CaptureError(f"Trace record rejected ({type(error).__name__}).") from None
            if len(current) > expected_count:
                raise CaptureError("The dump contains more records than declared.")
            continue

        end_at = line.find(END)
        if end_at >= 0 and current is not None:
            if len(current) != expected_count:
                raise CaptureError("The trace dump is incomplete.")
            latest = current
            expected_count = None
            current = None

    if current is not None:
        raise CaptureError("The latest trace dump is incomplete.")
    if latest is None:
        raise CaptureError("No complete trace dump was found in this app process log.")
    return latest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb", help="ADB executable (defaults to PATH lookup)")
    parser.add_argument("--serial", help="ADB device serial; required when multiple devices are online")
    parser.add_argument("--package", default="com.lyricflow.app", help="Android package name")
    parser.add_argument("--pid", help="App process ID if the package has multiple processes")
    parser.add_argument("--output", required=True, type=pathlib.Path, help="Explicit local JSON output path")
    args = parser.parse_args()

    global ADB_PATH
    ADB_PATH = args.adb
    try:
        serial = choose_serial(args.serial)
        pid = active_pid(serial, args.package, args.pid)
        process_log = adb([
            "-s", serial, "logcat", "-d", f"--pid={pid}", "-s", "ReactNativeJS:V",
        ], timeout=45)
        records = latest_snapshot(process_log)
        output = {
            "formatVersion": 1,
            "capturedAtUtc": datetime.now(timezone.utc).isoformat(),
            "records": records,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    except CaptureError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError as error:
        print(f"Could not write the requested output ({type(error).__name__}).", file=sys.stderr)
        return 1

    print(f"Saved {len(records)} bounded Android trace records.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
