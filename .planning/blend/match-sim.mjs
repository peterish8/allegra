// Simulates the proposed Blend match on synthetic listeners to check it orders pairs sensibly.
const TAU = 0.02, GAMMA = 0.75, K_SHRINK = 8, PRIOR = 0.2, RARE = 0.5;
const LEVEL = { song: 1, artist: 0.85, neighbour: 0.4, language: 0.15 };

// A tiny world: artists with popularity (0 = niche, 1 = superstar), language, similar artists.
const ARTISTS = {
  arijit: { pop: 0.95, lang: 'hindi', similar: ['pritam', 'atif'] },
  pritam: { pop: 0.8, lang: 'hindi', similar: ['arijit'] },
  atif: { pop: 0.7, lang: 'hindi', similar: ['arijit'] },
  shreya: { pop: 0.8, lang: 'hindi', similar: ['arijit'] },
  rahman: { pop: 0.85, lang: 'tamil', similar: ['anirudh'] },
  anirudh: { pop: 0.85, lang: 'tamil', similar: ['rahman'] },
  indieX: { pop: 0.1, lang: 'hindi', similar: ['indieY'] },
  indieY: { pop: 0.1, lang: 'hindi', similar: ['indieX'] },
  diljit: { pop: 0.85, lang: 'punjabi', similar: ['karan'] },
  karan: { pop: 0.7, lang: 'punjabi', similar: ['diljit'] },
  weeknd: { pop: 0.95, lang: 'english', similar: ['dua'] },
  dua: { pop: 0.9, lang: 'english', similar: ['weeknd'] },
  metalZ: { pop: 0.05, lang: 'english', similar: [] }
};
let rngState = 7;
const rng = () => ((rngState = (rngState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
// A listener: artist mix → songs. Each artist has 60 songs; listener picks from the artist's catalogue.
function listener(mix, songsPerArtist = 25, offset = 0) {
  const p = new Map();
  for (const [artist, share] of Object.entries(mix)) {
    for (let k = 0; k < songsPerArtist; k += 1) {
      const id = `${artist}#${(k * 2 + offset + Math.floor(rng() * 6)) % 60}`;
      p.set(id, (p.get(id) ?? 0) + share / songsPerArtist);
    }
  }
  const total = [...p.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of p) p.set(k, v / total);
  return p;
}
const artistOf = (song) => song.split('#')[0];
function artistDist(p) {
  const q = new Map();
  for (const [s, w] of p) q.set(artistOf(s), (q.get(artistOf(s)) ?? 0) + w);
  return q;
}
function langs(q) {
  const l = new Map();
  for (const [a, w] of q) l.set(ARTISTS[a].lang, (l.get(ARTISTS[a].lang) ?? 0) + w);
  return new Set([...l].filter(([, w]) => w >= 0.1).map(([k]) => k));
}
const aff = (q, a) => Math.min(1, (q.get(a) ?? 0) / TAU);
function credit(song, B) {
  const a = artistOf(song);
  const meta = ARTISTS[a];
  const songLevel = B.p.has(song) ? LEVEL.song : 0;
  const artistLevel = LEVEL.artist * aff(B.q, a);
  const neighbour = LEVEL.neighbour * Math.max(0, ...meta.similar.map((s) => aff(B.q, s)));
  const language = B.langs.has(meta.lang) ? LEVEL.language : 0;
  return Math.max(songLevel, artistLevel, neighbour, language);
}
const profile = (p) => { const q = artistDist(p); return { p, q, langs: langs(q), neff: 1 / [...p.values()].reduce((s, w) => s + w * w, 0) }; };
function coverage(A, B) { let c = 0; for (const [s, w] of A.p) c += w * credit(s, B); return c; }
function match(pa, pb) {
  const A = profile(pa), B = profile(pb);
  const ca = coverage(A, B), cb = coverage(B, A);
  let rare = 0;
  for (const [a, w] of A.q) rare += Math.min(w, B.q.get(a) ?? 0) * (1 - ARTISTS[a].pop);
  const M = Math.sqrt(ca * cb) + (1 - Math.sqrt(ca * cb)) * RARE * rare;
  const lambda = Math.min(A.neff / (A.neff + K_SHRINK), B.neff / (B.neff + K_SHRINK));
  const shrunk = lambda * M + (1 - lambda) * PRIOR;
  return { pct: Math.round(100 * shrunk ** GAMMA), youEnjoyTheirs: Math.round(100 * cb), theyEnjoyYours: Math.round(100 * ca), lambda: lambda.toFixed(2), rare: rare.toFixed(2) };
}
const hindiPop = { arijit: 0.4, pritam: 0.3, shreya: 0.3 };
const cases = {
  'same listener, other days': [listener(hindiPop, 25, 0), listener(hindiPop, 25, 1)],
  'both Arijit-heavy, different 2nd artist': [listener({ arijit: 0.6, pritam: 0.4 }), listener({ arijit: 0.6, atif: 0.4 }, 25, 3)],
  'shared niche indie + some pop': [listener({ indieX: 0.5, arijit: 0.5 }), listener({ indieX: 0.5, diljit: 0.5 }, 25, 2)],
  'superstar only overlap (Arijit)': [listener({ arijit: 0.3, rahman: 0.7 }), listener({ arijit: 0.3, diljit: 0.7 }, 25, 5)],
  'neighbours only (Arijit vs Pritam/Atif)': [listener({ arijit: 1 }), listener({ pritam: 0.5, atif: 0.5 })],
  'same language, no shared artist': [listener({ arijit: 0.5, shreya: 0.5 }), listener({ indieY: 1 })],
  'Tamil vs Punjabi': [listener({ rahman: 0.5, anirudh: 0.5 }), listener({ diljit: 0.5, karan: 0.5 })],
  'English pop vs metal': [listener({ weeknd: 0.5, dua: 0.5 }), listener({ metalZ: 1 })],
  'broad vs narrow subset': [listener({ arijit: 0.2, pritam: 0.2, rahman: 0.2, diljit: 0.2, weeknd: 0.2 }, 40), listener({ arijit: 1 }, 15)],
  'thin profile (3 songs each, same artist)': [listener({ arijit: 1 }, 3), listener({ arijit: 1 }, 3, 1)],
  '900 imported likes vs 60-song listener': [listener(hindiPop, 300), listener({ arijit: 0.7, diljit: 0.3 }, 30)]
};
for (const [name, [a, b]] of Object.entries(cases)) console.log(name.padEnd(44), JSON.stringify(match(a, b)));

// ── Builder: greedy Nash welfare over predicted enjoyment ──
function enjoyment(song, M) {
  if (M.p.has(song)) {
    const ranked = [...M.p.values()].sort((x, y) => y - x);
    const tenth = ranked[Math.min(9, ranked.length - 1)];
    return 0.6 + 0.4 * Math.min(1, M.p.get(song) / tenth);
  }
  return credit(song, M);
}
function build(members, size = 50) {
  const P = members.map(profile);
  const candidates = [...new Set(P.flatMap((m) => [...m.p.keys()]))];
  const U = P.map(() => 0);
  const chosen = [];
  const owners = P.map(() => 0);
  let shared = 0;
  while (chosen.length < size && candidates.length) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      const s = candidates[i];
      let gain = 0;
      P.forEach((m, k) => { gain += Math.log(1 + enjoyment(s, m) / (1 + U[k])); });
      const recent = chosen.slice(-4).map(artistOf);
      if (recent.includes(artistOf(s))) gain *= 0.3;
      if (gain > bestScore) { bestScore = gain; best = i; }
    }
    const [s] = candidates.splice(best, 1);
    P.forEach((m, k) => { U[k] += enjoyment(s, m); });
    const forWho = P.map((m, k) => (m.p.has(s) ? k : -1)).filter((k) => k >= 0);
    forWho.forEach((k) => { owners[k] += 1; });
    if (forWho.length > 1) shared += 1;
    chosen.push(s);
  }
  return { owned: owners, shared, avgEnjoy: U.map((u) => (u / chosen.length).toFixed(2)) };
}
console.log('--- builder');
console.log('900 likes vs 60 songs    ', JSON.stringify(build([listener(hindiPop, 300), listener({ arijit: 0.7, diljit: 0.3 }, 30)])));
console.log('Tamil vs Punjabi         ', JSON.stringify(build([listener({ rahman: 0.5, anirudh: 0.5 }), listener({ diljit: 0.5, karan: 0.5 })])));
console.log('twins                    ', JSON.stringify(build([listener(hindiPop, 25, 0), listener(hindiPop, 25, 1)])));
console.log('3 people mixed           ', JSON.stringify(build([listener(hindiPop), listener({ arijit: 0.5, diljit: 0.5 }, 25, 2), listener({ weeknd: 0.6, arijit: 0.4 }, 25, 4)])));

// ── The song that brings two people together ──
function togetherSong(pa, pb) {
  const A = profile(pa), B = profile(pb);
  let best = null, bestScore = -1;
  for (const s of new Set([...A.p.keys(), ...B.p.keys()])) {
    const eA = A.p.has(s) ? 1 : credit(s, A), eB = B.p.has(s) ? 1 : credit(s, B);
    const pop = ARTISTS[artistOf(s)].pop; // stand-in for song popularity
    const score = ((A.p.get(s) ?? 0) + (B.p.get(s) ?? 0)) * Math.min(eA, eB) * (1 - 0.3 * pop);
    if (score > bestScore) { bestScore = score; best = { song: s, minEnjoy: Math.min(eA, eB).toFixed(2) }; }
  }
  const card = Number(best.minEnjoy) >= 0.5 ? 'together' : Number(best.minEnjoy) >= 0.3 ? 'closest' : 'none';
  return { ...best, card };
}
console.log('--- together song');
for (const name of ['both Arijit-heavy, different 2nd artist', 'shared niche indie + some pop', 'neighbours only (Arijit vs Pritam/Atif)', 'same language, no shared artist', 'Tamil vs Punjabi']) {
  const [a, b] = cases[name];
  console.log(name.padEnd(44), JSON.stringify(togetherSong(a, b)));
}
