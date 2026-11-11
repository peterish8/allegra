"""Fit item features without using withheld playlist memberships."""

from bisect import bisect_right
import re

import numpy as np


LOCAL_ATTRIBUTES = ("rmsDbfs", "dynamicRangeDb", "spectralCentroidHz", "spectralFlatness", "onsetsPerSecond")
RECCO_ATTRIBUTES = ("acousticness", "danceability", "energy", "instrumentalness",
                    "liveness", "loudness", "speechiness", "valence")


def lead_artist(track):
    credits = re.split(r",|&| feat\.? | ft\.? | x ", track["artist"], flags=re.IGNORECASE)
    return next((part.strip().lower() for part in credits if part.strip()), "")


def catalog_features(track, genres):
    features = {f"language:{track['language']}", f"artist:{lead_artist(track)}"}
    features.update(f"genre:{genre}" for genre in genres)
    if track.get("year"):
        features.add(f"decade:{track['year'] // 10 * 10}")
    if track.get("duration"):
        features.add(f"duration:{min(12, int(track['duration']) // 30)}")
    return features


def fit_bins(rows, fitted, attributes):
    bins = {}
    for name in attributes:
        known = [rows[key][name] for key in sorted(fitted) if key in rows and name in rows[key]]
        if len(known) < 12:
            continue
        low, high = min(known), max(known)
        bins[name] = sorted({float(value) for value in np.quantile(known, [0.25, 0.5, 0.75]) if low < value < high})
    return {name: cuts for name, cuts in bins.items() if cuts}


def audio_tags(source, row, bins):
    return {f"{source}:{name}:{bisect_right(cuts, row[name])}" for name, cuts in bins.items() if name in row}


def tempo_and_key(row):
    tags = set()
    if "bpm" in row:
        tags.add(f"bpm:{int(row['bpm']) // 20 * 20}")
    if "key" in row and "mode" in row:
        tags.add(f"tonality:{row['key']}:{row['mode']}")
    return tags


def feature_sets(tracks, genres, fitted, audio, recco):
    local_bins = fit_bins(audio, fitted, LOCAL_ATTRIBUTES)
    recco_bins = fit_bins(recco, fitted, RECCO_ATTRIBUTES)
    features = {name: {} for name in ("catalog", "bpm", "local_audio", "all_audio")}
    for key, track in tracks.items():
        base = catalog_features(track, genres[key])
        local = audio.get(key, {})
        remote = recco.get(key, {})
        combined = dict(local)
        if "bpm" in remote:
            combined["bpm"] = remote["bpm"]
        if "key" in remote and "mode" in remote:
            combined.update(key=remote["key"], mode=remote["mode"])
        local_tags = audio_tags("local", local, local_bins)
        features["catalog"][key] = base
        features["bpm"][key] = base | {tag for tag in tempo_and_key(combined) if tag.startswith("bpm:")}
        features["local_audio"][key] = base | local_tags | tempo_and_key(local)
        features["all_audio"][key] = base | local_tags | tempo_and_key(combined) | audio_tags("recco", remote, recco_bins)
    return features, {"local": local_bins, "reccobeats": recco_bins}


def feature_weights(tags):
    # The number of measured descriptors should not overwhelm the artist, language and track identity.
    family_weights = {"id": 2.0, "artist": 1.5, "language": 1.0, "genre": 1.0, "duration": 0.5,
                      "decade": 0.5, "bpm": 0.75, "tonality": 0.35, "local": 1.0, "recco": 1.0}
    families = {}
    for tag in sorted(tags):
        family = tag.split(":", 1)[0]
        families.setdefault(family, []).append(tag)
    return {tag: family_weights.get(family, 1.0) / len(members)
            for family, members in families.items() for tag in members}
