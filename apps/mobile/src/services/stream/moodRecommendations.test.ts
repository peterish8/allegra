import { moodRecommendations } from './moodRecommendations';
import type { YTSong } from '../ytmusic/parsers';
const track = { videoId: 'a', title: 'Song', artists: ['Artist'], thumbnail: '', duration: 120 } as YTSong;
test('A new listener receives real mood search results without a personalization claim', async () => {
  const search = jest.fn(async () => [track, track]);
  const answer = await moodRecommendations('Commute', { artists: [], languages: [] }, search);
  expect(search).toHaveBeenCalledWith('road trip songs');
  expect(answer).toEqual({ songs: [track], personalized: false });
});
test('Known taste uses the existing artist and language mood search', async () => {
  const search = jest.fn(async () => [track]);
  const answer = await moodRecommendations('Relax', { artists: ['Artist'], languages: [] }, search);
  expect(search).toHaveBeenCalledWith('Artist chill songs');
  expect(answer.personalized).toBe(true);
});
test('A failed fallback stays an error instead of pretending no songs exist', async () => {
  await expect(moodRecommendations('Sad', { artists: [], languages: [] }, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
});
