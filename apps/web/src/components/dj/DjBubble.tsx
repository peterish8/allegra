import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { motionTokens, reducedTransition } from '../../motion';

/** Past this many words, the rest arrive together instead of one after another. */
const MAX_STAGGERED_WORDS = 14;

export interface DjBubbleProps {
  /** What the DJ says. A new text replays the entrance. */
  readonly text: string;
  readonly working: boolean;
  readonly reduced: boolean;
  /** Buttons under the words (Undo, first-run choices). */
  readonly actions?: ReactNode;
}

/**
 * The DJ talking: a centred caption under the mascot, at the bottom of its stage. The words of a reply
 * rise in one after another; while it works, its progress shows plainly with three dots breathing after it. It is
 * the page's live status for screen readers.
 */
export function DjBubble({ text, working, reduced, actions }: DjBubbleProps) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div className="dj-bubble" role="status" aria-live="polite">
      <span className="sr-only">Your DJ says:</span>
      <p key={working ? 'working' : text} aria-label={text}>
        {/* Progress text changes many times a second while it works, so only a finished reply rises in. */}
        {working ? <span>{text}</span> : words.map((word, index) => (
          <motion.span
            key={`${index}:${word}`}
            className="dj-word"
            aria-hidden="true"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={reduced ? reducedTransition : {
              duration: motionTokens.duration.base,
              ease: motionTokens.ease.decelerate,
              delay: Math.min(index, MAX_STAGGERED_WORDS) * motionTokens.stagger
            }}
          >
            {word}{' '}
          </motion.span>
        ))}
        {working ? <span className="dj-dots" aria-hidden="true"><i /><i /><i /></span> : null}
      </p>
      {actions ? <div className="dj-bubble-actions">{actions}</div> : null}
    </div>
  );
}
