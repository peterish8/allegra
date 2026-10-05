import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from '../../hooks/useFocusTrap';
import { motionTokens, spring, transitionForReducedMotion } from '../../motion';

/**
 * A modal sheet for Blend steps: labelled dialog, focus kept inside and handed back on close,
 * Escape closes. Enters by rising (transform) and fading (opacity) only. Portalled to <body>: the
 * pages animate `transform`, which would trap a fixed layer under the mini player and phone nav.
 */
export function BlendSheet({ title, onClose, children }: { readonly title: string; readonly onClose: () => void; readonly children: (titleId: string) => ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const titleId = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useFocusTrap(true, ref);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return createPortal(
    <div className="blend-sheet-layer">
      <motion.div
        className="blend-sheet-backdrop"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard }}
        onClick={onClose}
      />
      <motion.div
        ref={ref}
        className="blend-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={transitionForReducedMotion(reduced, spring.sheet)}
      >
        <h2 id={titleId} className="blend-sheet__title">{title}</h2>
        {children(titleId)}
      </motion.div>
    </div>,
    document.body
  );
}
