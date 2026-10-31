import { Download } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef } from 'react';

import { TactileButton } from './ui';
import { motionTokens } from '../motion';

interface KaraokeConsentSheetProps {
  /** Bytes to download; null keeps the sheet closed. */
  readonly bytes: number | null;
  readonly onAnswer: (download: boolean) => void;
}

/**
 * Asked once, before the first download of the AI model. Karaoke is already on with the
 * light remover while the question is open, so answering never blocks the music.
 */
export function KaraokeConsentSheet({ bytes, onAnswer }: KaraokeConsentSheetProps) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;
  const open = bytes !== null;

  useEffect(() => {
    if (!open) return undefined;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      answerRef.current(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open]);

  // Decimal megabytes, as download sizes are quoted everywhere else (Hugging Face, the OS).
  const megabytes = bytes === null ? 0 : Math.round(bytes / 1_000_000);
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="karaoke-consent"
          ref={rootRef}
          className="karaoke-mix karaoke-consent"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base, ease: motionTokens.ease.decelerate }}
        >
          <div className="karaoke-mix__head">
            <h3 id={titleId}>Use the AI vocal remover?</h3>
          </div>
          <p id={bodyId} className="karaoke-consent__body">
            Karaoke is on with the light remover. The on-device AI model removes vocals far more cleanly and lets you mix
            them back in. It is a one-time {megabytes} MB download, kept in this browser; Wi-Fi recommended. Nothing is uploaded.
          </p>
          <div className="karaoke-consent__actions">
            <TactileButton variant="primary" icon={Download} onClick={() => onAnswer(true)}>
              Download {megabytes} MB
            </TactileButton>
            <TactileButton variant="ghost" onClick={() => onAnswer(false)}>
              Not now
            </TactileButton>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
