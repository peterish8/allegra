import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect } from 'react';

import { motionTokens } from '../../motion';

const format = (value: number): string => Math.round(value).toLocaleString('en-US');

/**
 * An import's arrival: the number of songs that landed, counting up (the MatchNumber pattern).
 * The counting text is hidden from screen readers; they hear the final sentence at once.
 * Reduced motion shows the final number with a fade.
 */
export function ArrivalCount({ value, noun }: { readonly value: number; readonly noun: string }) {
  const reduced = useReducedMotion() ?? false;
  const count = useMotionValue(reduced ? value : 0);
  const shown = useTransform(count, format);

  useEffect(() => {
    if (reduced) {
      count.set(value);
      return undefined;
    }
    const controls = animate(count, value, { duration: motionTokens.duration.cinematic, ease: motionTokens.ease.emphasis });
    return () => controls.stop();
  }, [count, reduced, value]);

  return (
    <p className="import-arrival__count" role="status">
      <motion.strong
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard }}
      >
        {shown}
      </motion.strong>
      <span aria-hidden="true"> {noun}</span>
      <span className="sr-only">{format(value)} {noun}</span>
    </p>
  );
}
