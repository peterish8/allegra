"""Synthetic parser tests only; these do not represent Android/device measurements."""

from __future__ import annotations

import copy
import json
import unittest

from capture_android_trace import (
    BEGIN,
    END,
    RECORD,
    CaptureError,
    latest_snapshot,
    validate_record,
)


def synthetic_record(generation: int = 1) -> dict[str, object]:
    return {
        "attemptId": "android-1",
        "generation": generation,
        "platform": "android",
        "event": "catalog.completed",
        "elapsedMs": 14.25,
        "durationMs": 13.5,
        "scenario": "online",
        "resultCount": 2,
    }


def dump_lines(records: list[dict[str, object]]) -> str:
    lines = [f"ReactNativeJS: {BEGIN}{len(records)}"]
    lines.extend(f"ReactNativeJS: {RECORD}{json.dumps(record)}" for record in records)
    lines.append(f"ReactNativeJS: {END}")
    return "\n".join(lines)


class CaptureAndroidTraceParserTests(unittest.TestCase):
    def test_reads_only_latest_complete_marked_snapshot(self) -> None:
        first = synthetic_record(1)
        second = synthetic_record(2)
        text = dump_lines([first]) + "\n" + dump_lines([second])

        self.assertEqual(latest_snapshot(text), [second])

    def test_ignores_incomplete_snapshot_and_reports_missing_complete_dump(self) -> None:
        text = f"ReactNativeJS: {BEGIN}1\nReactNativeJS: {RECORD}{json.dumps(synthetic_record())}"

        with self.assertRaises(CaptureError):
            latest_snapshot(text)

    def test_does_not_fall_back_to_an_older_dump_when_latest_is_incomplete(self) -> None:
        text = dump_lines([synthetic_record()]) + f"\nReactNativeJS: {BEGIN}1"

        with self.assertRaises(CaptureError):
            latest_snapshot(text)

    def test_rejects_unlisted_metadata_and_nonfinite_time(self) -> None:
        with_metadata = synthetic_record()
        with_metadata["query"] = "private search"
        with self.assertRaises(CaptureError):
            validate_record(with_metadata)

        with_nonfinite_time = copy.deepcopy(synthetic_record())
        with_nonfinite_time["elapsedMs"] = float("nan")
        with self.assertRaises(CaptureError):
            validate_record(with_nonfinite_time)

    def test_rejects_counts_above_the_shared_cap(self) -> None:
        with self.assertRaises(CaptureError):
            latest_snapshot(f"ReactNativeJS: {BEGIN}251\nReactNativeJS: {END}")


if __name__ == "__main__":
    unittest.main()
