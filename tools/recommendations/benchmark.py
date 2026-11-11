"""Train LightFM on real playlist memberships and evaluate held-out recordings."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from math import log2
from pathlib import Path
from time import perf_counter

from lightfm import LightFM
from lightfm.data import Dataset
import numpy as np

from item_features import feature_sets, feature_weights, lead_artist


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def train(tracks, memberships, features, epochs, seed):
    fitted_tracks = {key for _, key in memberships}
    vocabulary = {tag for key in fitted_tracks for tag in features[key]}
    # Unobserved recordings borrow known feature embeddings. There is no unfitted item ID factor.
    rows = {
        key: feature_weights((features[key] & vocabulary) | ({f"id:{key}"} if key in fitted_tracks else set()))
        or {"catalog": 1.0}
        for key in tracks
    }
    dataset = Dataset(item_identity_features=False)
    dataset.fit(sorted({playlist for playlist, _ in memberships}), sorted(tracks),
                item_features=sorted({tag for row in rows.values() for tag in row}))
    interactions, _ = dataset.build_interactions(memberships)
    item_features = dataset.build_item_features(rows.items())
    model = LightFM(no_components=32, loss="warp", learning_rate=0.05, random_state=seed)
    start = perf_counter()
    model.fit(interactions, item_features=item_features, epochs=epochs, num_threads=1)
    elapsed = perf_counter() - start
    user_map, _, item_map, _ = dataset.mapping()
    item_bias, item_vector = model.get_item_representations(item_features)
    user_bias, user_vector = model.get_user_representations()
    for array in (item_bias, item_vector, user_bias, user_vector):
        if not np.isfinite(array).all():
            raise RuntimeError("Training produced non-finite factors.")
    return model, item_features, (user_map, item_map, user_bias, user_vector, item_bias, item_vector), elapsed


def rank_scores(factors, user, keys):
    users, items, user_bias, user_vector, item_bias, item_vector = factors
    if not keys:
        return np.empty(0, dtype=np.float32)
    index = users[user]
    indexes = [items[key] for key in keys]
    return item_vector[indexes] @ user_vector[index] + item_bias[indexes] + user_bias[index]


def model_rank(factors, user, keys):
    scores = rank_scores(factors, user, keys)
    return [key for key, _ in sorted(zip(keys, scores, strict=True), key=lambda row: -row[1])]


def top(keys, tracks, language, known, limit=12):
    output = []
    seen = set(known)
    per_artist = Counter()
    for key in keys:
        if key in seen or tracks[key]["language"] != language:
            continue
        artist = lead_artist(tracks[key])
        if per_artist[artist] == 2:
            continue
        per_artist[artist] += 1
        seen.add(key)
        output.append(key)
        if len(output) == limit:
            break
    return output


def evaluate(keys, held_out, tracks):
    relevance = [int(key in held_out) for key in keys]
    scores = {}
    for k in (4, 10):
        dcg = sum(hit / log2(index + 2) for index, hit in enumerate(relevance[:k]))
        ideal = sum(1 / log2(index + 2) for index in range(min(k, len(held_out))))
        scores[f"ndcg@{k}"] = dcg / ideal
    scores["recall@10"] = sum(relevance[:10]) / len(held_out)
    scores["artists@10"] = len({lead_artist(tracks[key]) for key in keys[:10]})
    scores["empty"] = float(not keys)
    return scores


def means(rows):
    return {metric: float(np.mean([row[metric] for row in rows])) for metric in rows[0]}


def paired_delta(current, other, metric):
    difference = np.asarray([a[metric] - b[metric] for a, b in zip(other, current, strict=True)])
    draws = np.random.default_rng(2026).choice(difference, size=(2000, len(difference)), replace=True).mean(axis=1)
    return {"delta": float(difference.mean()), "bootstrap95": np.quantile(draws, [0.025, 0.975]).tolist()}


def measurements(path, collected_at):
    if not path.exists():
        return {}
    data = read(path)
    if data["collectedAt"] != collected_at:
        raise ValueError(f"{path.name} belongs to a different catalog snapshot.")
    return data["tracks"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("output/recommendations"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--report-only", action="store_true", help="write a seed-specific report and leave the model alone")
    args = parser.parse_args()
    if not 1 <= args.epochs <= 200:
        parser.error("choose 1–200 epochs")
    snapshot = read(args.output / "catalog.json")
    baseline = read(args.output / "baseline.json")
    if snapshot["collectedAt"] != baseline["collectedAt"] or not baseline["cases"]:
        raise ValueError("Collect baseline cases from the same catalog snapshot before training.")
    audio = measurements(args.output / "tempo.json", snapshot["collectedAt"])
    lookups = measurements(args.output / "reccobeats.json", snapshot["collectedAt"])
    recco = {key: row["features"] for key, row in lookups.items() if row.get("features")}
    local_bpms = {key: row["bpm"] for key, row in audio.items() if "bpm" in row}
    remote_bpms = {key: row["bpm"] for key, row in recco.items() if "bpm" in row}
    bpms = {**local_bpms, **remote_bpms}
    paired_tempos = [log2(local_bpms[key] / remote_bpms[key]) for key in local_bpms.keys() & remote_bpms.keys()]
    cases = baseline["cases"]
    tracks = dict(snapshot["tracks"])
    holdouts = {case["id"]: set(case["hidden"]) for case in cases}
    for case in cases:
        for key, track in case["pool"].items():
            tracks.setdefault(key, track)
    memberships = []
    genres = defaultdict(set)
    for playlist in snapshot["playlists"]:
        for key in playlist["tracks"]:
            if key in holdouts.get(playlist["id"], ()):
                continue
            memberships.append((playlist["id"], key))
            if playlist["genre"]:
                genres[key].add(playlist["genre"])
    fitted = {key for _, key in memberships}
    features, bins = feature_sets(tracks, genres, fitted, audio, recco)
    trained = {name: train(tracks, memberships, rows, args.epochs, args.seed) for name, rows in features.items()}
    model, item_features, factors, _ = trained["all_audio"]
    users, items, user_bias, user_vector, item_bias, item_vector = factors

    examples = sorted(tracks)[:16]
    profile = cases[0]["id"]
    expected = model.predict(users[profile], np.array([items[key] for key in examples], dtype=np.int32),
                             item_features=item_features, num_threads=1)
    np.testing.assert_allclose(rank_scores(factors, profile, examples), expected, rtol=1e-5, atol=1e-6)
    model_artifact = {
        "schemaVersion": 1,
        "collectedAt": snapshot["collectedAt"],
        "dimensions": user_vector.shape[1],
        "seed": args.seed,
        "profiles": {key: {"bias": float(user_bias[index]), "vector": user_vector[index].tolist()}
                     for key, index in users.items()},
        "recordings": {key: {"bias": float(item_bias[index]), "vector": item_vector[index].tolist()}
                       for key, index in items.items()},
        "parity": {"profile": profile, "expected": dict(zip(examples, expected.tolist(), strict=True))},
    }
    if not args.report_only:
        (args.output / "playlist-model.json").write_text(json.dumps(model_artifact, allow_nan=False), encoding="utf-8")

    comparisons = defaultdict(list)
    cohort = defaultdict(lambda: defaultdict(list))
    observed_examples = []
    reached = expanded_reach = hidden_count = warm_targets = 0
    pool_rows = pool_rows_with_bpm = pool_rows_with_local = pool_rows_with_recco = 0
    local = {key for key, row in audio.items() if "rmsDbfs" in row}
    tag_weights = {key: feature_weights(tags) for key, tags in features["all_audio"].items()}
    by_language = defaultdict(list)
    for key, track in tracks.items():
        by_language[track["language"]].append(key)
    timings = []
    for case in cases:
        held_out = holdouts[case["id"]]
        pool = list(case["pool"])
        known = case["observed"]
        seen = set(known)
        language = case["language"]
        hidden_count += len(held_out)
        reached += len(held_out.intersection(pool))
        warm_targets += len(held_out.intersection(fitted))
        pool_rows += len(pool)
        pool_rows_with_bpm += sum(key in bpms for key in pool)
        pool_rows_with_local += sum(key in local for key in pool)
        pool_rows_with_recco += sum(key in recco for key in pool)
        start = perf_counter()
        weights = Counter()
        for key in known:
            weights.update(tag_weights[key])

        def content_score(key):
            return sum(weights[tag] * weight for tag, weight in tag_weights[key].items())

        content = sorted(pool, key=content_score, reverse=True)
        catalog_counts = Counter(tag for key in known for tag in features["catalog"][key])
        catalog_content = sorted(pool, key=lambda key: sum(catalog_counts[tag] for tag in features["catalog"][key]), reverse=True)
        static = model_rank(trained["catalog"][2], case["id"], pool)
        with_bpm = model_rank(trained["bpm"][2], case["id"], pool)
        with_local = model_rank(trained["local_audio"][2], case["id"], pool)
        enriched = model_rank(factors, case["id"], pool)
        model_position = {key: rank for rank, key in enumerate(enriched)}
        old_position = {key: rank for rank, key in enumerate(pool)}
        blended = sorted(pool, key=lambda key: -1 / (10 + old_position[key]) - 1 / (10 + model_position[key]))
        timings.append((perf_counter() - start) * 1000)
        excluded = seen | set(pool)
        extra = sorted((key for key in by_language[language] if key not in excluded),
                       key=content_score, reverse=True)[:80]
        expanded_pool = pool + extra
        expanded_reach += len(held_out.intersection(expanded_pool))
        expanded = model_rank(factors, case["id"], expanded_pool)
        rankings = {
            "current_quick_picks": case["old"],
            "content_catalog_same_pool": top(catalog_content, tracks, language, known),
            "content_same_pool": top(content, tracks, language, known),
            "lightfm_same_pool": top(static, tracks, language, known),
            "lightfm_bpm_same_pool": top(with_bpm, tracks, language, known),
            "lightfm_local_audio_same_pool": top(with_local, tracks, language, known),
            "lightfm_enriched_same_pool": top(enriched, tracks, language, known),
            "blend_same_pool": top(blended, tracks, language, known),
            "content_expanded_catalog": top(sorted(expanded_pool, key=content_score, reverse=True), tracks, language, known),
            "lightfm_expanded_catalog": top(expanded, tracks, language, known),
        }
        for variant, ranking in rankings.items():
            if len(set(ranking)) != len(ranking) or set(ranking).intersection(known):
                raise ValueError(f"Duplicate or previously observed recording in {variant}.")
            if any(tracks[key]["language"] != language for key in ranking):
                raise ValueError(f"Recording outside selected language in {variant}.")
            if max(Counter(lead_artist(tracks[key]) for key in ranking).values(), default=0) > 2:
                raise ValueError(f"Artist cap exceeded in {variant}.")
            metrics = evaluate(ranking, held_out, tracks)
            comparisons[variant].append(metrics)
            cohort[language][variant].append(metrics)
        if len(observed_examples) < 4 and case["old"] != rankings["lightfm_enriched_same_pool"]:
            observed_examples.append({"playlist": case["id"], "language": language,
                "picks": {variant: [{"title": tracks[key]["title"], "artist": tracks[key]["artist"],
                                     "held_out": key in held_out} for key in keys[:4]]
                          for variant, keys in rankings.items()}})

    current = comparisons["current_quick_picks"]
    report = {
        "collected_at": snapshot["collectedAt"], "catalog_provider": snapshot["provider"],
        "baseline_provider": baseline["provider"],
        "seed": args.seed, "epochs": args.epochs,
        "catalog_sha256": hashlib.sha256((args.output / "catalog.json").read_bytes()).hexdigest(),
        "training_profiles": len(users), "training_recordings": len(fitted),
        "training_memberships": len(memberships), "catalog_recordings": len(snapshot["tracks"]),
        "feature_genres": sorted({genre for values in genres.values() for genre in values}),
        "catalog_languages": dict(Counter(track["language"] for track in snapshot["tracks"].values())),
        "expansion": snapshot.get("expansion"),
        "tempo_attempts": len(audio), "tempo_estimates": len(bpms),
        "local_bpm": len(local_bpms), "reccobeats_bpm": len(remote_bpms),
        "bpm_source_agreement": {"overlap": len(paired_tempos),
                                 "within_7_percent": sum(abs(value) <= log2(1.07) for value in paired_tempos),
                                 "within_7_percent_at_half_or_double": sum(
                                     abs(value - round(value)) <= log2(1.07) for value in paired_tempos)},
        "local_audio_recordings": len(local), "reccobeats_lookups": len(lookups),
        "reccobeats_recordings": len(recco), "train_with_local_audio": len(fitted & local),
        "train_with_reccobeats": len(fitted & recco.keys()),
        "feature_bins": bins,
        "tempo_by_language": dict(Counter(tracks[key]["language"] for key in bpms)),
        "test_profiles": len(cases), "test_hidden_recordings": hidden_count,
        "test_hidden_recordings_in_current_pool": reached, "test_hidden_recordings_in_expanded_pool": expanded_reach,
        "test_hidden_recordings_seen_in_training": warm_targets,
        "same_pool_candidate_rows": pool_rows, "same_pool_candidate_rows_with_bpm": pool_rows_with_bpm,
        "same_pool_candidate_rows_with_local_audio": pool_rows_with_local,
        "same_pool_candidate_rows_with_reccobeats": pool_rows_with_recco,
        "provider_requests": baseline["requests"], "provider_errors": baseline["errors"],
        "train_seconds": {name: result[3] for name, result in trained.items()},
        "scoring_p95_ms": float(np.quantile(timings, 0.95)),
        "current_provider_p95_ms": float(np.quantile([case["ms"] for case in cases], 0.95)),
        "metrics": {variant: means(rows) for variant, rows in comparisons.items()},
        "paired_ndcg10_vs_current": {variant: paired_delta(current, rows, "ndcg@10")
                                     for variant, rows in comparisons.items() if variant != "current_quick_picks"},
        "paired_ndcg10_enriched_vs_catalog_only": paired_delta(comparisons["lightfm_same_pool"],
                                                               comparisons["lightfm_enriched_same_pool"], "ndcg@10"),
        "paired_ndcg10_enriched_vs_local_audio": paired_delta(comparisons["lightfm_local_audio_same_pool"],
                                                               comparisons["lightfm_enriched_same_pool"], "ndcg@10"),
        "language_cohorts": {language: {variant: {"cases": len(rows), **means(rows)} for variant, rows in data.items()}
                             for language, data in cohort.items()},
        "examples": observed_examples,
    }
    report_name = f"benchmark-seed-{args.seed}.json" if args.report_only else "benchmark.json"
    (args.output / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"training_profiles": len(users), "training_memberships": len(memberships),
                      "test_profiles": len(cases), "tempo_estimates": len(bpms),
                      "metrics": report["metrics"]}, indent=2))


if __name__ == "__main__":
    main()
