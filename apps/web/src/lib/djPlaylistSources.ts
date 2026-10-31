export function samplePlaylistTracks<T>(tracks: readonly T[], limit: number): T[] {
  const count = Math.max(0, Math.floor(limit));
  if (count === 0 || tracks.length === 0) return [];
  if (tracks.length <= count) return [...tracks];
  if (count === 1) return [tracks[0] as T];

  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round(index * (tracks.length - 1) / (count - 1));
    return tracks[sourceIndex] as T;
  });
}
