import { personalMoodMix, moodWord, type Taste } from './moodMix';
import type { YTSong } from '../ytmusic/parsers';
export async function moodRecommendations(label: string, taste: Taste, search: (query: string) => Promise<YTSong[]>): Promise<{ songs: YTSong[]; personalized: boolean }> {
  const personal = await personalMoodMix(label, taste, search, 8);
  if (personal.length) return { songs: personal, personalized: true };
  const found = await search(`${taste.languages[0] ?? ''} ${moodWord(label)} songs`.trim());
  const unique = new Map(found.map(song => [song.videoId, song]));
  return { songs: [...unique.values()].slice(0, 8), personalized: false };
}
