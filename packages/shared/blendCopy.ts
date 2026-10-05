/**
 * Every Blend sentence a listener reads, from PLAN.md §9, in one place: the website's story cards
 * and share images and the phone's screens all draw from here, so they always say the same thing.
 * No pronouns are guessed: other members are named. Pure; no npm imports (the phone bundles it).
 */
import type { Story } from './blendStories';
import type { BlendTrack, ChangeReason } from './blendTypes';
import type { BlendDetail, BlendMemberView } from './blendView';
import { creditedArtists } from './identity';

export const BLEND_TEXT = {
  consentTitle: 'Blend your taste with a friend',
  consentBody: 'Your most-played songs, likes and playlists shape a playlist that everyone in this Blend can see. They see songs and your taste match, never how much you listen. You can leave at any time.',
  signin: "Sign in to make a Blend. Blends need an account so your friend knows it's you.",
  full: 'This Blend is full.',
  expired: 'This invite has expired. Ask for a new link.',
  notfound: "We couldn't find that Blend. The link may be wrong or the Blend may have ended.",
  limit: "You're in 20 Blends, the most there can be. Leave one to join this.",
  notenough: 'Not enough to blend yet. Like a few songs or keep listening, and it fills in.',
  lowconfidence: 'Early days — estimated from limited taste data',
  storySong: 'The song that brings you two together',
  storyClosest: 'The closest you get',
  storyGlue: 'What holds this group together',
  newForYou: 'A new suggestion for you both'
} as const;

export const learningOffText = (name: string): string => `${name}'s picks come from likes and playlists.`;

export function changeText(change: ChangeReason, artist: string): string {
  return change.kind === 'up'
    ? `Up ${change.points} points: your overlap around ${artist} increased.`
    : `Down ${change.points} points: your overlap around ${artist} decreased.`;
}

/** An artist key ('arijit singh') as the catalog spells it, from the Blend's own tracks. */
export function artistName(key: string, tracks: readonly BlendTrack[]): string {
  for (const track of tracks) {
    for (const name of creditedArtists(track.song.artist)) if (name.trim().toLowerCase() === key) return name.trim();
  }
  return key.replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}

const nameOf = (members: readonly BlendMemberView[], userId: string): string => members.find((member) => member.userId === userId)?.displayName ?? 'Someone';
const isYou = (members: readonly BlendMemberView[], userId: string): boolean => members.find((member) => member.userId === userId)?.isYou === true;

export interface StoryText {
  readonly eyebrow: string;
  readonly headline: string;
  readonly detail?: string;
}

/** The words of one story card. */
export function storyText(story: Story, detail: Pick<BlendDetail, 'members' | 'tracks'>): StoryText {
  const { members, tracks } = detail;
  switch (story.kind) {
    case 'match':
      return {
        eyebrow: 'Taste match',
        headline: `${story.match}%`,
        ...(story.change ? { detail: changeText(story.change, artistName(story.change.artist, tracks)) } : story.confidence === 'low' ? { detail: BLEND_TEXT.lowconfidence } : {})
      };
    case 'song':
      return {
        eyebrow: story.variant === 'together' ? BLEND_TEXT.storySong : BLEND_TEXT.storyClosest,
        headline: story.song?.title ?? 'A song you share',
        ...(story.song ? { detail: story.song.artist } : {})
      };
    case 'directions': {
      const other = nameOf(members, story.otherUserId);
      return { eyebrow: 'Estimated overlap', headline: `${story.youEnjoyTheirs}% of ${other}'s picks fit your taste.`, detail: `${story.theyEnjoyYours}% of your picks fit ${other}'s taste. These are estimates.` };
    }
    case 'artist':
      return { eyebrow: 'The artist that brings you together', headline: artistName(story.artist, tracks) };
    case 'gift': {
      const from = isYou(members, story.fromUserId) ? 'Your' : `${nameOf(members, story.fromUserId)}'s`;
      const to = isYou(members, story.toUserId) ? 'you' : nameOf(members, story.toUserId);
      const listener = isYou(members, story.toUserId) ? 'A song outside your current picks that may fit your taste.' : `A song outside ${to}'s current picks that may fit their taste.`;
      return { eyebrow: `${from} gift to ${to}`, headline: story.song ? `${story.song.title} by ${story.song.artist}` : 'A song to try', detail: listener };
    }
    case 'brought':
      return {
        eyebrow: 'Who brought what',
        headline: story.counts.map(({ userId, songs }) => `${isYou(members, userId) ? 'You' : nameOf(members, userId)}: ${songs}`).join(' · '),
        detail: 'Songs from each of you in today’s mix.'
      };
    case 'groupMatch':
      return { eyebrow: 'Group match', headline: `Group match: ${story.match}%` };
    case 'mostInTune':
      return { eyebrow: 'Closest to you', headline: `Most in tune with you: ${nameOf(members, story.userId)}, ${story.match}%` };
    case 'leastInTune':
      return { eyebrow: 'Furthest from you', headline: `Least in tune with you: ${nameOf(members, story.userId)}, ${story.match}%` };
    case 'glue':
      return { eyebrow: BLEND_TEXT.storyGlue, headline: story.artists.map((artist) => artistName(artist, tracks)).join(', ') };
    default: {
      const unknown: never = story;
      return unknown;
    }
  }
}

/** Greedy word wrap for the share image: `measure` returns a string's drawn width. */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number, maxLines = 4): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''}…`;
  return kept;
}
