"""Measure tempo and other audio features from JioSaavn excerpts."""

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
from scipy.signal import find_peaks


SAMPLE_RATE = 22050
HOP = 512
SECONDS = 30
ANALYSIS_VERSION = 2
KEY_PROFILES = np.array([
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
])
KEY_PROFILES = np.array([np.roll(row - row.mean(), pitch) for row in KEY_PROFILES for pitch in range(12)])
KEY_PROFILES /= np.linalg.norm(KEY_PROFILES, axis=1, keepdims=True)


def estimate_tempo(onset):
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


def estimate_key(chroma):
    matches = []
    for half in np.array_split(chroma, 2, axis=1):
        levels = half.mean(axis=1)
        levels -= levels.mean()
        norm = np.linalg.norm(levels)
        if norm < 0.01:
            return None
        scores = KEY_PROFILES @ (levels / norm)
        best, second = np.argsort(scores)[-2:][::-1]
        if scores[best] < 0.55 or scores[best] - scores[second] < 0.035:
            return None
        matches.append(int(best))
    return matches[0] if matches[0] == matches[1] else None


def describe(samples):
    magnitude = np.abs(librosa.stft(samples, n_fft=2048, hop_length=HOP))
    power = magnitude ** 2
    mel = librosa.feature.melspectrogram(S=power, sr=SAMPLE_RATE, n_mels=64)
    onset = librosa.onset.onset_strength(S=librosa.power_to_db(mel), sr=SAMPLE_RATE, hop_length=HOP)
    bpm = estimate_tempo(onset)
    chroma = librosa.feature.chroma_stft(S=power, sr=SAMPLE_RATE, tuning=0.0)
    key = estimate_key(chroma)
    rms = librosa.feature.rms(S=magnitude, frame_length=2048)[0]
    dbfs = 20 * np.log10(np.maximum(rms, 0.0001))
    levels = np.percentile(dbfs, [10, 50, 90])
    centroid = librosa.feature.spectral_centroid(S=magnitude, sr=SAMPLE_RATE)[0]
    flatness = librosa.feature.spectral_flatness(S=magnitude)[0]
    onsets, _ = find_peaks(onset, distance=4, prominence=max(0.5, float(np.std(onset))))
    return {
        "status": "estimated" if bpm is not None else "uncertain",
        "source": "saavn-audio-librosa",
        **({"bpm": bpm} if bpm is not None else {}),
        **({"key": key % 12, "mode": int(key < 12)} if key is not None else {}),
        "rmsDbfs": round(float(levels[1]), 2),
        "dynamicRangeDb": round(float(levels[2] - levels[0]), 2),
        "spectralCentroidHz": round(float(np.median(centroid)), 1),
        "spectralFlatness": round(float(np.median(flatness)), 5),
        "onsetsPerSecond": round(float(len(onsets) * SAMPLE_RATE / len(samples)), 2),
    }


def measure(key, track, url):
    source = urlsplit(url)
    if source.scheme != "https" or not (source.hostname or "").endswith(".saavncdn.com"):
        return key, {"status": "unsupported_source"}
    start = min(30, max(5, (track["duration"] - SECONDS) // 2))
    try:
        pcm = subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-rw_timeout", "8000000",
            "-protocol_whitelist", "https,tls,tcp", "-ss", str(start), "-i", url,
            "-t", str(SECONDS), "-vn", "-threads", "1", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
        ], capture_output=True, check=True, timeout=25).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return key, {"status": "audio_unavailable"}
    samples = np.frombuffer(pcm, dtype="<f4")
    if len(samples) < SAMPLE_RATE * (SECONDS - 2) or not np.isfinite(samples).all():
        return key, {"status": "audio_unavailable"}
    return key, describe(samples)


def by_language(snapshot, keys):
    groups = defaultdict(deque)
    for key in sorted(keys, key=lambda item: hashlib.sha256(item.encode()).digest()):
        if key in snapshot["tracks"]:
            groups[snapshot["tracks"][key]["language"]].append(key)
    while groups:
        for group, keys in list(groups.items()):
            yield keys.popleft()
            if not keys:
                del groups[group]


def select_tracks(snapshot, sources, candidates):
    lanes = (iter(by_language(snapshot, set(sources) & candidates)),
             iter(by_language(snapshot, set(sources) - candidates)))
    while True:
        batch = [next(lane, None) for lane in (lanes[0], lanes[0], lanes[1])]
        if all(key is None for key in batch):
            return
        yield from (key for key in batch if key is not None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("output/recommendations"))
    parser.add_argument("--limit", type=int, default=240, help="total attempted tracks in this snapshot")
    args = parser.parse_args()
    if not 1 <= args.limit <= 5000:
        parser.error("choose 1–5000 audio excerpts per snapshot")
    snapshot = json.loads((args.output / "catalog.json").read_text(encoding="utf-8"))
    sources = json.loads((args.output / "audio-sources.json").read_text(encoding="utf-8"))
    path = args.output / "tempo.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if previous.get("collectedAt") == snapshot["collectedAt"] and previous.get("analysisVersion") == ANALYSIS_VERSION:
        results = previous["tracks"]
    else:
        results = {}
    baseline = json.loads((args.output / "baseline.json").read_text(encoding="utf-8"))
    candidates = {key for case in baseline["cases"] for key in case["pool"]}
    keys = [key for key in select_tracks(snapshot, sources, candidates) if key not in results]
    keys = keys[:max(0, args.limit - len(results))]

    def save():
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"collectedAt": snapshot["collectedAt"], "analysisVersion": ANALYSIS_VERSION,
                                   "tracks": results}, allow_nan=False), encoding="utf-8")
        tmp.replace(path)

    if keys:
        first, *rest = keys
        key, result = measure(first, snapshot["tracks"][first], sources[first])
        results[key] = result
        save()
        print(f"Audio estimator warmed up: {result['status']}.", flush=True)
        with ThreadPoolExecutor(max_workers=4) as executor:
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
