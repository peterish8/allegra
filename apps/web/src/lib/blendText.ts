/**
 * The website's Blend text: the shared copy (packages/shared/blendCopy.ts) and how a Blend track
 * becomes a playable song here.
 */
import type { BlendTrack } from '@shared/blendTypes';
import type { UnifiedSong } from '@shared/types';

export { artistName, BLEND_TEXT, changeText, learningOffText, storyText, wrapText, type StoryText } from '@shared/blendCopy';

/** A Blend track as a playable song. Every Blend track is a Saavn ref (D15), so it streams by id. */
export function blendTrackSong(track: BlendTrack): UnifiedSong {
  const id = track.song.ref.startsWith('saavn:') ? track.song.ref.slice('saavn:'.length) : track.song.ref;
  return {
    id,
    title: track.song.title,
    artist: track.song.artist,
    ...(track.song.album ? { album: track.song.album } : {}),
    artwork: track.song.artwork,
    streamUrl: `/api/stream/${encodeURIComponent(id)}`,
    duration: track.song.duration,
    hasLyrics: false,
    playCount: 0,
    source: 'Saavn'
  };
}

