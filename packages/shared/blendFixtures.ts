/**
 * Test-only: the synthetic world of `.planning/blend/match-sim.mjs`, ported so the match and the
 * builder are tested on the same listeners the plan's tables came from. Not synced to the API.
 *
 * The listener generator uses the simulation's LCG with the same seed and the same construction
 * order, so a case here is the same listener as the case of the same name there.
 */
import type { ArtistFacts, ArtistFactsMap, MemberTaste } from './blendTypes';
import { memberTaste } from './blendTaste';

const WORLD: Record<string, { pop: number; lang: string; similar: string[] }> = {
  arijit: { pop: 0.95, lang: 'hindi', similar: ['pritam', 'atif'] },
  pritam: { pop: 0.8, lang: 'hindi', similar: ['arijit'] },
  atif: { pop: 0.7, lang: 'hindi', similar: ['arijit'] },
  shreya: { pop: 0.8, lang: 'hindi', similar: ['arijit'] },
  rahman: { pop: 0.85, lang: 'tamil', similar: ['anirudh'] },
  anirudh: { pop: 0.85, lang: 'tamil', similar: ['rahman'] },
  indiex: { pop: 0.1, lang: 'hindi', similar: ['indiey'] },
  indiey: { pop: 0.1, lang: 'hindi', similar: ['indiex'] },
  diljit: { pop: 0.85, lang: 'punjabi', similar: ['karan'] },
  karan: { pop: 0.7, lang: 'punjabi', similar: ['diljit'] },
  weeknd: { pop: 0.95, lang: 'english', similar: ['dua'] },
  dua: { pop: 0.9, lang: 'english', similar: ['weeknd'] },
  metalz: { pop: 0.05, lang: 'english', similar: [] }
};

export const FACTS: ArtistFactsMap = new Map(
  Object.entries(WORLD).map(([key, { pop, lang, similar }]): [string, ArtistFacts] => [key, { key, popularity: pop, language: lang, similar }])
);

export const artistOf = (identity: string): string => identity.split('#')[0] ?? '';

/** A generator of listeners sharing one LCG stream, exactly as the simulation's module-level state. */
export function world(seed = 7) {
  let state = seed;
  const rng = (): number => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let next = 0;
  return (mix: Record<string, number>, songsPerArtist = 25, offset = 0, userId = `u${++next}`): MemberTaste => {
    const p = new Map<string, number>();
    for (const [artist, share] of Object.entries(mix)) {
      for (let k = 0; k < songsPerArtist; k += 1) {
        const id = `${artist}#${(k * 2 + offset + Math.floor(rng() * 6)) % 60}`;
        p.set(id, (p.get(id) ?? 0) + share / songsPerArtist);
      }
    }
    return memberTaste({
      userId,
      // The simulation uses relative shares; production Now inputs use tally units.
      // Scaling preserves its distribution while keeping the fixture above the expiry floor.
      now: [...p].map(([identity, weight]) => ({ identity, artist: artistOf(identity), weight: weight * 1000 })),
      loved: [],
      kept: [],
      learning: true,
      facts: FACTS
    });
  };
}

const HINDI_POP = { arijit: 0.4, pritam: 0.3, shreya: 0.3 };

/** The simulation's eleven pairs, built in its order from one stream. */
export function simCases(): Record<string, readonly [MemberTaste, MemberTaste]> {
  const listener = world();
  const pair = (a: MemberTaste, b: MemberTaste) => [a, b] as const;
  return {
    'same listener, other days': pair(listener(HINDI_POP, 25, 0), listener(HINDI_POP, 25, 1)),
    'both Arijit-heavy, different 2nd artist': pair(listener({ arijit: 0.6, pritam: 0.4 }), listener({ arijit: 0.6, atif: 0.4 }, 25, 3)),
    'shared niche indie + some pop': pair(listener({ indiex: 0.5, arijit: 0.5 }), listener({ indiex: 0.5, diljit: 0.5 }, 25, 2)),
    'superstar only overlap (Arijit)': pair(listener({ arijit: 0.3, rahman: 0.7 }), listener({ arijit: 0.3, diljit: 0.7 }, 25, 5)),
    'neighbours only (Arijit vs Pritam/Atif)': pair(listener({ arijit: 1 }), listener({ pritam: 0.5, atif: 0.5 })),
    'same language, no shared artist': pair(listener({ arijit: 0.5, shreya: 0.5 }), listener({ indiey: 1 })),
    'Tamil vs Punjabi': pair(listener({ rahman: 0.5, anirudh: 0.5 }), listener({ diljit: 0.5, karan: 0.5 })),
    'English pop vs metal': pair(listener({ weeknd: 0.5, dua: 0.5 }), listener({ metalz: 1 })),
    'broad vs narrow subset': pair(listener({ arijit: 0.2, pritam: 0.2, rahman: 0.2, diljit: 0.2, weeknd: 0.2 }, 40), listener({ arijit: 1 }, 15)),
    'thin profile (3 songs each, same artist)': pair(listener({ arijit: 1 }, 3), listener({ arijit: 1 }, 3, 1)),
    '900 imported likes vs 60-song listener': pair(listener(HINDI_POP, 300), listener({ arijit: 0.7, diljit: 0.3 }, 30))
  };
}

/** The simulation's builder groups (built after the cases, continuing the same stream). */
export function simGroups(): Record<string, readonly MemberTaste[]> {
  const listener = world();
  simCasesFrom(listener);
  return {
    '900 likes vs 60 songs': [listener(HINDI_POP, 300), listener({ arijit: 0.7, diljit: 0.3 }, 30)],
    'Tamil vs Punjabi': [listener({ rahman: 0.5, anirudh: 0.5 }), listener({ diljit: 0.5, karan: 0.5 })],
    twins: [listener(HINDI_POP, 25, 0), listener(HINDI_POP, 25, 1)],
    '3 people mixed': [listener(HINDI_POP), listener({ arijit: 0.5, diljit: 0.5 }, 25, 2), listener({ weeknd: 0.6, arijit: 0.4 }, 25, 4)]
  };
}

/** Advances a stream past the eleven cases, as the simulation does before its builder runs. */
function simCasesFrom(listener: ReturnType<typeof world>): void {
  const mixes: [Record<string, number>, number?, number?][] = [
    [HINDI_POP, 25, 0], [HINDI_POP, 25, 1],
    [{ arijit: 0.6, pritam: 0.4 }], [{ arijit: 0.6, atif: 0.4 }, 25, 3],
    [{ indiex: 0.5, arijit: 0.5 }], [{ indiex: 0.5, diljit: 0.5 }, 25, 2],
    [{ arijit: 0.3, rahman: 0.7 }], [{ arijit: 0.3, diljit: 0.7 }, 25, 5],
    [{ arijit: 1 }], [{ pritam: 0.5, atif: 0.5 }],
    [{ arijit: 0.5, shreya: 0.5 }], [{ indiey: 1 }],
    [{ rahman: 0.5, anirudh: 0.5 }], [{ diljit: 0.5, karan: 0.5 }],
    [{ weeknd: 0.5, dua: 0.5 }], [{ metalz: 1 }],
    [{ arijit: 0.2, pritam: 0.2, rahman: 0.2, diljit: 0.2, weeknd: 0.2 }, 40], [{ arijit: 1 }, 15],
    [{ arijit: 1 }, 3], [{ arijit: 1 }, 3, 1],
    [HINDI_POP, 300], [{ arijit: 0.7, diljit: 0.3 }, 30]
  ];
  for (const [mix, songs, offset] of mixes) listener(mix, songs ?? 25, offset ?? 0);
}
