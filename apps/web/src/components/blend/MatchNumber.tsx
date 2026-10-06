import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useRef } from 'react';

import { tapHaptic } from '../../lib/haptics';
import { motionTokens } from '../../motion';

/**
 * The taste match counting up from 0. The number itself is text: screen readers get the final value
 * at once from a hidden sibling. Reduced motion, or `instant` (a skipped reveal), shows the final
 * number with an opacity fade. `delay` holds the count while the orbs travel.
 */
export function MatchNumber({ value, delay = 0, instant = false, onLanded }: { readonly value: number; readonly delay?: number; readonly instant?: boolean; readonly onLanded?: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const still = reduced || instant;
  const count = useMotionValue(still ? value : 0);
  const shown = useTransform(count, (latest) => `${Math.round(latest)}%`);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    if (still) {
      count.set(value);
      landed.current?.();
      return undefined;
    }
    const controls = animate(count, value, {
      delay,
      duration: motionTokens.duration.cinematic,
      ease: motionTokens.ease.emphasis,
      onComplete: () => {
        tapHaptic();
        landed.current?.();
      }
    });
    return () => controls.stop();
  }, [count, delay, still, value]);

  return (
    <span className="match-number">
      <motion.span
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard, delay: still ? 0 : delay }}
      >
        {shown}
      </motion.span>
      <span className="sr-only">Taste match {value} percent</span>
    </span>
  );
}
