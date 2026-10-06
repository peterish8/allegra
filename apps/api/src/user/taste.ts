import { deriveMoodPrompts } from './moodPrompts.js';
import type { TasteEntry, TasteProfile } from './store.js';
import { creditedArtists } from '../shared/identity.js';
import { LONG_TERM_WEIGHT, listenVerdict, type ListenExit } from '../shared/listenSignal.js';

export { creditedArtists } from '../shared/identity.js';

/**
 * The taste profile is a small, decaying tally: every signal nudges the artists and languages it touches, and
 * everything else fades a little. Recent listening therefore outweighs old listening without any batch job,
 * and the profile stays a few dozen numbers, cheap to keep in the user's row and to hand to a model.
 */

/** How strongly each kind of behaviour says "this listener likes this". */
export const SIGNAL_WEIGHT = {
  /** Listened to most of a song. */
  play: 1,
  /** Bailed within seconds. */
  skip: -0.5,
  like: 3,
  unlike: -2,
  playlistAdd: 2,
  /** Picked as a favourite while setting up. */
  seed: 5
} as const;

const DECAY = 0.985;
const MAX_ARTISTS = 60;
const MAX_LANGUAGES = 12;
/** Enough organic signals that we stop asking a listener to pick favourites. */
const ONBOARDED_AFTER = 12;

export interface SongTraits {
  readonly artist: string;
  readonly language?: string;
}

export function emptyTaste(now = new Date()): TasteProfile {
  return { artists: [], languages: [], signals: 0, onboarded: false, updatedAt: now.toISOString() };
}

function bump(entries: readonly TasteEntry[], name: string, amount: number, keep: number): TasteEntry[] {
  const key = name.toLowerCase();
  const decayed = entries.map((entry) => ({ name: entry.name, score: entry.score * DECAY }));
  const index = decayed.findIndex((entry) => entry.name.toLowerCase() === key);
  if (index >= 0) {
    const current = decayed[index];
    if (current) decayed[index] = { name: current.name, score: current.score + amount };
  } else if (amount > 0) {
    decayed.push({ name, score: amount });
  }
  return decayed
    .filter((entry) => entry.score > 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, keep)
    .map((entry) => ({ name: entry.name, score: Math.round(entry.score * 1000) / 1000 }));
}

/** Folds one behaviour on one song into the profile. The headline artist counts fully, guests on the track half. */
export function applySignal(taste: TasteProfile | undefined, song: SongTraits, weight: number, now = new Date()): TasteProfile {
  const base = taste ?? emptyTaste(now);
  let artists = [...base.artists];
  creditedArtists(song.artist).forEach((name, index) => {
    artists = bump(artists, name, index === 0 ? weight : weight / 2, MAX_ARTISTS);
  });
  const language = song.language?.trim();
  const languages = language ? bump(base.languages, language, weight, MAX_LANGUAGES) : base.languages;
  const signals = base.signals + 1;
  return {
    artists,
    languages,
    signals,
    onboarded: base.onboarded || signals >= ONBOARDED_AFTER,
    updatedAt: now.toISOString()
  };
}

/** Onboarding: the listener names favourites directly. Strong, and it ends the "pick your favourites" prompt. */
export function applySeeds(taste: TasteProfile | undefined, artistNames: readonly string[], languageNames: readonly string[], now = new Date()): TasteProfile {
  const base = taste ?? emptyTaste(now);
  let artists = [...base.artists];
  for (const name of artistNames) artists = bump(artists, name, SIGNAL_WEIGHT.seed, MAX_ARTISTS);
  let languages = [...base.languages];
  for (const name of languageNames) languages = bump(languages, name, SIGNAL_WEIGHT.seed, MAX_LANGUAGES);
  return { artists, languages, signals: base.signals + artistNames.length + languageNames.length, onboarded: true, updatedAt: now.toISOString() };
}

/** Most artists one import may seed, however many it brought (PLAN.md §4.4, I6). */
export const IMPORT_SEED_MAX_ARTISTS = 25;

/**
 * An import's top artists, log-scaled so the biggest counts SIGNAL_WEIGHT.seed and 900 imported
 * likes cannot drown out what the listener plays here. Names are merged case-insensitively first.
 */
export function importSeedWeights(counts: readonly { name: string; count: number }[]): { name: string; weight: number }[] {
  const merged = new Map<string, { name: string; count: number }>();
  for (const { name, count } of counts) {
    const trimmed = name.trim();
    if (!trimmed || !(count > 0)) continue;
    const key = trimmed.toLowerCase();
    const seen = merged.get(key);
    merged.set(key, { name: seen?.name ?? trimmed, count: (seen?.count ?? 0) + count });
  }
  const top = [...merged.values()].sort((a, b) => b.count - a.count).slice(0, IMPORT_SEED_MAX_ARTISTS);
  const max = top[0]?.count ?? 0;
  return top.map(({ name, count }) => ({ name, weight: max > 0 ? (SIGNAL_WEIGHT.seed * Math.log2(1 + count)) / Math.log2(1 + max) : 0 }));
}

/**
 * One seed per top artist of an import; languages are left alone. The existing taste fades as it
 * would over that many signals, but the seeds are added together, undecayed: applied one by one,
 * each bump would fade the ones before it and the import's biggest artist would land lowest.
 */
export function applyImportSeed(taste: TasteProfile | undefined, counts: readonly { name: string; count: number }[], now = new Date()): TasteProfile {
  const base = taste ?? emptyTaste(now);
  const weights = importSeedWeights(counts);
  const fade = DECAY ** weights.length;
  const scores = new Map<string, TasteEntry>();
  for (const entry of base.artists) scores.set(entry.name.toLowerCase(), { name: entry.name, score: entry.score * fade });
  for (const { name, weight } of weights) {
    const seen = scores.get(name.toLowerCase());
    scores.set(name.toLowerCase(), { name: seen?.name ?? name, score: (seen?.score ?? 0) + weight });
  }
  const artists = [...scores.values()]
    .filter((entry) => entry.score > 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_ARTISTS)
    .map((entry) => ({ name: entry.name, score: Math.round(entry.score * 1000) / 1000 }));
  return { artists, languages: base.languages, signals: base.signals + weights.length, onboarded: true, updatedAt: now.toISOString() };
}

/** How a listen ended, as a client that reports it says (`POST /api/me/taste/signal`). */
export interface ListenEnding {
  readonly exit: ListenExit;
  readonly exitPositionSec?: number;
}

/**
 * A play counts by how much of it was heard and how it ended. With the ending known, the shared
 * rule applies: heard out (or left in the last 15 s) is a vote for, left inside 30 s a vote
 * against, anything between says nothing. Older clients send seconds only and keep the rule they
 * were built against: a few seconds is a vote against, most of a song a vote for.
 */
export function playWeight(playedSeconds: number, songSeconds: number, ending?: ListenEnding): number {
  if (ending) {
    return LONG_TERM_WEIGHT[listenVerdict({ heardSeconds: playedSeconds, exit: ending.exit, exitPositionSec: ending.exitPositionSec, durationSec: songSeconds })];
  }
  if (playedSeconds < 10) return SIGNAL_WEIGHT.skip;
  const heard = songSeconds > 0 ? playedSeconds / songSeconds : 1;
  return heard >= 0.5 || playedSeconds >= 60 ? SIGNAL_WEIGHT.play : 0.4;
}

export interface TasteSummary {
  readonly topArtists: { name: string; score: number }[];
  readonly languages: { name: string; score: number }[];
  readonly signals: number;
  readonly onboarded: boolean;
  readonly prompts: string[];
}

/** The slice of taste the browser and MCP need: who they love, in what language, and whether to ask them to pick favourites. */
export function tasteSummary(taste: TasteProfile | undefined): TasteSummary {
  const value = taste ?? emptyTaste();
  const summary = {
    topArtists: value.artists.slice(0, 12).map((entry) => ({ name: entry.name, score: entry.score })),
    languages: value.languages.slice(0, 5).map((entry) => ({ name: entry.name, score: entry.score })),
    signals: value.signals,
    onboarded: value.onboarded
  };
  return { ...summary, prompts: deriveMoodPrompts(summary) };
}

/** Two profiles of the same person (a guest session and the account they then signed into): scores add up. */
export function mergeTaste(left: TasteProfile, right: TasteProfile): TasteProfile {
  const combine = (a: readonly TasteEntry[], b: readonly TasteEntry[], keep: number): TasteEntry[] => {
    const map = new Map<string, TasteEntry>();
    for (const entry of [...a, ...b]) {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      map.set(key, { name: current?.name ?? entry.name, score: (current?.score ?? 0) + entry.score });
    }
    return [...map.values()].sort((x, y) => y.score - x.score).slice(0, keep);
  };
  return {
    artists: combine(left.artists, right.artists, MAX_ARTISTS),
    languages: combine(left.languages, right.languages, MAX_LANGUAGES),
    signals: left.signals + right.signals,
    onboarded: left.onboarded || right.onboarded,
    updatedAt: left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt
  };
}
