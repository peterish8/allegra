import { Play, Share2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { Story } from '@shared/blendStories';
import type { BlendDetail } from '@shared/blendView';
import type { UnifiedSong } from '@shared/types';

import { blendTrackSong, storyText } from '../../lib/blendText';
import { DEFAULT_PALETTE, type Palette } from '../../lib/palette';
import { motionTokens } from '../../motion';
import { BlendTones } from './MemberDisc';
import { shareStoryCard, storyCardBlob } from './shareCard';

/** One card per story. The exhaustive switch makes a new Story kind a type error until it is drawn. */
function StoryCard({ story, detail, onPlay }: { readonly story: Story; readonly detail: BlendDetail; readonly onPlay: (song: UnifiedSong) => void }) {
  const text = storyText(story, detail);
  switch (story.kind) {
    case 'song':
    case 'gift': {
      const song = story.song;
      return (
        <div className="story-card__body">
          <p className="story-card__eyebrow">{text.eyebrow}</p>
          {song?.artwork ? <img className="story-card__art" src={song.artwork} alt="" width={120} height={120} loading="lazy" /> : null}
          <p className="story-card__headline">{text.headline}</p>
          {text.detail ? <p className="story-card__detail">{text.detail}</p> : null}
          {song ? (
            <button type="button" className="story-card__play" onClick={() => onPlay(blendTrackSong({ song, for: [], kind: 'pick' }))} aria-label={`Play ${song.title}`}>
              <Play size={16} fill="currentColor" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      );
    }
    case 'match':
    case 'directions':
    case 'artist':
    case 'brought':
    case 'groupMatch':
    case 'mostInTune':
    case 'leastInTune':
    case 'glue':
      return (
        <div className="story-card__body">
          <p className="story-card__eyebrow">{text.eyebrow}</p>
          <p className={`story-card__headline${story.kind === 'match' ? ' story-card__headline--big' : ''}`}>{text.headline}</p>
          {text.detail ? <p className="story-card__detail">{text.detail}</p> : null}
        </div>
      );
    default: {
      const unknown: never = story;
      return unknown;
    }
  }
}

/** The Blend's story cards, in the order the server chose (storiesFor). Nothing auto-advances. */
export function BlendStories({ detail, palette, onPlay }: { readonly detail: BlendDetail; readonly palette: Palette | null; readonly onPlay: (song: UnifiedSong) => void }) {
  const reduced = useReducedMotion() ?? false;
  const [sharing, setSharing] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<{ index: number; blob: Blob } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setPrepared(null); return () => { generation.current += 1; }; }, [detail]);
  // Cards take turns glowing in each member's colour, so the row reads as everyone's.
  const glows = [...useContext(BlendTones).values()];
  if (detail.stories.length === 0) return null;

  return (
    <ul className="blend-stories" aria-label="Your Blend in numbers">
      {detail.stories.map((story, index) => (
        <motion.li
          key={`${story.kind}-${index}`}
          className="story-card"
          style={{ '--card-tone': glows[index % Math.max(1, glows.length)] } as CSSProperties}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate, delay: index * motionTokens.stagger }}
        >
          <StoryCard story={story} detail={detail} onPlay={onPlay} />
          <button
            type="button"
            className="story-card__share"
            disabled={sharing === index}
            onClick={() => {
              setSharing(index);
              setShareError(null);
              if (prepared?.index === index) {
                void shareStoryCard(story, detail, prepared.blob).then(result => {
                  if (result === 'failed') setShareError('That image could not be shared. Try again.');
                }).finally(() => setSharing(null));
                return;
              }
              const current = generation.current;
              void storyCardBlob(story, detail, palette ?? DEFAULT_PALETTE).then(blob => {
                if (current !== generation.current) return;
                if (blob) setPrepared({ index, blob });
                else setShareError('That image could not be prepared. Try again.');
              }).finally(() => { if (current === generation.current) setSharing(null); });
            }}
          >
            <Share2 size={14} aria-hidden="true" />
            <span>{sharing === index ? 'Preparing…' : prepared?.index === index ? 'Share image' : 'Prepare to share'}</span>
          </button>
        </motion.li>
      ))}
      {shareError ? <li role="alert" className="blend-sheet__error">{shareError}</li> : null}
    </ul>
  );
}
