"""Estimate BPM for a stratified subset of a JioSaavn snapshot."""

import argparse
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

import librosa
import numpy as np


SAMPLE_RATE = 22050
HOP = 512
SECONDS = 30


def estimate(audio):
    onset = librosa.onset.onset_strength(y=audio, sr=SAMPLE_RATE, hop_length=HOP)
    estimates = []
    for half in np.array_split(onset, 2):
        if np.std(half) < 0.01:
            return None
        bpm = float(librosa.feature.tempo(onset_envelope=half, sr=SAMPLE_RATE, hop_length=HOP)[0])
        lag = round(60 * SAMPLE_RATE / (HOP * bpm)) if bpm > 0 else 0
        if lag <= 0 or lag >= len(half) // 2:
            return None
        correlation = float(np.corrcoef(half[lag:], half[:-lag])[0, 1])
        if not np.isfinite(correlation) or correlation < 0.18:
            return None
        estimates.append(bpm)
    first, second = sorted(estimates)
    if second / first > 1.07:
        return None
    bpm = (first + second) / 2
    return round(bpm, 1) if 50 <= bpm <= 220 else None


def measure(key, track, url):
    source = urlsplit(url)
    if source.scheme != "https" or not (source.hostname or "").endswith(".saavncdn.com"):
        return key, {"status": "unsupported_source"}
    start = min(30, max(5, (track["duration"] - SECONDS) // 2))
    try:
        pcm = subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-rw_timeout", "8000000",
            "-protocol_whitelist", "https,tls,tcp", "-ss", str(start), "-i", url,
            "-t", str(SECONDS), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
        ], capture_output=True, check=True, timeout=25).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return key, {"status": "audio_unavailable"}
    samples = np.frombuffer(pcm, dtype="<f4")
    bpm = estimate(samples) if len(samples) >= SAMPLE_RATE * (SECONDS - 2) else None
    if bpm is None:
        return key, {"status": "uncertain"}
    return key, {"status": "estimated", "bpm": bpm, "source": "saavn-audio-librosa"}


def select_tracks(snapshot, sources):
    groups = defaultdict(deque)
    genres = {}
    for playlist in snapshot["playlists"]:
        if playlist["genre"]:
            for key in playlist["tracks"]:
                genres.setdefault(key, playlist["genre"])
    for key in sorted(sources, key=lambda item: hashlib.sha256(item.encode()).digest()):
        if key in snapshot["tracks"]:
            groups[snapshot["tracks"][key]["language"], genres.get(key)].append(key)
    while groups:
        for group, keys in list(groups.items()):
            yield keys.popleft()
            if not keys:
                del groups[group]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("output/recommendations"))
    parser.add_argument("--limit", type=int, default=240, help="total attempted tracks in this snapshot")
    args = parser.parse_args()
    if not 1 <= args.limit <= 600:
        parser.error("choose 1–600 audio excerpts per snapshot")
    snapshot = json.loads((args.output / "catalog.json").read_text(encoding="utf-8"))
    sources = json.loads((args.output / "audio-sources.json").read_text(encoding="utf-8"))
    path = args.output / "tempo.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    results = previous.get("tracks", {}) if previous.get("collectedAt") == snapshot["collectedAt"] else {}
    keys = [key for key in select_tracks(snapshot, sources) if key not in results]
    keys = keys[:max(0, args.limit - len(results))]

    def save():
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"collectedAt": snapshot["collectedAt"], "tracks": results}), encoding="utf-8")
        tmp.replace(path)

    if keys:
        first, *rest = keys
        key, result = measure(first, snapshot["tracks"][first], sources[first])
        results[key] = result
        save()
        print(f"Audio estimator warmed up: {result['status']}.", flush=True)
        with ThreadPoolExecutor(max_workers=3) as executor:
            jobs = ((key, snapshot["tracks"][key], sources[key]) for key in rest)
            for key, result in executor.map(lambda args: measure(*args), jobs):
                results[key] = result
                if len(results) % 20 == 0:
                    save()
                    print(f"Attempted {len(results)} excerpts.", flush=True)
    save()
    print(json.dumps({status: sum(row["status"] == status for row in results.values())
                      for status in sorted({row["status"] for row in results.values()})}))


if __name__ == "__main__":
    main()
