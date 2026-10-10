import { MessagesSquare, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { motionTokens, reducedTransition, spring } from '../../motion';

export interface DjHistoryProps {
  /** The conversation so far, oldest first (the session keeps the last eight messages). */
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
  readonly reduced: boolean;
}

/**
 * The conversation, out of the way: a quiet icon on the stage that opens the last few exchanges. The
 * caption under the mascot only ever shows the latest line; this is where the rest lives. Esc or a
 * press outside closes it, and focus goes back to the icon.
 */
export function DjHistory({ history, reduced }: DjHistoryProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  if (history.length === 0) return null;

  return (
    <div className="dj-history">
      <button
        ref={buttonRef}
        type="button"
        className="dj-tool-button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Conversation with your DJ"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Conversation"
      >
        <MessagesSquare size={17} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            key="dj-history"
            className="dj-history-panel"
            role="dialog"
            aria-label="Conversation with your DJ"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
            transition={reduced ? reducedTransition : spring.sheet}
          >
            <div className="dj-history-head">
              <strong>Conversation</strong>
              <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} aria-label="Close the conversation"><X size={15} /></button>
            </div>
            <ol className="dj-history-list">
              {history.map((entry, index) => (
                <li key={index} className={`dj-history-line is-${entry.role}`}>
                  <span className="sr-only">{entry.role === 'user' ? 'You said:' : 'Your DJ said:'}</span>
                  {entry.content}
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
