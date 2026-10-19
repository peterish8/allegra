const GENRE_DEFINITIONS = [
  { id: 'bollywood', label: 'Bollywood', emoji: '🎬', note: 'Film favorites', query: 'Hindi Bollywood movie songs', tint: '#ee6b5f', seedArtists: ['Arijit Singh', 'Shreya Ghoshal', 'Pritam', 'Mithoon', 'Tanishk Bagchi', 'Vishal-Shekhar'], languages: ['hindi'] },
  { id: 'pop', label: 'Pop', emoji: '🎤', note: 'Big hooks, bright energy', query: 'pop hits songs', tint: '#d9e66a', seedArtists: ['Taylor Swift', 'Dua Lipa', 'Ed Sheeran', 'Sabrina Carpenter', 'Billie Eilish'], languages: ['english'] },
  { id: 'hiphop', label: 'Hip-Hop', emoji: '🎧', note: 'Beats and bars', query: 'Hindi hip hop rap songs', tint: '#783e44', seedArtists: ['Badshah', 'DIVINE', 'Emiway Bantai', 'Raftaar', 'Naezy'], languages: ['hindi', 'punjabi'] },
  { id: 'punjabi', label: 'Punjabi', emoji: '🥁', note: 'Loud and full of heart', query: 'Punjabi pop hits', tint: '#ffaaa0', seedArtists: ['Diljit Dosanjh', 'Badshah', 'Karan Aujla', 'AP Dhillon', 'Sidhu Moose Wala'], languages: ['punjabi'] },
  { id: 'indie', label: 'Indie & Alt', emoji: '🌙', note: 'A little off the main road', query: 'Indian indie alternative songs', tint: '#7bafd4', seedArtists: ['Prateek Kuhad', 'Anuv Jain', 'The Local Train', 'When Chai Met Toast'], languages: ['english', 'hindi'] },
  { id: 'electronic', label: 'Electronic', emoji: '⚡', note: 'Pulse and momentum', query: 'electronic dance music hits', tint: '#9b8bd0', seedArtists: ['Calvin Harris', 'David Guetta', 'Alan Walker', 'Marshmello', 'Martin Garrix'], languages: ['english'] },
  { id: 'rnb', label: 'R&B & Soul', emoji: '💫', note: 'Warm, smooth vocals', query: 'R&B soul music songs', tint: '#6fc3a0', seedArtists: ['The Weeknd', 'SZA', 'H.E.R.', 'Usher', 'Sid Sriram'], languages: ['english', 'tamil'] },
  { id: 'retro', label: 'Retro classics', emoji: '📻', note: 'Songs that stay with you', query: 'classic Hindi retro songs', tint: '#f0a05a', seedArtists: ['Kishore Kumar', 'Lata Mangeshkar', 'Sonu Nigam', 'Asha Bhosle', 'R. D. Burman'], languages: ['hindi'] },
  { id: 'southindian', label: 'Tamil & Telugu', emoji: '🪘', note: 'South Indian favorites', query: 'Tamil Telugu film songs', tint: '#7bafd4', seedArtists: ['Anirudh Ravichander', 'Sid Sriram', 'A. R. Rahman', 'Harris Jayaraj', 'Yuvan Shankar Raja'], languages: ['tamil', 'telugu', 'malayalam', 'kannada'] },
  { id: 'acoustic', label: 'Acoustic', emoji: '🎸', note: 'Stripped back, front and center', query: 'acoustic guitar songs', tint: '#9b8bd0', seedArtists: ['Ed Sheeran', 'Atif Aslam', 'Prateek Kuhad', 'Anuv Jain'], languages: ['english', 'hindi'] }
] as const;

export type MusicGenreId = typeof GENRE_DEFINITIONS[number]['id'];

export interface MusicGenre {
  readonly id: MusicGenreId;
  readonly label: string;
  readonly emoji: string;
  readonly note: string;
  readonly query: string;
  readonly tint: string;
  readonly seedArtists: readonly string[];
  readonly languages: readonly string[];
}

export const MUSIC_GENRES: readonly MusicGenre[] = GENRE_DEFINITIONS;

export interface GenreTasteSignals {
  readonly genres?: readonly string[];
  readonly topArtists?: readonly { readonly name: string; readonly score: number }[];
  readonly languages?: readonly { readonly name: string; readonly score: number }[];
}

const GENRE_BY_ID = new Map<string, MusicGenre>(MUSIC_GENRES.map((genre) => [genre.id, genre]));

export function normalizeMusicGenreIds(values: readonly string[]): MusicGenreId[] {
  const seen = new Set<MusicGenreId>();
  const genres: MusicGenreId[] = [];
  for (const value of values) {
    const genre = GENRE_BY_ID.get(value.trim().toLocaleLowerCase());
    if (!genre || seen.has(genre.id)) continue;
    seen.add(genre.id);
    genres.push(genre.id);
    if (genres.length >= MUSIC_GENRES.length) break;
  }
  return genres;
}

/** Explicit picks lead; listening affinity fills the row before the general discovery defaults. */
export function recommendGenres(taste: GenreTasteSignals | null | undefined, limit = 6): MusicGenre[] {
  const selectedIds = normalizeMusicGenreIds(taste?.genres ?? []);
  const selected = selectedIds.flatMap((id) => {
    const genre = GENRE_BY_ID.get(id);
    return genre ? [genre] : [];
  });
  const selectedSet = new Set(selectedIds);
  const artistScores = new Map((taste?.topArtists ?? []).map((artist) => [artist.name.toLocaleLowerCase(), artist.score]));
  const languageScores = new Map((taste?.languages ?? []).map((language) => [language.name.toLocaleLowerCase(), language.score]));
  const affinity = MUSIC_GENRES
    .filter((genre) => !selectedSet.has(genre.id))
    .map((genre, index) => ({
      genre,
      index,
      score: genre.seedArtists.reduce((total, artist) => total + (artistScores.get(artist.toLocaleLowerCase()) ?? 0), 0)
        + genre.languages.reduce((total, language) => total + (languageScores.get(language) ?? 0) * 0.35, 0)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ genre }) => genre);
  const ordered = [...selected, ...affinity];
  return ordered.slice(0, Math.min(Math.max(0, limit), ordered.length));
}

/** Favorite artists lead; genre seeds make a useful artist row before a listener has history. */
export function recommendArtistNames(taste: GenreTasteSignals | null | undefined, limit = 6): string[] {
  const maxNames = Math.max(0, Math.floor(limit));
  if (maxNames === 0) return [];
  const selectedIds = new Set(normalizeMusicGenreIds(taste?.genres ?? []));
  const genres = recommendGenres(taste, MUSIC_GENRES.length);
  const preferredGenres = selectedIds.size > 0 ? genres.filter((genre) => selectedIds.has(genre.id)) : genres;
  const names = [...(taste?.topArtists ?? []).map((artist) => artist.name), ...preferredGenres.flatMap((genre) => genre.seedArtists)];
  const seen = new Set<string>();
  const recommendations: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recommendations.push(trimmed);
    if (recommendations.length >= maxNames) break;
  }
  return recommendations;
}

export function genreSearchQuery(genre: MusicGenre, taste: GenreTasteSignals | null | undefined): string {
  const familiarArtist = (taste?.topArtists ?? []).find((artist) => genre.seedArtists.some((seed) => seed.toLocaleLowerCase() === artist.name.toLocaleLowerCase()));
  const matchingLanguage = (taste?.languages ?? []).find((language) => genre.languages.includes(language.name.toLocaleLowerCase()));
  return [genre.query, familiarArtist?.name, matchingLanguage?.name].filter((part): part is string => Boolean(part)).join(' ');
}

export function genrePersonalNote(genre: MusicGenre, taste: GenreTasteSignals | null | undefined): string {
  const familiarArtist = (taste?.topArtists ?? []).find((artist) => genre.seedArtists.some((seed) => seed.toLocaleLowerCase() === artist.name.toLocaleLowerCase()));
  if (familiarArtist) return `With ${familiarArtist.name}`;
  const matchingLanguage = (taste?.languages ?? []).find((language) => genre.languages.includes(language.name.toLocaleLowerCase()));
  return matchingLanguage ? `${matchingLanguage.name} favorites` : genre.note;
}
